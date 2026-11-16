const PROFILES = Object.freeze({
  low: Object.freeze({ tier: "low", maxBackgroundLayers: 2, particleBudget: 0, shadowQuality: "none", animationScale: 0.65, parallaxEnabled: false }),
  medium: Object.freeze({ tier: "medium", maxBackgroundLayers: 4, particleBudget: 24, shadowQuality: "simple", animationScale: 0.85, parallaxEnabled: true }),
  high: Object.freeze({ tier: "high", maxBackgroundLayers: 8, particleBudget: 80, shadowQuality: "full", animationScale: 1, parallaxEnabled: true })
});

/** Resolve a stable rendering profile from injected device hints. No browser globals. */
export function resolveQualityProfile(device = {}) {
  // Accessibility and data-saving constraints take precedence over manual
  // quality hints so callers cannot accidentally re-enable expensive motion.
  if (device.reducedMotion === true || device.saveData === true) {
    return { ...PROFILES.low, reason: device.reducedMotion ? "reduced-motion" : "save-data" };
  }
  const requested = device.quality;
  if (requested && Object.hasOwn(PROFILES, requested)) return { ...PROFILES[requested], reason: "manual" };
  const cores = finiteOr(device.hardwareConcurrency, 4);
  const memory = finiteOr(device.deviceMemory, 4);
  const fps = finiteOr(device.averageFps, 60);
  if (cores <= 4 || memory <= 2 || fps < 42) return { ...PROFILES.low, reason: "device-budget" };
  if (cores >= 8 && memory >= 6 && fps >= 55) return { ...PROFILES.high, reason: "device-capability" };
  return { ...PROFILES.medium, reason: "balanced-default" };
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
