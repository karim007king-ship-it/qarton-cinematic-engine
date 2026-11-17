/** Compute a stable parallax translation for a scene layer. */
function boundedProduct(factors, maxOffset) {
  if (maxOffset === 0 || factors.some(value => value === 0)) return 0;

  const sign = factors.reduce((result, value) => result * Math.sign(value), 1);
  const magnitudes = factors.map(Math.abs).sort((a, b) => a - b);
  let product = 1;
  for (const magnitude of magnitudes) product *= magnitude;

  if (!Number.isFinite(product) || product >= maxOffset) return sign * maxOffset;
  return sign * product;
}

function limit(value, maxOffset) {
  const bounded = Math.min(maxOffset, Math.max(-maxOffset, value));
  return Object.is(bounded, -0) ? 0 : bounded;
}

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

  return Object.freeze({
    x: limit(boundedProduct([-cameraX, depth, intensity], maxOffset), maxOffset),
    y: limit(boundedProduct([-cameraY, depth, intensity], maxOffset), maxOffset)
  });
}
