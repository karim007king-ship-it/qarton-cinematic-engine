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
  idleAnimations = {},
  walkAnimations = {},
  spriteAnimations = {},
  onEvent = () => {}
} = {}) {
  if (!Array.isArray(characters)) throw new TypeError("Characters must be an array");
  if (timeline !== null && (!timeline || !Array.isArray(timeline.events))) {
    throw new TypeError("A valid timeline is required");
  }
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function");
  if (!idleAnimations || typeof idleAnimations !== "object" || Array.isArray(idleAnimations)) {
    throw new TypeError("idleAnimations must be a character-id-to-animation map");
  }

  if (!walkAnimations || typeof walkAnimations !== "object" || Array.isArray(walkAnimations)) {
    throw new TypeError("walkAnimations must be a character-id-to-animation map");
  }

  if (!spriteAnimations || typeof spriteAnimations !== "object" || Array.isArray(spriteAnimations)) {
    throw new TypeError("spriteAnimations must be a character-id-to-animation map");
  }

  const renderer = createDOMCharacterRenderer({ root, resolveSprite });
  const records = new Map();
  let mounted = false;
  let mountingPromise = null;
  let lifecycleVersion = 0;
  let destroyed = false;
  let lastTimeMs = -1;
  let updateQueue = Promise.resolve();
  const deliveredEventIds = new Set();

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

  const idleByCharacter = new Map();
  for (const [id, animation] of Object.entries(idleAnimations)) {
    if (!records.has(id)) throw new TypeError(`Idle animation references unknown character "${id}"`);
    if (!animation || typeof animation.sample !== "function") {
      throw new TypeError(`Idle animation for "${id}" must implement sample(timeMs)`);
    }
    idleByCharacter.set(id, animation);
  }

  const walkByCharacter = new Map();
  for (const [id, animation] of Object.entries(walkAnimations)) {
    if (!records.has(id)) throw new TypeError(`Walk animation references unknown character "${id}"`);
    if (!animation || typeof animation.sample !== "function") {
      throw new TypeError(`Walk animation for "${id}" must implement sample(timeMs, characterState)`);
    }
    walkByCharacter.set(id, animation);
  }

  const spriteByCharacter = new Map();
  for (const [id, animation] of Object.entries(spriteAnimations)) {
    const record = records.get(id);
    if (!record) throw new TypeError(`Sprite animation references unknown character "${id}"`);
    if (!animation || typeof animation.sample !== "function" || !Array.isArray(animation.frames)) {
      throw new TypeError(`Sprite animation for "${id}" must expose frames and sample(timeMs, characterState)`);
    }
    for (const frameKey of animation.frames) {
      if (!Object.hasOwn(record.sprites, frameKey)) {
        throw new TypeError(`Sprite frame "${frameKey}" is not configured for character "${id}"`);
      }
    }
    spriteByCharacter.set(id, animation);
  }

  function releaseCompleted(completed) {
    let firstError;
    let failed = false;
    for (const item of completed.reverse()) {
      try {
        renderer.unmount(item.handle);
        if (item.record.handle === item.handle) item.record.handle = null;
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  async function performMount(version) {
    const completed = [];
    try {
      for (const [id, record] of records) {
        const sampledState = record.controller.update(0);
        const idleAnimation = idleByCharacter.get(id);
        const walkAnimation = walkByCharacter.get(id);
        const spriteAnimation = spriteByCharacter.get(id);
        const initialState = {
          ...sampledState,
          ...(idleAnimation ? { idle: idleAnimation.sample(0) } : {}),
          ...(walkAnimation ? { walk: walkAnimation.sample(0, sampledState) } : {}),
          ...(spriteAnimation ? { spriteFrame: spriteAnimation.sample(0, sampledState).frameKey } : {})
        };
        const handle = await renderer.mount({ id, sprites: record.sprites, initialState });
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
      let cleanupError;
      try {
        releaseCompleted(completed);
      } catch (failure) {
        cleanupError = failure;
      }
      if (destroyed || version !== lifecycleVersion) {
        if (cleanupError) throw cleanupError;
        return false;
      }
      mounted = false;
      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Character mount failed and rollback cleanup also failed",
          { cause: error }
        );
      }
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

  async function performUpdate(timeMs, requestedVersion) {
    if (requestedVersion !== lifecycleVersion) return false;
    if (destroyed) throw new Error("Character stage has been destroyed");
    if (!mounted) throw new Error("Character stage must be mounted before update");
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new TypeError("Stage timeMs must be non-negative and finite");

    const version = lifecycleVersion;
    const rewound = timeMs < lastTimeMs;
    if (rewound) deliveredEventIds.clear();

    const updates = [];
    for (const [id, record] of records) {
      const sampledState = record.controller.update(timeMs);
      const idleAnimation = idleByCharacter.get(id);
      const walkAnimation = walkByCharacter.get(id);
      const spriteAnimation = spriteByCharacter.get(id);
      const renderState = {
        ...sampledState,
        ...(idleAnimation ? { idle: idleAnimation.sample(timeMs) } : {}),
        ...(walkAnimation ? { walk: walkAnimation.sample(timeMs, sampledState) } : {}),
        ...(spriteAnimation ? { spriteFrame: spriteAnimation.sample(timeMs, sampledState).frameKey } : {})
      };
      updates.push(renderer.update(record.handle, renderState));
    }

    // Serialize frames so concurrent callers cannot dispatch the same event
    // twice or race the renderer's per-character sprite state.
    await Promise.all(updates);
    if (destroyed || !mounted || version !== lifecycleVersion) return false;

    if (timeline) {
      const previous = rewound ? -1 : lastTimeMs;
      for (const event of getTimelineEvents(timeline, { fromMs: previous, toMs: timeMs })) {
        if (destroyed || !mounted || version !== lifecycleVersion) return false;
        if (deliveredEventIds.has(event.id)) continue;
        // Await async host callbacks and commit each event only after success,
        // so a later failed callback can be retried without replaying earlier ones.
        await onEvent(event, timeMs);
        if (destroyed || !mounted || version !== lifecycleVersion) return false;
        deliveredEventIds.add(event.id);
      }
    }
    if (destroyed || !mounted || version !== lifecycleVersion) return false;
    lastTimeMs = timeMs;
    return true;
  }

  function update(timeMs) {
    const requestedVersion = lifecycleVersion;
    const run = () => performUpdate(timeMs, requestedVersion);
    const operation = updateQueue.then(run, run);
    // Keep the queue usable after a rejected frame while preserving that
    // rejection for the caller that submitted it.
    updateQueue = operation.catch(() => {});
    return operation;
  }

  function unmount() {
    lifecycleVersion += 1;
    // Let a fresh mount begin while stale asynchronous work settles.
    mountingPromise = null;
    // Commit the released lifecycle state before calling DOM/host adapters.
    mounted = false;
    lastTimeMs = -1;
    deliveredEventIds.clear();

    let firstError;
    let failed = false;
    for (const record of records.values()) {
      const handle = record.handle;
      record.handle = null;
      if (!handle) continue;
      try {
        renderer.unmount(handle);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  function destroy() {
    if (!destroyed) {
      lifecycleVersion += 1;
      destroyed = true;
      mounted = false;
      lastTimeMs = -1;
      deliveredEventIds.clear();
    }
    // The renderer retains handles whose DOM removal failed; allow teardown retry.
    renderer.destroy();
    for (const record of records.values()) record.handle = null;
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
