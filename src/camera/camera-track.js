import { easeInOutCubic, lerp } from "../motion/easing.js";

const DEFAULT_POSE = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 });

function normalizePose(pose, label) {
  if (!pose || typeof pose !== "object") throw new TypeError(`${label} must be an object`);
  const normalized = {
    x: pose.x ?? 0,
    y: pose.y ?? 0,
    zoom: pose.zoom ?? 1,
    rotation: pose.rotation ?? 0
  };
  if (!Object.values(normalized).every(Number.isFinite) || normalized.zoom <= 0) {
    throw new TypeError(`${label} values must be finite and zoom must be positive`);
  }
  return Object.freeze(normalized);
}

/**
 * Create an immutable camera track. Each keyframe describes the camera pose
 * at an absolute scene time in milliseconds.
 */
export function createCameraTrack(keyframes, { defaultPose = DEFAULT_POSE } = {}) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    throw new TypeError("Camera track requires at least one keyframe");
  }
  const fallback = normalizePose(defaultPose, "Default camera pose");
  const seenTimes = new Set();
  const frames = keyframes.map((frame, index) => {
    if (!frame || typeof frame !== "object" || !Number.isFinite(frame.atMs) || frame.atMs < 0) {
      throw new TypeError(`Camera keyframe ${index} requires a non-negative atMs`);
    }
    if (seenTimes.has(frame.atMs)) throw new TypeError("Camera keyframe times must be unique");
    seenTimes.add(frame.atMs);
    return Object.freeze({
      atMs: frame.atMs,
      ...normalizePose(frame, `Camera keyframe ${index}`)
    });
  }).sort((a, b) => a.atMs - b.atMs);

  return Object.freeze({
    keyframes: Object.freeze(frames),
    defaultPose: fallback,
    durationMs: frames.at(-1).atMs
  });
}

/** Sample a camera track deterministically at an absolute scene time. */
export function sampleCameraTrack(track, timeMs) {
  if (!track || !Array.isArray(track.keyframes) || track.keyframes.length === 0) {
    throw new TypeError("A valid camera track is required");
  }
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new TypeError("Camera time must be a non-negative finite number");
  }
  const frames = track.keyframes;
  if (timeMs < frames[0].atMs) return Object.freeze({ ...track.defaultPose });
  if (timeMs === frames[0].atMs) {
    const { atMs, ...pose } = frames[0];
    return Object.freeze(pose);
  }
  const last = frames.at(-1);
  if (timeMs >= last.atMs) {
    const { atMs, ...pose } = last;
    return Object.freeze(pose);
  }

  let rightIndex = 1;
  while (frames[rightIndex].atMs < timeMs) rightIndex += 1;
  const from = frames[rightIndex - 1];
  const to = frames[rightIndex];
  const rawProgress = (timeMs - from.atMs) / (to.atMs - from.atMs);
  const progress = easeInOutCubic(rawProgress);
  return Object.freeze({
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    zoom: lerp(from.zoom, to.zoom, progress),
    rotation: lerp(from.rotation, to.rotation, progress)
  });
}

/** Combine a camera pose with an optional shake sample without mutating either. */
export function composeCameraPose(pose, shake = {}) {
  const base = normalizePose(pose, "Camera pose");
  const offset = {
    x: shake.x ?? 0,
    y: shake.y ?? 0,
    rotation: shake.rotation ?? 0
  };
  if (!Object.values(offset).every(Number.isFinite)) {
    throw new TypeError("Camera shake offsets must be finite numbers");
  }
  return Object.freeze({
    x: base.x + offset.x,
    y: base.y + offset.y,
    zoom: base.zoom,
    rotation: base.rotation + offset.rotation
  });
}

/** Convert a camera pose into a CSS transform for a host-owned camera viewport. */
export function toCameraCSS(pose) {
  const camera = normalizePose(pose, "Camera pose");
  return `translate(${camera.x}px, ${camera.y}px) rotate(${camera.rotation}deg) scale(${camera.zoom})`;
}
