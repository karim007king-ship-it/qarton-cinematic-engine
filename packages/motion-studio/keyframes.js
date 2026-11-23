import { createCameraTrack } from "@qarton/cinematic-engine/camera";
import { createTimeline } from "@qarton/cinematic-engine/motion/timeline";

export const CAMERA_POSE_LIMITS = Object.freeze({
  x: Object.freeze([-32768, 32768]),
  y: Object.freeze([-32768, 32768]),
  zoom: Object.freeze([0.01, 64]),
  rotation: Object.freeze([-36000, 36000])
});

const POSE_FIELDS = Object.freeze(Object.keys(CAMERA_POSE_LIMITS));
const BASE_POSE = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 });

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function validatePose(value, label = "Keyframe pose") {
  if (!isPlainObject(value) || Object.keys(value).sort().join(",") !== [...POSE_FIELDS].sort().join(",")) {
    throw new TypeError(`${label} must contain exactly x, y, zoom, and rotation`);
  }
  for (const field of POSE_FIELDS) {
    const [min, max] = CAMERA_POSE_LIMITS[field];
    if (!Number.isFinite(value[field]) || value[field] < min || value[field] > max) {
      throw new RangeError(`${label} ${field} must be in [${min}, ${max}]`);
    }
  }
  return Object.freeze({ x: value.x, y: value.y, zoom: value.zoom, rotation: value.rotation });
}

function validateDuration(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 300_000) {
    throw new RangeError("Project duration must be an integer in [1, 300000] milliseconds");
  }
}

function timelineFor(camera, durationMs, { allowMissing = false } = {}) {
  validateDuration(durationMs);
  if (camera === undefined && allowMissing) return createTimeline([]);
  if (!Array.isArray(camera) || camera.length < 1 || camera.length > 1024) {
    throw new TypeError("Camera keyframes must contain 1 to 1024 entries");
  }
  const timeline = createTimeline(camera.map((key, index) => {
    if (!isPlainObject(key) || Object.keys(key).sort().join(",") !== "atMs,value") {
      throw new TypeError(`Camera keyframe ${index} must contain only atMs and value`);
    }
    if (!Number.isSafeInteger(key.atMs) || key.atMs < 0 || key.atMs > durationMs) {
      throw new RangeError(`Camera keyframe ${index} time must be in [0, ${durationMs}]`);
    }
    return {
      id: `keyframe-${key.atMs}`,
      atMs: key.atMs,
      type: "camera-pose",
      payload: validatePose(key.value, `Camera keyframe ${index} pose`)
    };
  }));
  const frames = timeline.events.map(({ atMs, payload }) => ({ atMs, ...payload }));
  // Keep duplicate-time and interpolation rules owned by the shared camera-track API.
  createCameraTrack(frames);
  return timeline;
}

/** Validate a Studio camera track without changing or normalizing the project. */
export function validateCameraKeyframes(camera, durationMs, { allowMissing = false } = {}) {
  timelineFor(camera, durationMs, { allowMissing });
  return true;
}

function checkedProject(project) {
  if (!isPlainObject(project) || !Number.isSafeInteger(project.durationMs)) {
    throw new TypeError("A Studio project with an integer duration is required");
  }
  const timeline = timelineFor(project.camera, project.durationMs, { allowMissing: true });
  return { timeline, frames: timeline.events.map(({ atMs, payload }) => ({ atMs, value: payload })) };
}

function checkedTime(atMs, durationMs, label = "Keyframe time") {
  if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs > durationMs) {
    throw new RangeError(`${label} must be an integer in [0, ${durationMs}]`);
  }
}

function withFrames(project, frames) {
  const next = { ...project };
  if (frames.length) next.camera = frames.map(({ atMs, value }) => ({ atMs, value: { ...value } }));
  else delete next.camera;
  return next;
}

/** Add a full-pose camera keyframe. Returns a fresh project with chronological keys. */
export function addCameraKeyframe(project, { atMs, value }) {
  const { frames } = checkedProject(project);
  checkedTime(atMs, project.durationMs);
  const pose = validatePose(value);
  if (frames.some((key) => key.atMs === atMs)) throw new RangeError(`A keyframe already exists at ${atMs}ms`);
  return withFrames(project, [...frames, { atMs, value: pose }].sort((a, b) => a.atMs - b.atMs));
}

/** Replace selected pose properties without mutating the source project. */
export function updateCameraKeyframe(project, atMs, patch) {
  const { frames } = checkedProject(project);
  checkedTime(atMs, project.durationMs);
  if (!isPlainObject(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !POSE_FIELDS.includes(key))) {
    throw new TypeError("Keyframe update must contain one or more of x, y, zoom, or rotation");
  }
  const index = frames.findIndex((key) => key.atMs === atMs);
  if (index < 0) throw new RangeError(`No keyframe exists at ${atMs}ms`);
  const nextFrames = frames.map((key, keyIndex) => keyIndex === index
    ? { ...key, value: validatePose({ ...key.value, ...patch }) }
    : key);
  return withFrames(project, nextFrames);
}

/** Move one keyframe; collisions are rejected instead of overwriting data. */
export function moveCameraKeyframe(project, fromMs, toMs) {
  const { frames } = checkedProject(project);
  checkedTime(fromMs, project.durationMs, "Source keyframe time");
  checkedTime(toMs, project.durationMs, "Destination keyframe time");
  if (!frames.some((key) => key.atMs === fromMs)) throw new RangeError(`No keyframe exists at ${fromMs}ms`);
  if (toMs !== fromMs && frames.some((key) => key.atMs === toMs)) throw new RangeError(`A keyframe already exists at ${toMs}ms`);
  return withFrames(project, frames.map((key) => key.atMs === fromMs ? { ...key, atMs: toMs } : key)
    .sort((a, b) => a.atMs - b.atMs));
}

/** Delete one keyframe. Removing the final key removes the optional track (identity pose). */
export function deleteCameraKeyframe(project, atMs) {
  const { frames } = checkedProject(project);
  checkedTime(atMs, project.durationMs);
  if (!frames.some((key) => key.atMs === atMs)) throw new RangeError(`No keyframe exists at ${atMs}ms`);
  return withFrames(project, frames.filter((key) => key.atMs !== atMs));
}

/** Return a validated copy of a full pose, useful to callers building keyframe UI. */
export function normalizeCameraPose(value) {
  return validatePose(value);
}

export const DEFAULT_CAMERA_POSE = BASE_POSE;
