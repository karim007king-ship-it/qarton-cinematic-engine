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
  const pendingMounts = new Set();
  let lifecycleVersion = 0;
  let paused = false;
  let destroyed = false;
  let lastTimeMs = -1;
  let eventCursorMs = -1;
  const deliveredEventIds = new Set();
  let destroyPromise = null;
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
        // CharacterStage owns cancellation and rollback for its own pending mount.
        return false;
      }
      mounted = true;
      return true;
    })();
    const tracked = operation.finally(() => {
      if (mountingPromise === tracked) mountingPromise = null;
      pendingMounts.delete(tracked);
    });
    mountingPromise = tracked;
    pendingMounts.add(tracked);
    return tracked;
  }

  async function performUpdate(timeMs, requestedVersion) {
    if (requestedVersion !== lifecycleVersion) return Object.freeze({
      timeMs: lastTimeMs, events: Object.freeze([]), paused
    });
    assertAlive();
    if (!mounted) throw new Error("Cinematic director must be mounted before update");
    if (paused) return Object.freeze({ timeMs: lastTimeMs, events: Object.freeze([]), paused: true });
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TypeError("Director timeMs must be non-negative and finite");
    }

    const version = lifecycleVersion;
    const rewound = timeMs < lastTimeMs;
    if (rewound) {
      audio?.stopAll({ reset: true });
      if (destroyed || !mounted || version !== lifecycleVersion) {
        return Object.freeze({ timeMs: lastTimeMs, events: Object.freeze([]), paused });
      }
      eventCursorMs = -1;
      deliveredEventIds.clear();
    }
    const events = getTimelineEvents(timeline, {
      fromMs: eventCursorMs,
      toMs: timeMs
    });

    // Advance audio and character state before committing the shared clock.
    // Queued frames prevent overlapping updates from racing the same timeline.
    audio?.update(timeMs);
    if (characterStage) await characterStage.update(timeMs);
    if (destroyed || !mounted || version !== lifecycleVersion) {
      return Object.freeze({ timeMs: lastTimeMs, events: Object.freeze([]), paused });
    }
    lastTimeMs = timeMs;

    // Commit an event only after its callback resolves. Failed callbacks remain
    // pending, while already delivered events are not replayed on a retry.
    const dispatchedEvents = [];
    for (const event of events) {
      if (destroyed || !mounted || version !== lifecycleVersion) break;
      if (deliveredEventIds.has(event.id)) continue;
      await onEvent(event, timeMs);
      if (destroyed || !mounted || version !== lifecycleVersion) break;
      deliveredEventIds.add(event.id);
      dispatchedEvents.push(event);
    }
    if (!destroyed && mounted && version === lifecycleVersion) eventCursorMs = timeMs;
    return Object.freeze({
      timeMs: lastTimeMs,
      events: Object.freeze(dispatchedEvents),
      paused
    });
  }

  // Reposition the shared cursor without firing historical events or audio cues.
  function seek(timeMs) {
    const version = lifecycleVersion;
    const operation = updateQueue.then(async () => {
      assertAlive();
      if (version !== lifecycleVersion) return false;
      if (!mounted || !Number.isFinite(timeMs) || timeMs < 0) throw new TypeError("Invalid director seek");
      await characterStage?.update(timeMs);
      if (destroyed || version !== lifecycleVersion) return false;
      if (audio) {
        audio.stopAll({ reset: true });
        audio.resume(timeMs);
        if (paused) audio.pause(timeMs);
      }
      deliveredEventIds.clear();
      lastTimeMs = eventCursorMs = timeMs;
      return true;
    });
    updateQueue = operation.catch(() => {});
    return operation;
  }

  function update(timeMs) {
    const requestedVersion = lifecycleVersion;
    const run = () => performUpdate(timeMs, requestedVersion);
    const operation = updateQueue.then(run, run);
    // A rejected frame must not poison the queue; preserve its rejection for
    // the submitting caller while allowing the next frame to retry.
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
    eventCursorMs = timeMs;
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
    eventCursorMs = timeMs;
    paused = false;
    onResume(timeMs);
    return true;
  }

  function unmount() {
    assertAlive();
    lifecycleVersion += 1;
    // Allow a new mount while the invalidated operation settles in the background.
    mountingPromise = null;
    // Reset shared state before host cleanup so failures cannot leave the
    // director reporting a mounted scene with a partially released stage.
    mounted = false;
    paused = false;
    lastTimeMs = -1;
    eventCursorMs = -1;
    deliveredEventIds.clear();

    let firstError;
    let failed = false;
    for (const cleanup of [
      () => characterStage?.unmount(),
      () => audio?.stopAll({ reset: true })
    ]) {
      try {
        cleanup();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  function destroy() {
    if (destroyPromise) return destroyPromise;
    if (!destroyed) {
      destroyed = true;
      lifecycleVersion += 1;
      mounted = false;
      paused = false;
      lastTimeMs = -1;
      eventCursorMs = -1;
      deliveredEventIds.clear();
    }

    destroyPromise = (async () => {
      const errors = [];
      // Attempt every owned subsystem even if another subsystem fails.
      for (const cleanup of [
        () => characterStage?.destroy(),
        () => audio?.destroy()
      ]) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }

      // Wait for a mount that was already in flight. CharacterStage invalidates
      // it during destroy and performs its own late-mount rollback.
      const pending = [...pendingMounts];
      const settled = await Promise.allSettled(pending);
      for (const result of settled) {
        if (result.status === "rejected") errors.push(result.reason);
      }

      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "One or more cinematic director resources could not be destroyed");
      }
    })().finally(() => {
      // Keep the director closed, but permit another teardown attempt after failure.
      destroyPromise = null;
    });
    return destroyPromise;
  }

  return Object.freeze({
    mount,
    update,
    seek,
    pause,
    resume,
    unmount,
    destroy,
    getState: () => Object.freeze({ mounted, paused, destroyed, timeMs: lastTimeMs })
  });
}
