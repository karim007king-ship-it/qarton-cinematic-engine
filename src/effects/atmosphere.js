import { clamp } from "../motion/easing.js";

/** Resolve render-ready lighting parameters without depending on a renderer. */
export function resolveLighting({
  keyIntensity = 1,
  ambientIntensity = 0.35,
  warmth = 0,
  profile
} = {}) {
  if (![keyIntensity, ambientIntensity, warmth].every(Number.isFinite)) {
    throw new TypeError("Lighting values must be finite numbers");
  }
  const quality = profile?.shadowQuality ?? "full";
  const shadowEnabled = quality !== "none";
  const qualityScale = quality === "none" ? 0 : quality === "simple" ? 0.45 : 1;
  return Object.freeze({
    keyIntensity: clamp(keyIntensity, 0, 4),
    ambientIntensity: clamp(ambientIntensity, 0, 2),
    warmth: clamp(warmth, -1, 1),
    shadowEnabled,
    shadowQuality: quality,
    shadowOpacity: qualityScale * clamp(keyIntensity, 0, 1)
  });
}

/** Sample a fog layer with a deterministic height/time drift. */
export function sampleFog({
  timeMs,
  density = 0.25,
  driftX = 0,
  driftY = 0,
  speed = 0.01,
  profile
} = {}) {
  if (![timeMs, density, driftX, driftY, speed].every(Number.isFinite) || timeMs < 0 || speed < 0) {
    throw new TypeError("Fog parameters must be finite and time/speed non-negative");
  }
  const quality = profile?.tier ?? "high";
  const tierScale = quality === "low" ? 0.35 : quality === "medium" ? 0.7 : 1;
  const t = timeMs / 1000 * speed;
  const offsetX = driftX * t;
  const offsetY = driftY * t;
  if (![t, offsetX, offsetY].every(Number.isFinite)) {
    throw new RangeError("Fog drift exceeded the finite numeric range");
  }
  return Object.freeze({
    density: clamp(density, 0, 1) * tierScale,
    offsetX,
    offsetY,
    animated: quality !== "low" && speed > 0
  });
}
