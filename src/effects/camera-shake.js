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
  if (progress >= 1 || amplitude === 0) return Object.freeze({ x: 0, y: 0, rotation: 0 });
  const envelope = 1 - progress;
  const phase = (timeMs / 1000) * frequencyHz * Math.PI * 2;
  const phaseX = phase + seed * 1.17;
  const phaseY = phase * 1.31 + seed * 2.03;
  const phaseRotation = phase * 0.73 + seed * 0.61;
  if (![phase, phaseX, phaseY, phaseRotation].every(Number.isFinite)) {
    throw new RangeError("Camera shake phase calculation exceeded the finite numeric range");
  }
  const sample = {
    x: Math.sin(phaseX) * amplitude * envelope,
    y: Math.sin(phaseY) * amplitude * 0.72 * envelope,
    rotation: Math.sin(phaseRotation) * amplitude * 0.035 * envelope
  };
  if (!Object.values(sample).every(Number.isFinite)) {
    throw new RangeError("Camera shake output exceeded the finite numeric range");
  }
  return Object.freeze(sample);
}
