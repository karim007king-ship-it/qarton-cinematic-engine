import { createDOMCharacterRenderer } from "./dom-character-renderer.js";
import { getTimelineEvents } from "../motion/timeline.js";

/**
 * Coordinates platform-neutral character controllers with the DOM sprite
 * renderer and a shared event timeline. The host owns the animation clock.
 */
export function createCharacterStage({
  root,
  resolveSprite,
  characters = [],
  timeline = null,
  onEvent = () => {}
} = {}) {
  if (!Array.isArray(characters)) throw new TypeError("Characters must be an array");
  if (timeline !== null && (!timeline || !Array.isArray(timeline.events))) {
    throw new TypeError("A valid timeline is required");
  }
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function");

  const renderer = createDOMCharacterRenderer({ root, resolveSprite });
  const records = new Map();
  let mounted = false;
  let destroyed = false;
  let lastTimeMs = -1;

  for (const entry of characters) {
    if (!entry || !entry.controller || typeof entry.controller.update !== "function") {
      throw new TypeError("Each character requires a controller");
    }
    const id = entry.controller.id;
    if (typeof id !== "string" || records.has(id)) {
      throw new TypeError("Character controllers need unique ids");
    }
    if (!entry.sprites || typeof entry.sprites !== "object" || Array.isArray(entry.sprites)) {
      throw new TypeError(`Character "${id}" requires a sprite map`);
    }
    records.set(id, { controller: entry.controller, sprites: entry.sprites, handle: null });
  }

  async function mount() {
    if (destroyed) throw new Error("Character stage has been destroyed");
    if (mounted) return false;
    const completed = [];
    try {
      for (const [id, record] of records) {
        const initialState = record.controller.update(0);
        record.handle = await renderer.mount({ id, sprites: record.sprites, initialState });
        completed.push(record);
      }
      mounted = true;
      return true;
    } catch (error) {
      for (const record of completed.reverse()) renderer.unmount(record.handle);
      for (const record of records.values()) record.handle = null;
      throw error;
    }
  }

  async function update(timeMs) {
    if (destroyed) throw new Error("Character stage has been destroyed");
    if (!mounted) throw new Error("Character stage must be mounted before update");
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new TypeError("Stage timeMs must be non-negative and finite");

    const previous = timeMs < lastTimeMs ? -1 : lastTimeMs;
    const updates = [];
    for (const record of records.values()) {
      updates.push(renderer.update(record.handle, record.controller.update(timeMs)));
    }
    if (timeline) {
      for (const event of getTimelineEvents(timeline, { fromMs: previous, toMs: timeMs })) {
        onEvent(event, timeMs);
      }
    }
    lastTimeMs = timeMs;
    return Promise.all(updates);
  }

  function unmount() {
    for (const record of records.values()) {
      if (record.handle) renderer.unmount(record.handle);
      record.handle = null;
    }
    mounted = false;
    lastTimeMs = -1;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderer.destroy();
    for (const record of records.values()) record.handle = null;
    mounted = false;
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
