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
  let active = null;

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
    if (started) return false;
    const attached = [];
    try {
      for (const [eventTarget, type, listener] of listeners) {
        eventTarget.addEventListener(type, listener);
        attached.push([eventTarget, type, listener]);
      }
      sync();
      started = true;
      return true;
    } catch (error) {
      const cleanupErrors = [];
      for (const [eventTarget, type, listener] of attached.reverse()) {
        try {
          eventTarget.removeEventListener(type, listener);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      // A partial rollback still owns the listeners that could not be removed.
      // Mark the adapter started so stop() can retry the complete listener set.
      if (cleanupErrors.length > 0) {
        started = true;
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Page lifecycle start failed and listener rollback was incomplete",
          { cause: error }
        );
      }
      throw error;
    }
  }

  function stop() {
    if (!started) return false;
    const errors = [];
    for (const [eventTarget, type, listener] of listeners) {
      try {
        eventTarget.removeEventListener(type, listener);
      } catch (error) {
        errors.push(error);
      }
    }
    // Keep the adapter retryable if even one listener could not be detached.
    // removeEventListener is idempotent, so retrying the complete set is safe.
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Page lifecycle listeners could not all be removed");
    }
    started = false;
    return true;
  }

  return Object.freeze({
    start,
    stop,
    sync,
    getState: () => Object.freeze({ started, active })
  });
}
