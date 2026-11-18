/** Clone and freeze JSON-like event data so caller mutations cannot alter a timeline. */
function snapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(snapshot(item, seen));
    return Object.freeze(copy);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const copy = Object.create(prototype);
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = snapshot(value[key], seen);
  }
  return Object.freeze(copy);
}

/** Build an immutable, deterministically ordered event timeline. */
export function createTimeline(events) {
  if (!Array.isArray(events)) throw new TypeError("Timeline events must be an array");
  const ids = new Set();
  const normalized = events.map((event, index) => {
    if (!event || typeof event !== "object") throw new TypeError(`Timeline event ${index} must be an object`);
    if (typeof event.id !== "string" || !event.id.trim() || ids.has(event.id)) {
      throw new TypeError(`Timeline event ${index} needs a unique id`);
    }
    if (!Number.isFinite(event.atMs) || event.atMs < 0) {
      throw new TypeError(`Timeline event "${event.id}" needs a non-negative atMs`);
    }
    if (typeof event.type !== "string" || !event.type.trim()) {
      throw new TypeError(`Timeline event "${event.id}" needs a type`);
    }
    ids.add(event.id);
    return Object.freeze({
      id: event.id,
      atMs: event.atMs,
      type: event.type,
      target: event.target ?? null,
      payload: event.payload === undefined ? null : snapshot(event.payload),
      order: index
    });
  }).sort((a, b) => a.atMs - b.atMs || a.order - b.order)
    .map(({ order, ...event }) => Object.freeze(event));
  return Object.freeze({
    events: Object.freeze(normalized),
    durationMs: normalized.reduce((max, event) => Math.max(max, event.atMs), 0)
  });
}

/** Return events in the forward interval (fromMs, toMs], preserving stable order. */
export function getTimelineEvents(timeline, { fromMs = -1, toMs } = {}) {
  if (!timeline || !Array.isArray(timeline.events)) throw new TypeError("A valid timeline is required");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new TypeError("Timeline range requires finite fromMs <= toMs");
  }
  return timeline.events.filter(event => event.atMs > fromMs && event.atMs <= toMs);
}
