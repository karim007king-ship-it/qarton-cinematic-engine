import { normalizeCameraPose, updateCameraKeyframe, validateCameraKeyframes } from "../../packages/motion-studio/keyframes.js";
import { compileCharacterTrack, makeCharacterTrack } from "./studio-character-track.js";

export const VIEWPORT = Object.freeze({ width: 720, height: 1280, fps: 24 });
export const MIN_DURATION_MS = 3000;
export const MAX_DURATION_MS = 60000;
export const MAX_PROJECT_BYTES = 128 * 1024;
export const PROJECT_FORMAT = "qarton-motion-studio-project";
export const MAX_VIEWPORT_DIMENSION = 4096;
export const MAX_VIEWPORT_PIXELS = 8_388_608;

const ownObject = (value) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function makeProject({ durationMs, assetId = "photo-1", layers = null, viewport = VIEWPORT, startZoom, endZoom, startX, endX, startY, endY }) {
  if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new RangeError("مدة المشروع يجب أن تكون بين 3 و60 ثانية.");
  }
  validateViewport(viewport);
  const pose = (x, y, zoom) => ({ x, y, zoom, rotation: 0 });
  return {
    version: 1,
    durationMs,
    viewport: { ...viewport },
    layers: layers ?? [{ id: "photo-layer", assetId, z: 0 }],
    camera: [
      { atMs: 0, value: pose(startX, startY, startZoom) },
      { atMs: durationMs, value: pose(endX, endY, endZoom) }
    ]
  };
}

export function validateViewport(viewport) {
  if (!ownObject(viewport) || !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) ||
      viewport.width < 1 || viewport.height < 1 || viewport.width > MAX_VIEWPORT_DIMENSION ||
      viewport.height > MAX_VIEWPORT_DIMENSION || viewport.width * viewport.height > MAX_VIEWPORT_PIXELS ||
      viewport.fps !== VIEWPORT.fps || Object.keys(viewport).sort().join(",") !== "fps,height,width") {
    throw new RangeError("أبعاد المشروع تتجاوز الحدود المدعومة أو غير صالحة.");
  }
  return viewport;
}

/** Update the legacy start/end controls without discarding imported intermediate keyframes. */
export function setCameraEndpoints(project, { durationMs = project.durationMs, start, end }) {
  if (!project?.camera?.length) throw new TypeError("Project needs at least one camera keyframe");
  if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new RangeError("مدة المشروع يجب أن تكون بين 3 و60 ثانية.");
  }
  validateCameraKeyframes(project.camera, project.durationMs);
  const keys = project.camera.map(({ atMs, value }) => ({ atMs, value: { ...value } }));
  if (keys.slice(1, -1).some(({ atMs }) => atMs >= durationMs)) {
    throw new RangeError("لا يمكن تقصير المدة لأن Keyframe وسيطًا سيصل إلى نقطة النهاية أو يتجاوزها؛ حرّكه أو احذفه أولًا.");
  }
  const startPose = normalizeCameraPose({ ...keys[0].value, ...start });
  const endPose = normalizeCameraPose({ ...keys.at(-1).value, ...end });
  let camera;
  if (keys.length === 1) {
    camera = [{ atMs: 0, value: startPose }, { atMs: durationMs, value: endPose }];
  } else {
    keys[0].atMs = 0;
    keys[0].value = startPose;
    keys.at(-1).atMs = durationMs;
    keys.at(-1).value = endPose;
    camera = keys;
  }
  validateCameraKeyframes(camera, durationMs);
  return { ...project, durationMs, camera };
}

/** Prepare a complete project update before the caller commits any active UI state. */
export function prepareProjectUpdate(project, { durationMs, viewport, start, end, editedControl = null, prepare }) {
  if (typeof prepare !== "function") throw new TypeError("Project update requires a prepare callback");
  validateViewport(viewport);
  let candidate;
  if (project?.camera?.length) {
    if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      throw new RangeError("مدة المشروع يجب أن تكون بين 3 و60 ثانية.");
    }
    const camera = project.camera.map(({ atMs, value }) => ({ atMs, value: { ...value } }));
    if (durationMs !== project.durationMs && camera.length > 1 && camera.at(-1).atMs === project.durationMs) {
      if (camera.slice(1, -1).some(({ atMs }) => atMs >= durationMs)) {
        throw new RangeError("لا يمكن تغيير المدة لأن Keyframe وسيطًا سيصل إلى نقطة النهاية أو يتجاوزها؛ حرّكه أو احذفه أولًا.");
      }
      camera.at(-1).atMs = durationMs;
    }
    if (camera.some(({ atMs }) => atMs > durationMs)) {
      throw new RangeError("لا يمكن تقصير المدة لأن Keyframe موجودًا يقع بعدها؛ حرّكه أو احذفه أولًا.");
    }
    candidate = { ...project, durationMs, viewport: { ...viewport }, camera };
    if (durationMs !== project.durationMs) validateCameraKeyframes(candidate.camera, durationMs);
    const controls = {
      startZoom: [camera[0].atMs, "zoom"], endZoom: [camera.at(-1).atMs, "zoom"],
      startX: [camera[0].atMs, "x"], endX: [camera.at(-1).atMs, "x"],
      startY: [camera[0].atMs, "y"], endY: [camera.at(-1).atMs, "y"]
    };
    // Only the slider that fired may change a pose field; stale legacy controls never overwrite other axes.
    const selectedControl = controls[editedControl];
    if (selectedControl) {
      const [atMs, field] = selectedControl;
      const value = field === "zoom" ? (editedControl === "startZoom" ? start.zoom : end.zoom)
        : field === "x" ? (editedControl === "startX" ? start.x : end.x)
          : editedControl === "startY" ? start.y : end.y;
      candidate = updateCameraKeyframe(candidate, atMs, { [field]: value });
    }
  } else {
    candidate = makeProject({
      durationMs,
      viewport,
      layers: project.layers,
      startZoom: 1,
      endZoom: 1,
      startX: 0,
      endX: 0,
      startY: 0,
      endY: 0
    });
    delete candidate.camera;
  }
  const prepared = prepare(candidate);
  return { project: candidate, prepared };
}

export function createRequestToken() {
  let latest = 0;
  return Object.freeze({
    begin() { latest += 1; return latest; },
    isCurrent(token) { return token === latest; }
  });
}

export function playbackTimeMs({ startAtMs, pausedAtMs, durationMs }, nowMs) {
  const elapsed = pausedAtMs === null ? nowMs - startAtMs : pausedAtMs;
  return Math.max(0, Math.min(durationMs, elapsed));
}

export function makeProjectFile(project, imageInfo = null, settings = { aspectPreset: "original", fitMode: "fit" }, characterTrack = null) {
  const file = {
    format: PROJECT_FORMAT,
    version: 1,
    project,
    image: imageInfo ? { name: imageInfo.name, type: imageInfo.type, size: imageInfo.size } : null,
    settings: { aspectPreset: settings.aspectPreset, fitMode: settings.fitMode }
  };
  if (characterTrack?.keyframes?.length) file.characterTrack = characterTrack;
  return file;
}

export function parseProjectFile(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("ملف المشروع كبير جدًا أو غير صالح.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new TypeError("ملف JSON غير صالح."); }
  const legacyEnvelope = ownObject(data) && Object.keys(data).sort().join(",") === "format,image,project,version";
  const keys = ownObject(data) ? Object.keys(data).sort().join(",") : "";
  const legacyCharacterEnvelope = keys === "characterTrack,format,image,project,version";
  const currentEnvelope = keys === "format,image,project,settings,version" || keys === "characterTrack,format,image,project,settings,version";
  if (!legacyEnvelope && !legacyCharacterEnvelope && !currentEnvelope ||
      data.format !== PROJECT_FORMAT || data.version !== 1) {
    throw new TypeError("صيغة ملف Motion Studio غير مدعومة.");
  }
  const project = data.project;
  if (!ownObject(project) || project.version !== 1 ||
      project.durationMs < MIN_DURATION_MS || project.durationMs > MAX_DURATION_MS ||
      !Array.isArray(project.layers) || project.layers.length !== 1) {
    throw new TypeError("بيانات المشروع لا تطابق واجهة Motion Studio على الهاتف.");
  }
  validateViewport(project.viewport);
  if (Object.hasOwn(project, "camera")) {
    try { validateCameraKeyframes(project.camera, project.durationMs); }
    catch (error) { throw new TypeError(`مفاتيح الكاميرا في ملف المشروع غير صالحة: ${error.message}`); }
  }
  if (data.image !== null && (!ownObject(data.image) ||
      Object.keys(data.image).sort().join(",") !== "name,size,type" ||
      typeof data.image.name !== "string" || typeof data.image.type !== "string" ||
      !Number.isSafeInteger(data.image.size) || data.image.size < 0)) {
    throw new TypeError("بيانات الصورة المرتبطة بالمشروع غير صالحة.");
  }
  const settings = legacyEnvelope || legacyCharacterEnvelope ? null : data.settings;
  if (settings !== null && (!ownObject(settings) || Object.keys(settings).sort().join(",") !== "aspectPreset,fitMode" ||
      !["original", "square", "portrait", "landscape", "post", "classic-landscape", "classic-portrait"].includes(settings.aspectPreset) ||
      !["fit", "fill"].includes(settings.fitMode))) {
    throw new TypeError("إعدادات أبعاد المشروع أو طريقة العرض غير صالحة.");
  }
  const characterTrack = Object.hasOwn(data, "characterTrack") ? data.characterTrack : makeCharacterTrack();
  try { compileCharacterTrack(characterTrack, project.durationMs); }
  catch (error) { throw new TypeError(`مسار الشخصية في ملف المشروع غير صالح: ${error.message}`); }
  return { project, image: data.image, settings, characterTrack };
}
