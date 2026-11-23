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

export function makeProjectFile(project, imageInfo = null, settings = { aspectPreset: "original", fitMode: "fit" }) {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    project,
    image: imageInfo ? { name: imageInfo.name, type: imageInfo.type, size: imageInfo.size } : null,
    settings: { aspectPreset: settings.aspectPreset, fitMode: settings.fitMode }
  };
}

export function parseProjectFile(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("ملف المشروع كبير جدًا أو غير صالح.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new TypeError("ملف JSON غير صالح."); }
  const legacyEnvelope = ownObject(data) && Object.keys(data).sort().join(",") === "format,image,project,version";
  const currentEnvelope = ownObject(data) && Object.keys(data).sort().join(",") === "format,image,project,settings,version";
  if (!legacyEnvelope && !currentEnvelope ||
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
  const settings = legacyEnvelope ? null : data.settings;
  if (settings !== null && (!ownObject(settings) || Object.keys(settings).sort().join(",") !== "aspectPreset,fitMode" ||
      !["original", "square", "portrait", "landscape", "post", "classic-landscape", "classic-portrait"].includes(settings.aspectPreset) ||
      !["fit", "fill"].includes(settings.fitMode))) {
    throw new TypeError("إعدادات أبعاد المشروع أو طريقة العرض غير صالحة.");
  }
  return { project, image: data.image, settings };
}
