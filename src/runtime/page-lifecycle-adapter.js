const EVENTS = ["visibilitychange", "pagehide", "pageshow"];

/**
 * Bridge browser page lifecycle events to a host-owned activity gate.
 * The engine core remains platform-neutral: the host injects an EventTarget
 * (normally document) and a setActive callback (normally activityGate.setActive).
 */
export function createPageLifecycleAdapter({ target, pageTarget = target, setActive } = {}) {
  const isEventTarget = value => value
    && typeof value.addEventListener === "function"
    && typeof value.removeEventListener === "function";
  if (!isEventTarget(target) || !isEventTarget(pageTarget)) {
    throw new TypeError("Page lifecycle adapter requires document and page EventTargets");
  }
  if (typeof setActive !== "function") {
    throw new TypeError("Page lifecycle adapter requires setActive()");
  }

  let started = false;
  let starting = false;
  let active = null;
  // Track each successfully attached listener so failed startup rollback can
  // be retried through stop() if a host EventTarget refuses removal.
  const attachedListeners = new Set();

  function apply(nextActive) {
    if (active === nextActive) return false;
    // Commit the observed state only after the host accepts the transition.
    // A failed callback can therefore be retried by the next lifecycle event.
    setActive(nextActive);
    active = nextActive;
    return true;
  }

  function sync() {
    return apply(target.visibilityState !== "hidden");
  }

  function handleVisibilityChange() {
    sync();
  }

  function handlePageHide() {
    apply(false);
  }

  function handlePageShow() {
    sync();
  }

  // visibilitychange belongs to Document; pagehide/pageshow belong to Window.
  // Hosts may inject one target for tests/non-browser environments.
  const listeners = [
    [target, "visibilitychange", handleVisibilityChange],
    [pageTarget, "pagehide", handlePageHide],
    [pageTarget, "pageshow", handlePageShow]
  ];

  function start() {
    // setActive() is host code and may re-enter start() or stop(). Do not
    // attach a second listener set while the initial synchronization runs.
    if (started || starting) return false;
    starting = true;
    const attachedThisAttempt = [];
    try {
      for (const entry of listeners) {
        const [eventTarget, type, listener] = entry;
        eventTarget.addEventListener(type, listener);
        attachedListeners.add(entry);
        attachedThisAttempt.push(entry);
      }
      sync();
      // A host callback may have called stop() during sync(). Reflect actual
      // listener ownership rather than resurrecting a stopped adapter.
      started = attachedListeners.size > 0;
      return started;
    } catch (error) {
      const rollbackErrors = [];
      for (const entry of attachedThisAttempt.reverse()) {
        const [eventTarget, type, listener] = entry;
        try {
          eventTarget.removeEventListener(type, listener);
          attachedListeners.delete(entry);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      // A partial rollback is still an active registration that stop() must
      // be able to finish. Do not lose ownership just because start() failed.
      started = attachedListeners.size > 0;
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Page lifecycle startup failed and listener rollback was incomplete"
        );
      }
      throw error;
    } finally {
      starting = false;
    }
  }

  function stop() {
    if (!started && attachedListeners.size === 0) return false;
    const errors = [];
    for (const entry of listeners) {
      if (!attachedListeners.has(entry)) continue;
      const [eventTarget, type, listener] = entry;
      try {
        eventTarget.removeEventListener(type, listener);
        attachedListeners.delete(entry);
      } catch (error) {
        errors.push(error);
      }
    }
    // Keep only listeners that the host refused to remove so stop() can retry.
    started = attachedListeners.size > 0;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Page lifecycle listeners could not all be removed");
    }
    return true;
  }

  return Object.freeze({
    start,
    stop,
    sync,
    getState: () => Object.freeze({ started, active })
  });
}
