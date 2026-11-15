/** Compute a stable parallax translation for a scene layer. */
export function computeParallaxOffset({
  cameraX = 0,
  cameraY = 0,
  depth = 0,
  intensity = 1,
  maxOffset = 100000
} = {}) {
  if (![cameraX, cameraY, depth, intensity, maxOffset].every(Number.isFinite)) {
    throw new TypeError("Parallax inputs must be finite numbers");
  }
  if (intensity < 0 || maxOffset < 0) {
    throw new TypeError("Parallax intensity and maxOffset must be non-negative");
  }
  const limit = value => Math.min(maxOffset, Math.max(-maxOffset, value));
  return Object.freeze({
    x: limit(-cameraX * depth * intensity),
    y: limit(-cameraY * depth * intensity)
  });
}
