/**
 * Small, host-agnostic asset URL manager.
 * The host supplies the loader (fetch, bundler manifest, native bridge, etc.).
 */
function raceWithAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? Object.assign(new Error("Asset load was cancelled"), { name: "AbortError" }));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

function assertSafeAssetUrl(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Asset loader returned no URL for "${key}"`);
  }
  const url = value.trim();
  const hasControlCharacter = [...url].some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (hasControlCharacter || url.includes("\\") || url.startsWith("//") ||
      /^(?:javascript|vbscript|file):/i.test(url)) {
    throw new TypeError(`Asset loader returned an unsafe URL for "${key}"`);
  }
  return url;
}

export class AssetManager {
  #loader;
  #cache = new Map();
  #pending = new Map();
  #generation = 0;
  #destroyed = false;

  constructor({ loader } = {}) {
    if (typeof loader !== "function") {
      throw new TypeError("AssetManager requires a loader function");
    }
    this.#loader = loader;
  }

  /**
   * Load an asset once. Concurrent requests for the same key share one promise.
   * Optional metadata is passed to the loader on the first request only.
   */
  load(key, metadata) {
    if (this.#destroyed) {
      return Promise.reject(new Error("AssetManager has been destroyed"));
    }
    if (typeof key !== "string" || !key.trim()) {
      return Promise.reject(new TypeError("Asset key must be a non-empty string"));
    }
    const normalizedKey = key.trim();
    if (this.#cache.has(normalizedKey)) return Promise.resolve(this.#cache.get(normalizedKey));
    if (this.#pending.has(normalizedKey)) return this.#pending.get(normalizedKey).promise;

    const generation = this.#generation;
    const loader = this.#loader;
    const controller = new AbortController();
    const entry = { controller, promise: null };
    const loaderPromise = Promise.resolve()
      .then(() => {
        if (this.#destroyed || controller.signal.aborted) {
          throw controller.signal.reason ?? Object.assign(new Error("AssetManager has been destroyed"), { name: "AbortError" });
        }
        if (typeof loader !== "function") {
          throw Object.assign(new Error("AssetManager has been destroyed"), { name: "AbortError" });
        }
        return loader(normalizedKey, metadata, { signal: controller.signal });
      });
    // Race the loader against cancellation: a host loader may ignore the
    // signal or never settle, but callers must still be released on teardown.
    const request = raceWithAbort(loaderPromise, controller.signal)
      .then(value => {
        const safeUrl = assertSafeAssetUrl(value, normalizedKey);
        // A per-key release invalidates the pending entry without cancelling
        // the promise already returned to its callers. Only the still-current
        // request may populate the cache.
        if (generation === this.#generation && this.#pending.get(normalizedKey) === entry) {
          this.#cache.set(normalizedKey, safeUrl);
        }
        return safeUrl;
      })
      .finally(() => {
        if (this.#pending.get(normalizedKey) === entry) this.#pending.delete(normalizedKey);
      });

    entry.promise = request;
    this.#pending.set(normalizedKey, entry);
    return request;
  }

  /** Resolve a group of keys concurrently; duplicate keys are loaded once. */
  preload(keys) {
    if (this.#destroyed) return Promise.reject(new Error("AssetManager has been destroyed"));
    if (!Array.isArray(keys)) return Promise.reject(new TypeError("preload expects an array of asset keys"));
    const normalizedKeys = keys.map(key => typeof key === "string" ? key.trim() : key);
    return Promise.all([...new Set(normalizedKeys)].map(key => this.load(key)));
  }

  /**
   * Release one key and invalidate its in-flight cache write. Existing callers
   * still receive the pending result, but a later load starts a fresh request.
   */
  release(key) {
    const normalizedKey = typeof key === "string" ? key.trim() : key;
    const removed = this.#cache.delete(normalizedKey);
    const pending = this.#pending.delete(normalizedKey);
    return removed || pending;
  }

  /**
   * Cancel the shared in-flight request for a key. Every caller awaiting that
   * deduplicated request observes cancellation if the loader honors its signal;
   * loaders that ignore AbortSignal are still prevented from populating cache.
   */
  cancel(key, reason) {
    const normalizedKey = typeof key === "string" ? key.trim() : key;
    const entry = this.#pending.get(normalizedKey);
    if (!entry) return false;
    this.#pending.delete(normalizedKey);
    const abortReason = reason ?? Object.assign(new Error(`Asset load cancelled: "${normalizedKey}"`), { name: "AbortError" });
    entry.controller.abort(abortReason);
    return true;
  }

  /** Drop cached and pending entries; late completions will not repopulate cache. */
  clear() {
    this.#generation += 1;
    this.#cache.clear();
    this.#pending.clear();
  }

  get size() {
    return this.#cache.size;
  }

  get pendingCount() {
    return this.#pending.size;
  }

  destroy() {
    if (this.#destroyed) return;
    // Close the manager before invalidating pending work so no new request can
    // enter while teardown is in progress. AbortSignal releases callers even
    // when a host loader ignores cancellation or never settles.
    const pendingEntries = [...this.#pending.values()];
    this.clear();
    for (const entry of pendingEntries) {
      if (!entry.controller.signal.aborted) {
        const reason = Object.assign(new Error("AssetManager has been destroyed"), { name: "AbortError" });
        entry.controller.abort(reason);
      }
    }
    this.#loader = null;
  }
}
