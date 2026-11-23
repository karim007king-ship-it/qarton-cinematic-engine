export const VIEWPORT = Object.freeze({ width: 720, height: 1280, fps: 24 });
export const MIN_DURATION_MS = 3000;
export const MAX_DURATION_MS = 60000;
export const MAX_PROJECT_BYTES = 128 * 1024;
export const PROJECT_FORMAT = "qarton-motion-studio-project";

const ownObject = (value) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function makeProject({ durationMs, assetId = "photo-1", layers = null, startZoom, endZoom, startX, endX, startY, endY }) {
  if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new RangeError("مدة المشروع يجب أن تكون بين 3 و60 ثانية.");
  }
  const pose = (x, y, zoom) => ({ x, y, zoom, rotation: 0 });
  return {
    version: 1,
    durationMs,
    viewport: { ...VIEWPORT },
    layers: layers ?? [{ id: "photo-layer", assetId, z: 0 }],
    camera: [
      { atMs: 0, value: pose(startX, startY, startZoom) },
      { atMs: durationMs, value: pose(endX, endY, endZoom) }
    ]
  };
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

export function makeProjectFile(project, imageInfo = null) {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    project,
    image: imageInfo ? { name: imageInfo.name, type: imageInfo.type, size: imageInfo.size } : null
  };
}

export function parseProjectFile(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("ملف المشروع كبير جدًا أو غير صالح.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new TypeError("ملف JSON غير صالح."); }
  if (!ownObject(data) || Object.keys(data).sort().join(",") !== "format,image,project,version" ||
      data.format !== PROJECT_FORMAT || data.version !== 1) {
    throw new TypeError("صيغة ملف Motion Studio غير مدعومة.");
  }
  const project = data.project;
  if (!ownObject(project) || project.version !== 1 ||
      project.durationMs < MIN_DURATION_MS || project.durationMs > MAX_DURATION_MS ||
      project.viewport?.width !== VIEWPORT.width || project.viewport?.height !== VIEWPORT.height ||
      project.viewport?.fps !== VIEWPORT.fps || !Array.isArray(project.layers) || project.layers.length !== 1) {
    throw new TypeError("بيانات المشروع لا تطابق واجهة Motion Studio على الهاتف.");
  }
  if (Object.hasOwn(project, "camera") &&
      (!Array.isArray(project.camera) || project.camera.length !== 2 ||
       project.camera[0]?.atMs !== 0 || project.camera[1]?.atMs !== project.durationMs)) {
    throw new TypeError("هذا المختبر يدعم مفتاحي كاميرا للبداية والنهاية فقط؛ لم يُفتح المشروع حتى لا تضيع بقية المفاتيح.");
  }
  if (data.image !== null && (!ownObject(data.image) ||
      Object.keys(data.image).sort().join(",") !== "name,size,type" ||
      typeof data.image.name !== "string" || typeof data.image.type !== "string" ||
      !Number.isSafeInteger(data.image.size) || data.image.size < 0)) {
    throw new TypeError("بيانات الصورة المرتبطة بالمشروع غير صالحة.");
  }
  return { project, image: data.image };
}
