export function clamp(value, min = 0, max = 1) {
  if (![value, min, max].every(Number.isFinite) || min > max) throw new TypeError("clamp expects finite numbers and min <= max");
  return Math.min(max, Math.max(min, value));
}
export function lerp(from, to, progress) {
  if (![from, to, progress].every(Number.isFinite)) throw new TypeError("lerp expects finite numbers");
  return from + (to - from) * clamp(progress);
}
export function easeInOutCubic(progress) {
  const t = clamp(progress);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function scaleDuration(durationMs, profile) {
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError("durationMs must be a non-negative finite number");
  const scale = profile?.animationScale;
  if (!Number.isFinite(scale) || scale < 0) throw new TypeError("profile.animationScale must be a non-negative finite number");
  return Math.round(durationMs * scale);
}
