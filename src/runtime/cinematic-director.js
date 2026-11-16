import { createTimeline, getTimelineEvents } from "../motion/timeline.js";

/**
 * Synchronize character sampling, audio cues and scene-level events to one
 * host-supplied clock. The host still owns requestAnimationFrame / scheduling.
 *
 * Pass a CharacterStage without its own timeline when using director-level
 * events, so each event is dispatched exactly once.
 */
export function createCinematicDirector({
  characterStage = null,
  audio = null,
  timeline = createTimeline([]),
  onEvent = () => {},
  onPause = () => {},
  onResume = () => {}
} = {}) {
  if (characterStage !== null && (
    typeof characterStage.mount !== "function"
    || typeof characterStage.update !== "function"
    || typeof characterStage.unmount !== "function"
    || typeof characterStage.destroy !== "function"
  )) throw new TypeError("characterStage must implement mount, update, unmount and destroy");
  if (audio !== null && (
    typeof audio.update !== "function"
    || typeof audio.pause !== "function"
    || typeof audio.resume !== "function"
    || typeof audio.stopAll !== "function"
    || typeof audio.destroy !== "function"
  )) throw new TypeError("audio must implement update, pause, resume, stopAll and destroy");
  if (!timeline || !Array.isArray(timeline.events)) throw new TypeError("A valid timeline is required");
  if (![onEvent, onPause, onResume].every(callback => typeof callback === "function")) {
    throw new TypeError("Director callbacks must be functions");
  }

  let mounted = false;
  let mountingPromise = null;
  let lifecycleVersion = 0;
  let paused = false;
  let destroyed = false;
  let lastTimeMs = -1;
  let updateQueue = Promise.resolve();

  function assertAlive() {
    if (destroyed) throw new Error("Cinematic director has been destroyed");
  }

  async function mount() {
    assertAlive();
    if (mounted) return false;
    if (mountingPromise) return mountingPromise;
    const version = ++lifecycleVersion;
    const operation = (async () => {
      if (characterStage) {
        const result = await characterStage.mount();
        if (!result) return false;
      }
      if (destroyed || version !== lifecycleVersion) {
        // unmount()/destroy() already invalidated the stage operation. A late
        // stale completion must never tear down a newer stage mount.
        return false;
      }
      mounted = true;
      return true;
    })();
    const tracked = operation.finally(() => {
      if (mountingPromise === tracked) mountingPromise = null;
    });
    mountingPromise = tracked;
    return tracked;
  }

  async function performUpdate(timeMs) {
    assertAlive();
    if (!mounted) throw new Error("Cinematic director must be mounted before update");
    if (paused) return Object.freeze({ timeMs: lastTimeMs, events: Object.freeze([]), paused: true });
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TypeError("Director timeMs must be non-negative and finite");
    }

    const rewound = timeMs < lastTimeMs;
    if (rewound) audio?.stopAll({ reset: true });
    const events = getTimelineEvents(timeline, {
      fromMs: rewound ? -1 : lastTimeMs,
      toMs: timeMs
    });

    // Commit the clock before callbacks so a callback failure cannot cause
    // already-fired audio cues or timeline events to be dispatched twice.
    lastTimeMs = timeMs;
    const version = lifecycleVersion;
    audio?.update(timeMs);
    if (characterStage) await characterStage.update(timeMs);
    // A pause/unmount/destroy can invalidate an update while the stage is
    // asynchronously applying sprites. Never dispatch stale scene events.
    if (destroyed || version !== lifecycleVersion || !mounted) {
      return Object.freeze({ timeMs, events: Object.freeze([]), paused: false, cancelled: true });
    }
    for (const event of events) onEvent(event, timeMs);
    return Object.freeze({ timeMs, events, paused: false });
  }

  function update(timeMs) {
    assertAlive();
    const operation = updateQueue.then(() => performUpdate(timeMs));
    // Keep the queue usable after a rejected update while preserving the
    // rejection for the caller that submitted that update.
    updateQueue = operation.catch(() => {});
    return operation;
  }

  function pause(timeMs = lastTimeMs) {
    assertAlive();
    if (paused) return false;
    if (!Number.isFinite(timeMs) || timeMs < lastTimeMs) {
      throw new TypeError("Pause time must be finite and not earlier than the director clock");
    }
    audio?.pause(timeMs);
    lastTimeMs = timeMs;
    paused = true;
    onPause(timeMs);
    return true;
  }

  function resume(timeMs = lastTimeMs) {
    assertAlive();
    if (!paused) return false;
    if (!Number.isFinite(timeMs) || timeMs < lastTimeMs) {
      throw new TypeError("Resume time must be finite and not earlier than the director clock");
    }
    audio?.resume(timeMs);
    lastTimeMs = timeMs;
    paused = false;
    onResume(timeMs);
    return true;
  }

  function unmount() {
    assertAlive();
    lifecycleVersion += 1;
    // Do not let an immediately requested remount reuse the invalidated promise.
    mountingPromise = null;
    const errors = [];
    try {
      characterStage?.unmount();
    } catch (error) {
      errors.push(error);
    }
    try {
      audio?.stopAll({ reset: true });
    } catch (error) {
      errors.push(error);
    }
    mounted = false;
    paused = false;
    lastTimeMs = -1;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Cinematic director unmount failed");
  }

  function destroy() {
    if (destroyed) return;
    // Make teardown terminal before invoking host callbacks, then attempt every
    // owned component even if an earlier cleanup operation fails.
    destroyed = true;
    lifecycleVersion += 1;
    const errors = [];
    try {
      characterStage?.destroy();
    } catch (error) {
      errors.push(error);
    }
    try {
      audio?.destroy();
    } catch (error) {
      errors.push(error);
    }
    mounted = false;
    paused = false;
    lastTimeMs = -1;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Cinematic director cleanup failed");
  }

  return Object.freeze({
    mount,
    update,
    pause,
    resume,
    unmount,
    destroy,
    getState: () => Object.freeze({ mounted, paused, destroyed, timeMs: lastTimeMs })
  });
}
