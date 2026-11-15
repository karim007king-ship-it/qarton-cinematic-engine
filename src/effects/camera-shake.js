/** Deterministic camera shake sample; identical inputs always yield identical output. */
export function sampleCameraShake({
  timeMs,
  durationMs,
  amplitude = 0,
  frequencyHz = 8,
  seed = 1
} = {}) {
  if (![timeMs, durationMs, amplitude, frequencyHz, seed].every(Number.isFinite)) {
    throw new TypeError("Camera shake inputs must be finite numbers");
  }
  if (timeMs < 0 || durationMs <= 0 || amplitude < 0 || frequencyHz < 0) {
    throw new TypeError("Camera shake time, duration, amplitude, or frequency is invalid");
  }
  const progress = Math.min(1, timeMs / durationMs);
  const envelope = 1 - progress;
  const phase = (timeMs / 1000) * frequencyHz * Math.PI * 2;
  return Object.freeze({
    x: Math.sin(phase + seed * 1.17) * amplitude * envelope,
    y: Math.sin(phase * 1.31 + seed * 2.03) * amplitude * 0.72 * envelope,
    rotation: Math.sin(phase * 0.73 + seed * 0.61) * amplitude * 0.035 * envelope
  });
}
