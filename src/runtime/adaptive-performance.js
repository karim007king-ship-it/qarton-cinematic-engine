import { resolveQualityProfile } from "../core/performance-profile.js";

const TIERS = ["low", "medium", "high"];

/**
 * Adaptive quality controller driven by host-supplied frame durations.
 * No timers or browser visibility APIs are accessed by this module.
 */
export function createAdaptivePerformanceMonitor({
  device = {},
  sampleWindow = 30,
  stableWindows = 2,
  downgradeFps = 42,
  upgradeFps = 56,
  onProfileChange = () => {}
} = {}) {
  if (!Number.isInteger(sampleWindow) || sampleWindow < 1
    || !Number.isInteger(stableWindows) || stableWindows < 1
    || !Number.isFinite(downgradeFps) || !Number.isFinite(upgradeFps)
    || downgradeFps <= 0 || upgradeFps <= downgradeFps
    || typeof onProfileChange !== "function") {
    throw new TypeError("Adaptive performance monitor configuration is invalid");
  }

  const locked = device.reducedMotion === true || device.saveData === true;
  let profile = resolveQualityProfile(device);
  let frames = [];
  let stableCount = 0;
  let lastFps = null;

  function evaluate() {
    const averageFrameMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    lastFps = 1000 / averageFrameMs;
    frames = [];
    if (locked) return profile;

    const currentIndex = TIERS.indexOf(profile.tier);
    let nextIndex = currentIndex;
    if (lastFps < downgradeFps) {
      stableCount += 1;
      if (stableCount >= stableWindows) nextIndex = Math.max(0, currentIndex - 1);
    } else if (lastFps >= upgradeFps) {
      stableCount += 1;
      if (stableCount >= stableWindows) nextIndex = Math.min(TIERS.length - 1, currentIndex + 1);
    } else {
      stableCount = 0;
    }

    if (nextIndex !== currentIndex) {
      const previous = profile;
      profile = Object.freeze({
        ...resolveQualityProfile({ quality: TIERS[nextIndex] }),
        reason: "adaptive",
        averageFps: lastFps
      });
      stableCount = 0;
      onProfileChange(profile, previous);
    }
    return profile;
  }

  function recordFrame(frameDurationMs) {
    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
      throw new TypeError("Frame duration must be a positive finite number");
    }
    frames.push(frameDurationMs);
    if (frames.length < sampleWindow) {
      return Object.freeze({ profile, evaluated: false, averageFps: lastFps });
    }
    const next = evaluate();
    return Object.freeze({ profile: next, evaluated: true, averageFps: lastFps });
  }

  function reset(nextDevice = device) {
    device = nextDevice;
    profile = resolveQualityProfile(device);
    frames = [];
    stableCount = 0;
    lastFps = null;
    return profile;
  }

  return Object.freeze({
    recordFrame,
    getProfile: () => profile,
    getMetrics: () => Object.freeze({ averageFps: lastFps, pendingFrames: frames.length, stableWindows: stableCount }),
    reset
  });
}

/** Explicit host-controlled activity gate for pausing hidden/inactive scenes. */
export function createRuntimeActivityGate({ onPause = () => {}, onResume = () => {} } = {}) {
  if (typeof onPause !== "function" || typeof onResume !== "function") {
    throw new TypeError("Activity gate callbacks must be functions");
  }
  let active = true;
  let destroyed = false;
  function setActive(nextActive) {
    if (destroyed) throw new Error("Runtime activity gate has been destroyed");
    if (typeof nextActive !== "boolean") throw new TypeError("Activity state must be boolean");
    if (active === nextActive) return active;
    active = nextActive;
    if (active) onResume();
    else onPause();
    return active;
  }
  function destroy() {
    if (destroyed) return;
    if (active) onPause();
    active = false;
    destroyed = true;
  }
  return Object.freeze({
    setActive,
    destroy,
    isActive: () => active && !destroyed
  });
}
