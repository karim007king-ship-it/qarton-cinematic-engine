import { clamp } from "../motion/easing.js";

/**
 * Resolve a renderer-neutral cinematic color treatment into CSS-ready values.
 * The engine never touches the DOM; the host applies the returned styles to
 * its scene viewport and optional overlay layers.
 */
export function resolveVisualTreatment({
  exposure = 0,
  contrast = 1,
  saturation = 1,
  warmth = 0,
  vignette = 0,
  bloom = 0,
  grain = 0,
  profile,
  reducedMotion = false
} = {}) {
  const values = [exposure, contrast, saturation, warmth, vignette, bloom, grain];
  if (!values.every(Number.isFinite)) {
    throw new TypeError("Visual treatment values must be finite numbers");
  }

  const tier = profile?.tier ?? "high";
  const qualityScale = tier === "low" ? 0.25 : tier === "medium" ? 0.65 : 1;
  const safeExposure = clamp(exposure, -1, 1);
  const safeContrast = clamp(contrast, 0, 2);
  const safeSaturation = clamp(saturation, 0, 2);
  const safeWarmth = clamp(warmth, -1, 1);
  const vignetteOpacity = clamp(vignette, 0, 1) * qualityScale;
  const bloomOpacity = clamp(bloom, 0, 1) * qualityScale;
  const grainOpacity = clamp(grain, 0, 1) * qualityScale;

  const filter = [
    `brightness(${(1 + safeExposure * 0.35).toFixed(3)})`,
    `contrast(${safeContrast.toFixed(3)})`,
    `saturate(${safeSaturation.toFixed(3)})`,
    `sepia(${(Math.abs(safeWarmth) * 0.22).toFixed(3)})`
  ].join(" ");

  return Object.freeze({
    filter,
    warmth: safeWarmth,
    warmthTint: safeWarmth < 0 ? "cool" : safeWarmth > 0 ? "warm" : "neutral",
    vignetteOpacity,
    bloomOpacity,
    grainOpacity,
    grainAnimated: grainOpacity > 0 && !reducedMotion && tier !== "low",
    qualityTier: tier
  });
}
