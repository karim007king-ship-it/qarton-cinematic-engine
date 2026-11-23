import { createCharacterController } from "./character-controller.js";
import { createMotionPath, sampleMotionPath } from "../motion/path.js";
import { createTimeline } from "../motion/timeline.js";
import { createSceneClock } from "../motion/scene-clock.js";
import { easeInOutCubic } from "../motion/easing.js";

const NUMERIC_CHANNELS = Object.freeze({
  headRotation: Object.freeze([-60, 60]),
  eyeX: Object.freeze([-1, 1]),
  eyeY: Object.freeze([-1, 1]),
  blink: Object.freeze([0, 1]),
  mouthOpen: Object.freeze([0, 1]),
  bodyRotation: Object.freeze([-30, 30])
});
const INITIAL_POSE = Object.freeze({
  ...Object.fromEntries(Object.keys(NUMERIC_CHANNELS).map(key => [key, 0])),
  expression: "neutral",
  gesture: "neutral"
});
const EASING = Object.freeze({
  linear: value => value,
  easeInOutCubic
});
const POSE_CHANNELS = new Set([...Object.keys(NUMERIC_CHANNELS), "expression", "gesture"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function checkedPose(value, previous, label) {
  if (!plainObject(value) || Reflect.ownKeys(value).length === 0) {
    throw new TypeError(`${label} values must be a non-empty plain object`);
  }
  const next = { ...previous };
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !POSE_CHANNELS.has(key)) {
      throw new TypeError(`${label} contains an unsupported pose channel`);
    }
    if (Object.hasOwn(NUMERIC_CHANNELS, key)) {
      const [min, max] = NUMERIC_CHANNELS[key];
      if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
        throw new RangeError(`${label} ${key} must be in [${min}, ${max}]`);
      }
      next[key] = value[key];
    } else {
      if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 64) {
        throw new TypeError(`${label} ${key} must be a non-empty string of at most 64 characters`);
      }
      next[key] = value[key].trim();
    }
  }
  return Object.freeze(next);
}

function framePaths(from, to) {
  const pair = (x, y) => createMotionPath([
    { x: from[x], y: from[y] },
    { x: to[x], y: to[y] }
  ]);
  return Object.freeze({
    headBody: pair("headRotation", "bodyRotation"),
    eyes: pair("eyeX", "eyeY"),
    face: pair("blink", "mouthOpen")
  });
}

/**
 * Compile a deterministic 2D character animation from absolute-time keys.
 * Character travel and sprite clip sampling remain delegated to the existing
 * character controller; this layer adds face, head, and gesture channels.
 */
export function createCharacterAnimation({
  character = {}, durationMs, keyframes = []
} = {}, { reducedMotion = false } = {}) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 300_000) {
    throw new RangeError("Character animation duration must be an integer in [1, 300000] milliseconds");
  }
  if (!Array.isArray(keyframes) || keyframes.length > 2048) {
    throw new TypeError("Character keyframes must be an array of at most 2048 entries");
  }
  if (!character || typeof character !== "object" || Array.isArray(character)) {
    throw new TypeError("Character definition must be an object");
  }
  const base = createCharacterController(character, { reducedMotion });
  const initialValues = Object.fromEntries(Object.entries(character.initial ?? {})
    .filter(([key]) => POSE_CHANNELS.has(key)));
  const initialPose = Object.keys(initialValues).length === 0
    ? Object.freeze({ ...INITIAL_POSE, expression: character.initial?.expression ?? INITIAL_POSE.expression })
    : checkedPose(initialValues, INITIAL_POSE, "Initial character pose");
  const seen = new Set();
  const orderedKeyframes = keyframes.map((keyframe, index) => {
    if (!plainObject(keyframe) || Reflect.ownKeys(keyframe).some(key =>
      typeof key !== "string" || !["atMs", "values", "easing"].includes(key))) {
      throw new TypeError(`Character keyframe ${index} must contain only atMs, values, and easing`);
    }
    if (!Number.isSafeInteger(keyframe.atMs) || keyframe.atMs < 0 || keyframe.atMs > durationMs) {
      throw new RangeError(`Character keyframe ${index} time must be in [0, ${durationMs}]`);
    }
    if (seen.has(keyframe.atMs)) throw new RangeError(`Duplicate character keyframe at ${keyframe.atMs}ms`);
    seen.add(keyframe.atMs);
    const easing = keyframe.easing ?? "easeInOutCubic";
    if (typeof easing !== "string" || !Object.hasOwn(EASING, easing)) {
      throw new TypeError(`Character keyframe ${index} has an unsupported easing`);
    }
    return { atMs: keyframe.atMs, values: keyframe.values, easing, index };
  }).sort((a, b) => a.atMs - b.atMs || a.index - b.index);

  let previous = initialPose;
  const timeline = createTimeline(orderedKeyframes.map(keyframe => {
    const pose = checkedPose(keyframe.values, previous, `Character keyframe ${keyframe.index}`);
    previous = pose;
    return {
      id: `character-key-${keyframe.atMs}`,
      atMs: keyframe.atMs,
      type: "character-pose",
      payload: Object.freeze({ pose, easing: keyframe.easing })
    };
  }));
  const keys = timeline.events.map(event => Object.freeze({
    atMs: event.atMs,
    pose: event.payload.pose,
    easing: EASING[event.payload.easing]
  }));
  const segments = keys.map((key, index) => index === 0 ? null : Object.freeze({
    from: keys[index - 1].pose,
    to: key.pose,
    easing: key.easing,
    paths: framePaths(keys[index - 1].pose, key.pose)
  }));

  function sample(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > durationMs) {
      throw new RangeError(`Character sample time must be in [0, ${durationMs}]`);
    }
    const baseState = base.update(timeMs);
    if (!keys.length || timeMs < keys[0].atMs) {
      return Object.freeze({ ...baseState, ...initialPose });
    }
    let index = 0;
    while (index + 1 < keys.length && keys[index + 1].atMs <= timeMs) index += 1;
    const key = keys[index];
    if (index === keys.length - 1 || timeMs === key.atMs) {
      return Object.freeze({ ...baseState, ...key.pose });
    }
    const segment = segments[index + 1];
    const progress = (timeMs - key.atMs) / (keys[index + 1].atMs - key.atMs);
    const headBody = sampleMotionPath(segment.paths.headBody, progress, segment.easing);
    const eyes = sampleMotionPath(segment.paths.eyes, progress, segment.easing);
    const face = sampleMotionPath(segment.paths.face, progress, segment.easing);
    return Object.freeze({
      ...baseState,
      ...segment.from,
      headRotation: headBody.x,
      bodyRotation: headBody.y,
      eyeX: eyes.x,
      eyeY: eyes.y,
      blink: face.x,
      mouthOpen: face.y
    });
  }

  return Object.freeze({
    id: base.id,
    durationMs,
    timeline,
    sample,
    frameAssets: base.frameAssets ?? Object.freeze([])
  });
}

/** Scene-clock transport for a compiled character animation. */
export function createCharacterAnimationPlayer(animation, { now = () => performance.now() } = {}) {
  if (!animation || typeof animation.sample !== "function" || !Number.isFinite(animation.durationMs)) {
    throw new TypeError("A compiled character animation is required");
  }
  const clock = createSceneClock({ durationMs: animation.durationMs, now });
  let destroyed = false;
  function assertAlive() {
    if (destroyed) throw new Error("Character animation player has been destroyed");
  }
  function sample() { assertAlive(); return animation.sample(clock.time()); }
  function play() {
    assertAlive();
    if (clock.time() >= animation.durationMs) clock.seek(0);
    clock.resume();
    return sample();
  }
  function pause() { assertAlive(); const timeMs = clock.pause(); return animation.sample(timeMs); }
  function resume() { assertAlive(); clock.resume(); return sample(); }
  function seek(timeMs) { assertAlive(); clock.seek(timeMs); return sample(); }
  function replay() { assertAlive(); clock.seek(0); clock.resume(); return sample(); }
  function destroy() {
    if (destroyed) return false;
    clock.pause();
    destroyed = true;
    return true;
  }
  return Object.freeze({
    sample, play, pause, resume, seek, replay, destroy,
    get paused() { return clock.paused; },
    get timeMs() { assertAlive(); return clock.time(); }
  });
}
