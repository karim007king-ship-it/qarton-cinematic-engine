import { clamp } from "../motion/easing.js";

/**
 * Deterministic procedural walk pose. The host supplies the same scene clock
 * used by the character controller; no timers, randomness, or DOM are used.
 */
export function createWalkAnimation({
  stepPeriodMs = 420,
  bobAmplitude = 2,
  strideScale = 0.015,
  phaseOffsetMs = 0
} = {}) {
  if (!Number.isFinite(stepPeriodMs) || stepPeriodMs <= 0) {
    throw new TypeError("stepPeriodMs must be a positive finite number");
  }
  if (!Number.isFinite(bobAmplitude) || bobAmplitude < 0) {
    throw new TypeError("bobAmplitude must be a non-negative finite number");
  }
  if (!Number.isFinite(strideScale) || strideScale < 0 || strideScale > 0.1) {
    throw new TypeError("strideScale must be between 0 and 0.1");
  }
  if (!Number.isFinite(phaseOffsetMs)) {
    throw new TypeError("phaseOffsetMs must be finite");
  }

  function sample(timeMs, characterState = {}) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TypeError("Walk animation timeMs must be non-negative and finite");
    }
    if (!characterState || typeof characterState !== "object" || Array.isArray(characterState)) {
      throw new TypeError("Walk animation characterState must be an object");
    }
    if (characterState.state !== "moving") {
      return Object.freeze({ active: false, offsetY: 0, scaleX: 1, scaleY: 1 });
    }

    const phaseMs = ((timeMs + phaseOffsetMs) % stepPeriodMs + stepPeriodMs) % stepPeriodMs;
    const phase = (phaseMs / stepPeriodMs) * Math.PI * 2;
    const stride = Math.cos(phase) * strideScale;
    const bounce = Math.abs(Math.sin(phase));
    return Object.freeze({
      active: true,
      offsetY: bounce === 0 ? 0 : Number((-bounce * bobAmplitude).toFixed(6)),
      scaleX: Number((1 + stride).toFixed(6)),
      scaleY: Number((1 - stride).toFixed(6))
    });
  }

  return Object.freeze({ sample });
}
