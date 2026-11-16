import { clamp, easeInOutCubic } from "../motion/easing.js";
import { sampleMotionPath } from "../motion/path.js";

const POSE_TRANSFORM_DEFAULTS = Object.freeze({
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1
});

const POSE_TRANSFORM_KEYS = Object.keys(POSE_TRANSFORM_DEFAULTS);

function normalizePoseClips(poseClips) {
  if (!Array.isArray(poseClips)) throw new TypeError("Character poseClips must be an array");
  const ids = new Set();
  const clips = poseClips.map((clip, index) => {
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) {
      throw new TypeError(`Pose clip ${index} must be an object`);
    }
    if (typeof clip.id !== "string" || !clip.id.trim() || ids.has(clip.id)) {
      throw new TypeError(`Pose clip ${index} needs a unique id`);
    }
    ids.add(clip.id);
    if (!Number.isFinite(clip.startMs) || clip.startMs < 0
      || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
      throw new TypeError(`Pose clip "${clip.id}" needs valid startMs and positive durationMs`);
    }
    if (!clip.layers || typeof clip.layers !== "object" || Array.isArray(clip.layers)
      || Object.keys(clip.layers).length === 0) {
      throw new TypeError(`Pose clip "${clip.id}" needs layer keyframes`);
    }
    const easing = clip.easing ?? easeInOutCubic;
    if (typeof easing !== "function") throw new TypeError(`Pose clip "${clip.id}" easing must be a function`);

    const layers = {};
    for (const [layerId, keyframes] of Object.entries(clip.layers)) {
      if (!layerId.trim() || !Array.isArray(keyframes) || keyframes.length < 2) {
        throw new TypeError(`Pose clip "${clip.id}" layer "${layerId}" needs at least two keyframes`);
      }
      let previousAt = -1;
      const normalizedFrames = keyframes.map((frame, frameIndex) => {
        if (!frame || typeof frame !== "object" || !Number.isFinite(frame.at)
          || frame.at < 0 || frame.at > 1 || frame.at <= previousAt) {
          throw new TypeError(`Pose clip "${clip.id}" layer "${layerId}" keyframe ${frameIndex} has invalid or unordered at value`);
        }
        previousAt = frame.at;
        for (const key of POSE_TRANSFORM_KEYS) {
          if (frame[key] !== undefined && !Number.isFinite(frame[key])) {
            throw new TypeError(`Pose clip "${clip.id}" layer "${layerId}" has a non-finite ${key}`);
          }
        }
        return Object.freeze({
          at: frame.at,
          ...POSE_TRANSFORM_DEFAULTS,
          ...Object.fromEntries(POSE_TRANSFORM_KEYS.map(key => [key, frame[key] ?? POSE_TRANSFORM_DEFAULTS[key]]))
        });
      });
      if (normalizedFrames[0].at !== 0 || normalizedFrames.at(-1).at !== 1) {
        throw new TypeError(`Pose clip "${clip.id}" layer "${layerId}" keyframes must cover 0..1`);
      }
      layers[layerId] = Object.freeze(normalizedFrames);
    }

    return Object.freeze({
      id: clip.id,
      pose: typeof clip.pose === "string" && clip.pose.trim() ? clip.pose : clip.id,
      startMs: clip.startMs,
      endMs: clip.startMs + clip.durationMs,
      durationMs: clip.durationMs,
      loop: clip.loop === true,
      easing,
      layers: Object.freeze(layers)
    });
  }).sort((a, b) => a.startMs - b.startMs);

  for (let index = 1; index < clips.length; index += 1) {
    if (clips[index].startMs < clips[index - 1].endMs) {
      throw new TypeError("Character pose clips cannot overlap");
    }
  }
  return Object.freeze(clips);
}

/**
 * Platform-neutral character sampler. It returns render state only; a host
 * renderer decides how sprites, rigs, or DOM elements consume that state.
 */
export function createCharacterController({
  id,
  initial = {},
  motions = [],
  dialogue = [],
  facialMotion = {},
  poseClips = [],
  poseMotion = {}
} = {}) {
  if (typeof id !== "string" || !id.trim()) throw new TypeError("Character id is required");
  if (!Array.isArray(motions)) throw new TypeError("Character motions must be an array");
  if (!Array.isArray(dialogue)) throw new TypeError("Character dialogue must be an array");
  if (!facialMotion || typeof facialMotion !== "object" || Array.isArray(facialMotion)) {
    throw new TypeError("Character facialMotion must be an options object");
  }
  if (!poseMotion || typeof poseMotion !== "object" || Array.isArray(poseMotion)) {
    throw new TypeError("Character poseMotion must be an options object");
  }

  const facial = Object.freeze({
    enabled: facialMotion.enabled !== false,
    reducedMotion: facialMotion.reducedMotion === true,
    motionScale: Number.isFinite(facialMotion.motionScale) ? clamp(facialMotion.motionScale) : 1
  });
  const poseOptions = Object.freeze({
    enabled: poseMotion.enabled !== false,
    reducedMotion: poseMotion.reducedMotion === true || facialMotion.reducedMotion === true,
    motionScale: Number.isFinite(poseMotion.motionScale) ? clamp(poseMotion.motionScale) : 1
  });

  const base = Object.freeze({
    x: Number.isFinite(initial.x) ? initial.x : 0,
    y: Number.isFinite(initial.y) ? initial.y : 0,
    opacity: Number.isFinite(initial.opacity) ? clamp(initial.opacity) : 1,
    scale: Number.isFinite(initial.scale) && initial.scale >= 0 ? initial.scale : 1,
    rotation: Number.isFinite(initial.rotation) ? initial.rotation : 0,
    expression: typeof initial.expression === "string" ? initial.expression : "neutral",
    state: typeof initial.state === "string" ? initial.state : "idle",
    pose: typeof initial.pose === "string" ? initial.pose : "idle"
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

  const normalizedPoseClips = normalizePoseClips(poseClips);

  const dialogueCues = dialogue.map((cue, index) => {
    if (!cue || typeof cue !== "object"
      || !Number.isFinite(cue.startMs) || cue.startMs < 0
      || !Number.isFinite(cue.endMs) || cue.endMs <= cue.startMs) {
      throw new TypeError(`Dialogue cue ${index} needs a valid startMs and endMs`);
    }
    if (cue.expression !== undefined && (typeof cue.expression !== "string" || !cue.expression.trim())) {
      throw new TypeError(`Dialogue cue ${index} expression must be a non-empty string`);
    }
    return Object.freeze({
      startMs: cue.startMs,
      endMs: cue.endMs,
      expression: cue.expression ?? null,
      speaking: cue.speaking !== false,
      transitionMs: Number.isFinite(cue.transitionMs) ? Math.max(0, cue.transitionMs) : 120
    });
  }).sort((a, b) => a.startMs - b.startMs);

  for (let i = 1; i < dialogueCues.length; i += 1) {
    if (dialogueCues[i].startMs < dialogueCues[i - 1].endMs) {
      throw new TypeError("Character dialogue cues cannot overlap");
    }
  }

  function samplePose(timeMs) {
    let activeClip = null;
    for (const clip of normalizedPoseClips) {
      if (timeMs < clip.startMs) break;
      activeClip = clip;
    }
    if (!activeClip) return { pose: base.pose, poseProgress: 0, layerTransforms: Object.freeze({}) };

    const rawProgress = activeClip.loop
      ? ((timeMs - activeClip.startMs) % activeClip.durationMs) / activeClip.durationMs
      : clamp((timeMs - activeClip.startMs) / activeClip.durationMs);
    const progress = poseOptions.enabled && !poseOptions.reducedMotion
      ? rawProgress
      : 0;
    const motionScale = poseOptions.enabled && !poseOptions.reducedMotion
      ? poseOptions.motionScale
      : 0;
    const layerTransforms = {};

    for (const [layerId, frames] of Object.entries(activeClip.layers)) {
      let rightIndex = 1;
      while (rightIndex < frames.length - 1 && frames[rightIndex].at < progress) rightIndex += 1;
      const from = frames[rightIndex - 1];
      const to = frames[rightIndex];
      const segmentProgress = clamp((progress - from.at) / (to.at - from.at));
      const eased = clamp(activeClip.easing(segmentProgress));
      const transform = {};
      for (const key of POSE_TRANSFORM_KEYS) {
        const value = from[key] + (to[key] - from[key]) * eased;
        transform[key] = key.startsWith("scale")
          ? 1 + (value - 1) * motionScale
          : value * motionScale;
      }
      layerTransforms[layerId] = Object.freeze(transform);
    }

    return {
      pose: activeClip.pose,
      poseProgress: progress,
      layerTransforms: Object.freeze(layerTransforms)
    };
  }

  function sampleFacialMotion(timeMs, speaking) {
    if (!facial.enabled || facial.reducedMotion || facial.motionScale === 0) {
      return { breathOffsetY: 0, headRotation: 0, eyeFrame: 0 };
    }
    const scale = facial.motionScale;
    const breathOffsetY = Math.sin((timeMs / 3600) * Math.PI * 2) * 1.25 * scale;
    const headRotation = Math.sin((timeMs / (speaking ? 520 : 2400)) * Math.PI * 2)
      * (speaking ? 0.65 : 0.2) * scale;
    const blinkPhase = timeMs % 4200;
    const eyeFrame = blinkPhase >= 0 && blinkPhase < 140 ? 1 : 0;
    return { breathOffsetY, headRotation, eyeFrame };
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
    let dialogueCue = null;
    for (const cue of dialogueCues) {
      if (timeMs < cue.startMs) break;
      if (timeMs < cue.endMs) {
        dialogueCue = cue;
        break;
      }
    }
    const speaking = dialogueCue?.speaking === true;
    const dialogueState = dialogueCue
      ? {
          expression: dialogueCue.expression ?? state.expression,
          speaking,
          mouthFrame: speaking ? Math.floor((timeMs - dialogueCue.startMs) / 120) % 2 : 0,
          expressionTransition: dialogueCue.transitionMs > 0
            ? clamp((timeMs - dialogueCue.startMs) / dialogueCue.transitionMs)
            : 1
        }
      : { speaking: false, mouthFrame: 0, expressionTransition: 1 };
    return Object.freeze({
      id,
      timeMs,
      ...state,
      ...dialogueState,
      ...samplePose(timeMs),
      ...sampleFacialMotion(timeMs, speaking)
    });
  }

  return Object.freeze({ id, update });
}
