import { clamp, lerp } from "./easing.js";

/** Create an immutable 2D path made of ordered points. */
export function createMotionPath(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError("Motion path requires at least two points");
  }
  const normalized = points.map((point, index) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError(`Motion path point ${index} requires finite x and y`);
    }
    return Object.freeze({ x: point.x, y: point.y });
  });
  return Object.freeze({ points: Object.freeze(normalized), segmentCount: normalized.length - 1 });
}

/** Sample a path using normalized progress and optional easing. */
export function sampleMotionPath(path, progress, easing = value => value) {
  if (!path || !Array.isArray(path.points) || path.points.length < 2) {
    throw new TypeError("A valid motion path is required");
  }
  if (!Number.isFinite(progress)) throw new TypeError("Path progress must be finite");
  if (typeof easing !== "function") throw new TypeError("Path easing must be a function");
  const eased = clamp(easing(clamp(progress)));
  const scaled = eased * (path.points.length - 1);
  const index = Math.min(Math.floor(scaled), path.points.length - 2);
  const localProgress = eased === 1 ? 1 : scaled - index;
  const from = path.points[index];
  const to = path.points[index + 1];
  return Object.freeze({
    x: lerp(from.x, to.x, localProgress),
    y: lerp(from.y, to.y, localProgress)
  });
}
