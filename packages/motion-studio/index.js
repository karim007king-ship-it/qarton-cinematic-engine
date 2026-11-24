import { createCameraTrack, sampleCameraTrack } from "@qarton/cinematic-engine/camera";
import { clamp } from "@qarton/cinematic-engine/motion";
import { createTimeline } from "@qarton/cinematic-engine/motion/timeline";

export { EXPORT_LIMITS, EXPORT_PROFILES, ExportError, planExport, rasterForQuality,
  prepareAudioMix, MIME_CANDIDATES, probeExport, startExport } from "./export/index.js";

export {
  addCameraKeyframe,
  deleteCameraKeyframe,
  moveCameraKeyframe,
  normalizeCameraPose,
  updateCameraKeyframe,
  validateCameraKeyframes,
  CAMERA_POSE_LIMITS,
  DEFAULT_CAMERA_POSE
} from "./keyframes.js";

const LIMITS = Object.freeze({ dimension: 4096, pixels: 8_388_608, fps: 60, durationMs: 300_000,
  layers: 64, keys: 1024 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const IDENTITY = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 });
const compiledProjects = new WeakSet();

function fields(value, required, optional, label) {
  if (!value || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new TypeError(`${label} has invalid fields`);
  }
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value) || /\s/u.test(value)) {
    throw new TypeError(`${label} must be an opaque ASCII identifier`);
  }
}

function compileTrack(keys, durationMs, label) {
  if (!Array.isArray(keys)) throw new TypeError(`${label} must be an array`);
  integer(keys.length, 1, LIMITS.keys, `${label} length`);

  let previousMs = -1;
  const timeline = createTimeline(Array.from(keys, (key, index) => {
    fields(key, ["atMs", "value"], [], `${label} key ${index}`);
    integer(key.atMs, 0, durationMs, `${label} atMs`);
    if (key.atMs <= previousMs) throw new RangeError(`${label} times must increase strictly`);
    previousMs = key.atMs;

    const pose = key.value;
    fields(pose, ["x", "y", "zoom", "rotation"], [], `${label} pose`);
    if (![pose.x, pose.y, pose.zoom, pose.rotation].every(Number.isFinite) ||
        Math.abs(pose.x) > 32768 || Math.abs(pose.y) > 32768 ||
        pose.zoom < 0.01 || pose.zoom > 64 || Math.abs(pose.rotation) > 36000) {
      throw new RangeError(`${label} pose is outside Studio limits`);
    }
    return { id: String(index), atMs: key.atMs, type: "pose", payload: pose };
  }));
  return createCameraTrack(timeline.events.map(({ atMs, payload }) => ({ atMs, ...payload })));
}

/** Compile JSON metadata and bind caller-owned, already decoded Canvas image sources. */
export function compileProject(project, assetProvider) {
  fields(project, ["version", "durationMs", "viewport", "layers"], ["camera"], "Project");
  if (project.version !== 1) throw new RangeError("Studio project version must be 1");
  const { durationMs, viewport, layers } = project;
  integer(durationMs, 1, LIMITS.durationMs, "Duration");
  fields(viewport, ["width", "height", "fps"], [], "Viewport");
  const { width, height, fps } = viewport;
  integer(width, 1, LIMITS.dimension, "Width");
  integer(height, 1, LIMITS.dimension, "Height");
  integer(width * height, 1, LIMITS.pixels, "Viewport pixels");
  integer(fps, 1, LIMITS.fps, "FPS");
  if (!Array.isArray(layers)) throw new TypeError("Layers must be an array");
  integer(layers.length, 1, LIMITS.layers, "Layer count");
  if (typeof assetProvider?.get !== "function") throw new TypeError("Image provider requires get(id)");

  const camera = Object.hasOwn(project, "camera") ? compileTrack(project.camera, durationMs, "Camera") : null;
  const ids = new Set();
  const orderedLayers = Array.from(layers, (layer, order) => {
    fields(layer, ["id", "assetId", "z"], ["track"], "Layer");
    const { id, assetId, z } = layer;
    identifier(id, "Layer ID");
    identifier(assetId, "Asset ID");
    if (ids.has(id)) throw new TypeError(`Duplicate layer ID: ${id}`);
    ids.add(id);
    integer(z, -2147483648, 2147483647, "Layer z");
    const track = Object.hasOwn(layer, "track") ? compileTrack(layer.track, durationMs, id) : null;
    return { id, assetId, z, order, track };
  }).sort((a, b) => a.z - b.z || a.order - b.order);

  const images = new Map();
  const compiledLayers = orderedLayers.map(({ order, assetId, ...layer }) => {
    if (!images.has(assetId)) {
      const image = assetProvider.get(assetId);
      if (!image || typeof image !== "object" || typeof image.then === "function") {
        throw new TypeError(`Missing decoded image: ${assetId}`);
      }
      images.set(assetId, image);
    }
    return Object.freeze({ ...layer, assetId, image: images.get(assetId) });
  });
  const compiled = Object.freeze({
    durationMs, viewport: Object.freeze({ width, height, fps }), camera,
    layers: Object.freeze(compiledLayers)
  });
  compiledProjects.add(compiled);
  return compiled;
}

/** Sample absolute milliseconds. Finite times outside the project clamp to its endpoints. */
export function sampleFrame(compiled, timeMs) {
  if (!compiledProjects.has(compiled)) throw new TypeError("Expected a compiled Studio project");
  const atMs = clamp(timeMs, 0, compiled.durationMs);
  return Object.freeze({
    atMs,
    viewport: compiled.viewport,
    camera: compiled.camera ? sampleCameraTrack(compiled.camera, atMs) : IDENTITY,
    layers: Object.freeze(compiled.layers.map(({ track, ...layer }) => Object.freeze({
      ...layer, pose: track ? sampleCameraTrack(track, atMs) : IDENTITY
    })))
  });
}

function applyPose(ctx, { x, y, zoom, rotation }, centerX, centerY) {
  ctx.translate(centerX + x, centerY + y);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(zoom, zoom);
  ctx.translate(-centerX, -centerY);
}

/** Paint an entire frame on a dedicated 2D canvas with the project's backing dimensions. */
export function drawFrame(ctx, frame) {
  const { width, height } = frame.viewport;
  if (ctx?.canvas?.width !== width || ctx.canvas.height !== height) {
    throw new RangeError("Canvas backing dimensions must match the project viewport");
  }
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.shadowColor = "transparent";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.clearRect(0, 0, width, height);
    applyPose(ctx, frame.camera, width / 2, height / 2);
    for (const { image, pose } of frame.layers) {
      ctx.save();
      try {
        applyPose(ctx, pose, width / 2, height / 2);
        ctx.drawImage(image, 0, 0, width, height);
      } finally {
        ctx.restore();
      }
    }
  } finally {
    ctx.restore();
  }
}
