/**
 * Clock-driven sprite-sheet sequence sampler.
 * Frame keys refer to assets supplied in the character's sprite map.
 * The host owns scheduling and calls sample() with its shared scene clock.
 */
export function createSpriteFrameAnimation({
  frames,
  frameDurationMs = 100,
  loop = true,
  startTimeMs = 0,
  activeState = "moving",
  idleFrame = null
} = {}) {
  if (!Array.isArray(frames) || frames.length === 0
    || frames.some(frame => typeof frame !== "string" || !frame.trim())) {
    throw new TypeError("Sprite animation frames must be a non-empty array of asset keys");
  }
  if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
    throw new TypeError("frameDurationMs must be a positive finite number");
  }
  if (typeof loop !== "boolean") throw new TypeError("loop must be a boolean");
  if (!Number.isFinite(startTimeMs) || startTimeMs < 0) {
    throw new TypeError("startTimeMs must be a non-negative finite number");
  }
  if (typeof activeState !== "string" || !activeState.trim()) {
    throw new TypeError("activeState must be a non-empty string");
  }
  if (idleFrame !== null && (typeof idleFrame !== "string" || !idleFrame.trim())) {
    throw new TypeError("idleFrame must be a non-empty string or null");
  }

  const frameKeys = Object.freeze([...frames]);
  const durationMs = frameKeys.length * frameDurationMs;

  function sample(timeMs, characterState = {}) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TypeError("Sprite animation timeMs must be non-negative and finite");
    }
    if (!characterState || typeof characterState !== "object" || Array.isArray(characterState)) {
      throw new TypeError("Sprite animation characterState must be an object");
    }

    if (characterState.state !== activeState || timeMs < startTimeMs) {
      return Object.freeze({
        frameKey: idleFrame ?? frameKeys[0],
        frameIndex: idleFrame === null ? 0 : -1,
        playing: false
      });
    }

    const elapsed = timeMs - startTimeMs;
    const completed = Math.floor(elapsed / frameDurationMs);
    const frameIndex = loop
      ? completed % frameKeys.length
      : Math.min(completed, frameKeys.length - 1);
    return Object.freeze({
      frameKey: frameKeys[frameIndex],
      frameIndex,
      playing: loop || elapsed < durationMs
    });
  }

  return Object.freeze({ frames: frameKeys, idleFrame, sample });
}
