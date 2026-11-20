/**
 * Deterministic idle animation sampler for anime-style 2D characters.
 * The host supplies its own clock and renderer; this module has no DOM,
 * timers, random numbers, or automatic side effects.
 */
export function createIdleAnimation({
  periodMs = 3200,
  bobAmplitude = 2,
  swayAmplitude = 0.006,
  blinkIntervalMs = 4200,
  blinkDurationMs = 140,
  blinkAmount = 0.92,
  phaseOffsetMs = 0
} = {}) {
  const positive = (value, name) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive finite number`);
    }
  };
  positive(periodMs, "periodMs");
  positive(blinkIntervalMs, "blinkIntervalMs");
  positive(blinkDurationMs, "blinkDurationMs");
  if (blinkDurationMs >= blinkIntervalMs) {
    throw new TypeError("blinkDurationMs must be shorter than blinkIntervalMs");
  }
  if (!Number.isFinite(bobAmplitude) || bobAmplitude < 0) {
    throw new TypeError("bobAmplitude must be a non-negative finite number");
  }
  if (!Number.isFinite(swayAmplitude) || swayAmplitude < 0 || swayAmplitude > 0.1) {
    throw new TypeError("swayAmplitude must be between 0 and 0.1");
  }
  if (!Number.isFinite(blinkAmount) || blinkAmount < 0 || blinkAmount > 1) {
    throw new TypeError("blinkAmount must be between 0 and 1");
  }
  if (!Number.isFinite(phaseOffsetMs)) {
    throw new TypeError("phaseOffsetMs must be finite");
  }

  const tau = Math.PI * 2;
  return Object.freeze({
    sample(timeMs) {
      if (!Number.isFinite(timeMs) || timeMs < 0) {
        throw new TypeError("Idle animation timeMs must be non-negative and finite");
      }
      const phase = ((timeMs + phaseOffsetMs) % periodMs) / periodMs;
      const breath = Math.sin(phase * tau);
      const blinkPhase = ((timeMs + phaseOffsetMs) % blinkIntervalMs);
      const blinking = blinkPhase < blinkDurationMs;
      const blinkProgress = blinking ? blinkPhase / blinkDurationMs : 0;
      const blinkCurve = blinking ? Math.sin(Math.PI * blinkProgress) : 0;
      return Object.freeze({
        offsetY: -bobAmplitude * (0.5 - 0.5 * breath),
        scaleX: 1 + swayAmplitude * breath,
        scaleY: 1 - swayAmplitude * 0.5 * breath,
        blinkScaleY: 1 - blinkAmount * blinkCurve,
        blinking
      });
    }
  });
}
