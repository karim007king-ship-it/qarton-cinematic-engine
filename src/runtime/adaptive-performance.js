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
  if (!device || typeof device !== "object" || Array.isArray(device)
    || !Number.isInteger(sampleWindow) || sampleWindow < 1
    || !Number.isInteger(stableWindows) || stableWindows < 1
    || !Number.isFinite(downgradeFps) || !Number.isFinite(upgradeFps)
    || downgradeFps <= 0 || upgradeFps <= downgradeFps
    || typeof onProfileChange !== "function") {
    throw new TypeError("Adaptive performance monitor configuration is invalid");
  }

  let locked = device.reducedMotion === true || device.saveData === true;
  let profile = Object.freeze(resolveQualityProfile(device));
  let frames = [];
  let stableCount = 0;
  let stableDirection = null;
  let lastFps = null;
  const pendingNotifications = [];
  let notifying = false;

  function flushNotifications() {
    if (notifying) return;
    notifying = true;
    try {
      while (pendingNotifications.length > 0) {
        const notification = pendingNotifications[0];
        onProfileChange(notification.next, notification.previous);
        // A callback may reset the monitor and enqueue fresh notifications.
        // Remove only the notification that was just delivered, not whatever
        // happens to be first after a re-entrant reset.
        const deliveredIndex = pendingNotifications.indexOf(notification);
        if (deliveredIndex !== -1) pendingNotifications.splice(deliveredIndex, 1);
      }
    } finally {
      notifying = false;
    }
  }

  function evaluate() {
    const averageFrameMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    lastFps = 1000 / averageFrameMs;
    frames = [];
    if (locked) return profile;

    const currentIndex = TIERS.indexOf(profile.tier);
    let nextIndex = currentIndex;
    const direction = lastFps < downgradeFps
      ? "downgrade"
      : lastFps >= upgradeFps
        ? "upgrade"
        : null;

    if (direction === null) {
      stableCount = 0;
      stableDirection = null;
    } else {
      if (direction !== stableDirection) stableCount = 0;
      stableDirection = direction;
      stableCount += 1;
      if (stableCount >= stableWindows) {
        nextIndex = direction === "downgrade"
          ? Math.max(0, currentIndex - 1)
          : Math.min(TIERS.length - 1, currentIndex + 1);
      }
    }

    if (nextIndex !== currentIndex) {
      const previous = profile;
      profile = Object.freeze({
        ...resolveQualityProfile({ quality: TIERS[nextIndex] }),
        reason: "adaptive",
        averageFps: lastFps
      });
      stableCount = 0;
      stableDirection = null;
      pendingNotifications.push({ next: profile, previous });
      flushNotifications();
    }
    return profile;
  }

  function recordFrame(frameDurationMs) {
    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
      throw new TypeError("Frame duration must be a positive finite number");
    }
    // Deliver any previously failed profile-change notifications before
    // accepting more samples, so host quality settings cannot silently lag.
    flushNotifications();
    frames.push(frameDurationMs);
    if (frames.length < sampleWindow) {
      return Object.freeze({ profile, evaluated: false, averageFps: lastFps });
    }
    const next = evaluate();
    return Object.freeze({ profile: next, evaluated: true, averageFps: lastFps });
  }

  function clearSamples() {
    frames = [];
    stableCount = 0;
    stableDirection = null;
    lastFps = null;
    return Object.freeze({ averageFps: lastFps, pendingFrames: frames.length, stableWindows: stableCount });
  }

  function reset(nextDevice = device) {
    if (!nextDevice || typeof nextDevice !== "object" || Array.isArray(nextDevice)) {
      throw new TypeError("Adaptive performance device hints must be an object");
    }
    // A reset starts a new measurement epoch; stale callbacks from the prior
    // device/profile must never be delivered after the reset.
    pendingNotifications.length = 0;
    device = nextDevice;
    locked = device.reducedMotion === true || device.saveData === true;
    profile = Object.freeze(resolveQualityProfile(device));
    frames = [];
    stableCount = 0;
    stableDirection = null;
    lastFps = null;
    return profile;
  }

  return Object.freeze({
    recordFrame,
    getProfile: () => profile,
    getMetrics: () => Object.freeze({ averageFps: lastFps, pendingFrames: frames.length, stableWindows: stableCount }),
    clearSamples,
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
  let destroyPausePending = false;
  function setActive(nextActive) {
    if (destroyed) throw new Error("Runtime activity gate has been destroyed");
    if (typeof nextActive !== "boolean") throw new TypeError("Activity state must be boolean");
    if (active === nextActive) return active;
    // Commit state only after the host callback succeeds, allowing callers to
    // retry a failed pause/resume notification without desynchronizing the gate.
    if (nextActive) onResume();
    else onPause();
    active = nextActive;
    return active;
  }
  function destroy() {
    if (destroyed && !destroyPausePending) return;
    destroyed = true;
    if (active || destroyPausePending) {
      try {
        onPause();
        active = false;
        destroyPausePending = false;
      } catch (error) {
        // The gate stays closed to new work; a later destroy() retries pause.
        destroyPausePending = true;
        throw error;
      }
    }
  }
  return Object.freeze({
    setActive,
    destroy,
    isActive: () => active && !destroyed
  });
}
