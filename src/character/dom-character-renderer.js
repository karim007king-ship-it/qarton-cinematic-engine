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
    record.element.style.transform =
      `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.rotation}deg) scale(${state.scale})`;
    record.element.style.opacity = String(Math.min(1, Math.max(0, state.opacity)));
    record.element.dataset.expression = String(state.expression ?? "neutral");
    record.element.dataset.state = String(state.state ?? "idle");
  }

  async function resolveAsset(record, expression) {
    const key = record.sprites[expression] ?? record.sprites.default;
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError(`No sprite asset configured for expression "${expression}"`);
    }
    if (record.assetKey === key) return true;
    const version = ++record.assetVersion;
    const url = await resolveSprite(key);
    if (destroyed || !records.has(record.element) || version !== record.assetVersion) return false;
    if (typeof url !== "string" || !url.trim()) {
      throw new TypeError(`resolveSprite() returned an invalid URL for "${key}"`);
    }
    record.image.src = url;
    record.image.alt = `${record.id} — ${expression}`;
    record.assetKey = key;
    return true;
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
      state: initialState.state ?? "idle"
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
    records.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const handle of records.keys()) {
      handle.remove?.();
      if (handle.parentNode === root) root.removeChild(handle);
    }
    records.clear();
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
