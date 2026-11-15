import { clamp, easeInOutCubic } from "../motion/easing.js";
import { sampleMotionPath } from "../motion/path.js";

/**
 * Platform-neutral character sampler. It returns render state only; a host
 * renderer decides how sprites, rigs, or DOM elements consume that state.
 */
export function createCharacterController({ id, initial = {}, motions = [] } = {}) {
  if (typeof id !== "string" || !id.trim()) throw new TypeError("Character id is required");
  if (!Array.isArray(motions)) throw new TypeError("Character motions must be an array");

  const base = Object.freeze({
    x: Number.isFinite(initial.x) ? initial.x : 0,
    y: Number.isFinite(initial.y) ? initial.y : 0,
    opacity: Number.isFinite(initial.opacity) ? clamp(initial.opacity) : 1,
    scale: Number.isFinite(initial.scale) && initial.scale >= 0 ? initial.scale : 1,
    rotation: Number.isFinite(initial.rotation) ? initial.rotation : 0,
    expression: typeof initial.expression === "string" ? initial.expression : "neutral",
    state: typeof initial.state === "string" ? initial.state : "idle"
  });

  const normalized = motions.map((motion, index) => {
    if (!motion || typeof motion !== "object") throw new TypeError(`Motion ${index} must be an object`);
    if (typeof motion.id !== "string" || !motion.id.trim()) throw new TypeError(`Motion ${index} needs an id`);
    if (!motion.path || !Array.isArray(motion.path.points) || motion.path.points.length < 2) {
      throw new TypeError(`Motion "${motion.id}" needs a valid path`);
    }
    if (!Number.isFinite(motion.startMs) || motion.startMs < 0
      || !Number.isFinite(motion.durationMs) || motion.durationMs <= 0) {
      throw new TypeError(`Motion "${motion.id}" needs valid startMs and positive durationMs`);
    }
    const easing = motion.easing ?? easeInOutCubic;
    if (typeof easing !== "function") throw new TypeError(`Motion "${motion.id}" easing must be a function`);
    return Object.freeze({
      id: motion.id,
      path: motion.path,
      startMs: motion.startMs,
      endMs: motion.startMs + motion.durationMs,
      durationMs: motion.durationMs,
      easing,
      expression: typeof motion.expression === "string" ? motion.expression : null,
      state: typeof motion.state === "string" ? motion.state : "moving",
      opacity: Number.isFinite(motion.opacity) ? clamp(motion.opacity) : null,
      scale: Number.isFinite(motion.scale) && motion.scale >= 0 ? motion.scale : null,
      rotation: Number.isFinite(motion.rotation) ? motion.rotation : null
    });
  }).sort((a, b) => a.startMs - b.startMs);

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].startMs < normalized[i - 1].endMs) {
      throw new TypeError("Character motions cannot overlap");
    }
  }

  function update(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new TypeError("Character timeMs must be non-negative and finite");
    let state = { ...base };
    for (const motion of normalized) {
      if (timeMs < motion.startMs) break;
      const progress = clamp((timeMs - motion.startMs) / motion.durationMs);
      const position = sampleMotionPath(motion.path, progress, motion.easing);
      state = {
        ...state,
        x: position.x,
        y: position.y,
        expression: motion.expression ?? state.expression,
        state: progress >= 1 ? "idle" : motion.state,
        opacity: motion.opacity ?? state.opacity,
        scale: motion.scale ?? state.scale,
        rotation: motion.rotation ?? state.rotation
      };
      if (progress < 1) break;
    }
    return Object.freeze({ id, timeMs, ...state });
  }

  return Object.freeze({ id, update });
}
