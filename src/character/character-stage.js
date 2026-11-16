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
  let mountingPromise = null;
  let lifecycleVersion = 0;
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
    records.set(id, {
      controller: entry.controller,
      sprites: entry.sprites,
      layerSprites: entry.layerSprites ?? {},
      mouthSprites: entry.mouthSprites ?? [],
      eyeSprites: entry.eyeSprites ?? [],
      handle: null
    });
  }

  function releaseCompleted(completed) {
    for (const item of completed.reverse()) {
      renderer.unmount(item.handle);
      if (item.record.handle === item.handle) item.record.handle = null;
    }
  }

  async function performMount(version) {
    const completed = [];
    try {
      for (const [id, record] of records) {
        const initialState = record.controller.update(0);
        const handle = await renderer.mount({
          id,
          sprites: record.sprites,
          layerSprites: record.layerSprites,
          mouthSprites: record.mouthSprites,
          eyeSprites: record.eyeSprites,
          initialState
        });
        if (destroyed || version !== lifecycleVersion) {
          renderer.unmount(handle);
          releaseCompleted(completed);
          return false;
        }
        record.handle = handle;
        completed.push({ record, handle });
      }
      if (destroyed || version !== lifecycleVersion) {
        releaseCompleted(completed);
        return false;
      }
      mounted = true;
      return true;
    } catch (error) {
      releaseCompleted(completed);
      if (destroyed || version !== lifecycleVersion) return false;
      mounted = false;
      throw error;
    }
  }

  function mount() {
    if (destroyed) return Promise.reject(new Error("Character stage has been destroyed"));
    if (mounted) return Promise.resolve(false);
    if (mountingPromise) return mountingPromise;

    const version = ++lifecycleVersion;
    const operation = performMount(version);
    const tracked = operation.finally(() => {
      if (mountingPromise === tracked) mountingPromise = null;
    });
    mountingPromise = tracked;
    return tracked;
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
    lifecycleVersion += 1;
    // Allow an immediate remount to start a fresh operation while the stale
    // asynchronous mount finishes and releases any late handles.
    mountingPromise = null;
    for (const record of records.values()) {
      if (record.handle) renderer.unmount(record.handle);
      record.handle = null;
    }
    mounted = false;
    lastTimeMs = -1;
  }

  function destroy() {
    if (destroyed) return;
    lifecycleVersion += 1;
    destroyed = true;
    renderer.destroy();
    for (const record of records.values()) record.handle = null;
    mounted = false;
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
