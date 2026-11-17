/**
 * Small, host-agnostic asset URL manager.
 * The host supplies the loader (fetch, bundler manifest, native bridge, etc.).
 */
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
    if (this.#pending.has(normalizedKey)) return this.#pending.get(normalizedKey);

    const generation = this.#generation;
    const request = Promise.resolve()
      .then(() => this.#loader(normalizedKey, metadata))
      .then(value => {
        const safeUrl = assertSafeAssetUrl(value, normalizedKey);
        // A per-key release invalidates the pending entry without cancelling
        // the promise already returned to its callers. Only the still-current
        // request may populate the cache.
        if (generation === this.#generation && this.#pending.get(normalizedKey) === request) {
          this.#cache.set(normalizedKey, safeUrl);
        }
        return safeUrl;
      })
      .finally(() => {
        if (this.#pending.get(normalizedKey) === request) this.#pending.delete(normalizedKey);
      });

    this.#pending.set(normalizedKey, request);
    return request;
  }

  /** Resolve a group of keys concurrently; duplicate keys are loaded once. */
  preload(keys) {
    if (!Array.isArray(keys)) return Promise.reject(new TypeError("preload expects an array of asset keys"));
    const normalizedKeys = keys.map(key => typeof key === "string" ? key.trim() : key);
    return Promise.all([...new Set(normalizedKeys)].map(key => this.load(key)));
  }

  /**
   * Release one key and invalidate its in-flight cache write. Existing callers
   * still receive the pending result, but a later load starts a fresh request.
   */
  release(key) {
    const removed = this.#cache.delete(key);
    const normalizedKey = typeof key === "string" ? key.trim() : key;
    const pending = this.#pending.delete(normalizedKey);
    return removed || pending;
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
    // enter while teardown is in progress. Existing callers may still receive
    // their resolved value, but late completions cannot repopulate the cache.
    this.#destroyed = true;
    this.clear();
    this.#loader = null;
  }
}
