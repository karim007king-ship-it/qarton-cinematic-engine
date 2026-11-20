/**
 * Optional DOM sprite adapter for character-controller snapshots.
 * Sprite asset resolution is injected so the engine stays independent of
 * asset URLs, bundlers, and application-specific loading systems.
 */
export function createDOMCharacterRenderer({ root, resolveSprite } = {}) {
  if (!root || typeof root.appendChild !== "function" || !root.ownerDocument) {
    throw new TypeError("DOM character renderer requires a root element");
  }
  if (typeof resolveSprite !== "function") {
    throw new TypeError("DOM character renderer requires resolveSprite()");
  }

  let destroyed = false;
  const records = new Map();

  function applyState(record, state) {
    for (const key of ["x", "y", "opacity", "scale", "rotation"]) {
      if (!Number.isFinite(state[key])) throw new TypeError(`Character state ${key} must be finite`);
    }
    if (state.scale < 0) throw new TypeError("Character scale cannot be negative");
    const idle = state.idle ?? {};
    const idleOffsetY = idle.offsetY ?? 0;
    const idleScaleX = idle.scaleX ?? 1;
    const idleScaleY = idle.scaleY ?? 1;
    const blinkScaleY = idle.blinkScaleY ?? 1;
    for (const [key, value] of Object.entries({
      offsetY: idleOffsetY, scaleX: idleScaleX, scaleY: idleScaleY, blinkScaleY
    })) {
      if (!Number.isFinite(value)) throw new TypeError(`Character idle ${key} must be finite`);
    }
    if (idleScaleX < 0 || idleScaleY < 0 || blinkScaleY < 0 || blinkScaleY > 1) {
      throw new TypeError("Character idle scales must be non-negative and blinkScaleY cannot exceed 1");
    }
    record.element.style.transform =
      `translate3d(${state.x}px, ${state.y + idleOffsetY}px, 0) rotate(${state.rotation}deg) scale(${state.scale * idleScaleX}, ${state.scale * idleScaleY})`;
    record.image.style.transformOrigin = "center center";
    record.image.style.transform = `scaleY(${blinkScaleY})`;
    record.element.style.opacity = String(Math.min(1, Math.max(0, state.opacity)));
    record.element.dataset.expression = String(state.expression ?? "neutral");
    record.element.dataset.state = String(state.state ?? "idle");
  }

  function removeElement(handle) {
    let firstError;
    let failed = false;
    try {
      handle.remove?.();
    } catch (error) {
      firstError = error;
      failed = true;
    }
    if (handle.parentNode === root) {
      try {
        root.removeChild(handle);
      } catch (error) {
        // If the fallback detached the element, no resource remains to retry.
        if (handle.parentNode !== root) records.delete(handle);
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  async function resolveAsset(record, expression) {
    const key = record.sprites[expression] ?? record.sprites.default;
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError(`No sprite asset configured for expression "${expression}"`);
    }
    if (record.assetKey === key) {
      // Returning to the already-visible sprite must invalidate any slower
      // request for a different expression that is still in flight.
      record.assetVersion += 1;
      record.pendingAssetKey = null;
      record.pendingAssetPromise = null;
      return true;
    }
    if (record.pendingAssetKey === key && record.pendingAssetPromise) {
      return record.pendingAssetPromise;
    }

    const version = ++record.assetVersion;
    record.pendingAssetKey = key;
    let resolved;
    try {
      // Invoke the injected resolver immediately for predictable host behavior,
      // while converting synchronous throws into the same promise path.
      resolved = resolveSprite(key);
    } catch (error) {
      resolved = Promise.reject(error);
    }
    const pending = Promise.resolve(resolved).then(url => {
      if (destroyed || !records.has(record.element) || version !== record.assetVersion) return false;
      if (typeof url !== "string" || !url.trim()) {
        throw new TypeError(`resolveSprite() returned an invalid URL for "${key}"`);
      }
      record.image.src = url;
      record.image.alt = `${record.id} — ${expression}`;
      record.assetKey = key;
      return true;
    }).catch(error => {
      // Ignore failures from obsolete sprite requests; a newer expression,
      // unmount, or destroy has already superseded this work.
      if (destroyed || !records.has(record.element) || version !== record.assetVersion) return false;
      throw error;
    }).finally(() => {
      if (version === record.assetVersion) {
        record.pendingAssetKey = null;
        record.pendingAssetPromise = null;
      }
    });
    record.pendingAssetPromise = pending;
    return pending;
  }

  async function mount({ id, sprites, initialState = {} } = {}) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Character renderer requires an id");
    if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) {
      throw new TypeError("Character sprites must be an expression-to-asset map");
    }

    const element = root.ownerDocument.createElement("div");
    const image = root.ownerDocument.createElement("img");
    element.className = "qarton-character";
    element.dataset.characterId = id;
    Object.assign(element.style, {
      position: "absolute",
      left: "0",
      top: "0",
      transformOrigin: "center center",
      willChange: "transform, opacity",
      pointerEvents: "none"
    });
    Object.assign(image.style, {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "contain"
    });
    image.draggable = false;
    element.appendChild(image);

    const record = {
      id,
      element,
      image,
      sprites: { ...sprites },
      assetKey: null,
      pendingAssetKey: null,
      pendingAssetPromise: null,
      assetVersion: 0
    };
    const expression = typeof initialState.expression === "string" ? initialState.expression : "neutral";
    records.set(element, record);
    try {
      await resolveAsset(record, expression);
    } catch (error) {
      records.delete(element);
      throw error;
    }
    if (destroyed) {
      records.delete(element);
      throw new Error("DOM character renderer has been destroyed");
    }
    applyState(record, {
      x: Number.isFinite(initialState.x) ? initialState.x : 0,
      y: Number.isFinite(initialState.y) ? initialState.y : 0,
      opacity: Number.isFinite(initialState.opacity) ? initialState.opacity : 1,
      scale: Number.isFinite(initialState.scale) ? initialState.scale : 1,
      rotation: Number.isFinite(initialState.rotation) ? initialState.rotation : 0,
      expression,
      state: initialState.state ?? "idle",
      idle: initialState.idle
    });
    root.appendChild(element);
    return element;
  }

  async function update(handle, state) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    const record = records.get(handle);
    if (!record) return false;
    if (!state || state.id !== record.id) throw new TypeError("Character state id does not match mounted character");
    applyState(record, state);
    return resolveAsset(record, String(state.expression ?? "neutral"));
  }

  function unmount(handle) {
    const record = records.get(handle);
    if (!record) return;
    record.assetVersion += 1;
    record.pendingAssetKey = null;
    record.pendingAssetPromise = null;
    // A fallback root removal may succeed even when Element.remove() throws.
    // Drop ownership once detached, but preserve the original adapter error.
    try {
      removeElement(handle);
      records.delete(handle);
    } catch (error) {
      if (handle.parentNode !== root) records.delete(handle);
      throw error;
    }
  }

  function destroy() {
    // Destruction is terminal for new work, but cleanup remains retryable.
    destroyed = true;
    const active = [...records.entries()];
    for (const [, record] of active) {
      record.assetVersion += 1;
      record.pendingAssetKey = null;
      record.pendingAssetPromise = null;
    }

    let firstError;
    let failed = false;
    for (const [handle] of active) {
      try {
        removeElement(handle);
        records.delete(handle);
      } catch (error) {
        // A fallback removal may detach the node before reporting an error.
        // Release ownership once it is no longer attached to this root.
        if (handle.parentNode !== root) records.delete(handle);
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
