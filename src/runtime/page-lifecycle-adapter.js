const EVENTS = ["visibilitychange", "pagehide", "pageshow"];

/**
 * Bridge browser page lifecycle events to a host-owned activity gate.
 * The engine core remains platform-neutral: the host injects an EventTarget
 * (normally document) and a setActive callback (normally activityGate.setActive).
 */
export function createPageLifecycleAdapter({ target, setActive } = {}) {
  if (!target || typeof target.addEventListener !== "function"
    || typeof target.removeEventListener !== "function") {
    throw new TypeError("Page lifecycle adapter requires an EventTarget");
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

  const listeners = [
    ["visibilitychange", handleVisibilityChange],
    ["pagehide", handlePageHide],
    ["pageshow", handlePageShow]
  ];

  function start() {
    if (started) return false;
    const attached = [];
    try {
      for (const [type, listener] of listeners) {
        target.addEventListener(type, listener);
        attached.push([type, listener]);
      }
      sync();
      started = true;
      return true;
    } catch (error) {
      for (const [type, listener] of attached.reverse()) {
        try { target.removeEventListener(type, listener); } catch {}
      }
      throw error;
    }
  }

  function stop() {
    if (!started) return false;
    started = false;
    const errors = [];
    for (const [type, listener] of listeners) {
      try {
        target.removeEventListener(type, listener);
      } catch (error) {
        errors.push(error);
      }
    }
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
