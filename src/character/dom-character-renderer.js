/**
 * Optional DOM sprite adapter for character-controller snapshots.
 * Layer and facial-part assets are positioned by host CSS; this adapter owns
 * deterministic state-to-transform mapping and asset lifecycle only.
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

  async function loadPart(key, label) {
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError(`Character asset key for "${label}" must be a non-empty string`);
    }
    const url = await resolveSprite(key);
    if (typeof url !== "string" || !url.trim()) {
      throw new TypeError(`resolveSprite() returned an invalid URL for "${key}"`);
    }
    return url;
  }

  function applyState(record, state) {
    for (const key of ["x", "y", "opacity", "scale", "rotation"]) {
      if (!Number.isFinite(state[key])) throw new TypeError(`Character state ${key} must be finite`);
    }
    if (state.scale < 0) throw new TypeError("Character scale cannot be negative");
    for (const [layerId, transform] of Object.entries(state.layerTransforms ?? {})) {
      const scaleX = Number.isFinite(transform?.scaleX) ? transform.scaleX : 1;
      const scaleY = Number.isFinite(transform?.scaleY) ? transform.scaleY : 1;
      if (scaleX < 0 || scaleY < 0) {
        throw new TypeError(`Character layer "${layerId}" scale cannot be negative`);
      }
    }
    const element = record.element;
    element.style.transform =
      `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.rotation}deg) scale(${state.scale})`;
    element.style.opacity = String(Math.min(1, Math.max(0, state.opacity)));
    element.dataset.expression = String(state.expression ?? "neutral");
    element.dataset.state = String(state.state ?? "idle");
    element.dataset.pose = String(state.pose ?? "idle");
    element.dataset.speaking = String(state.speaking === true);
    element.dataset.expressionTransition = String(
      Number.isFinite(state.expressionTransition) ? Math.min(1, Math.max(0, state.expressionTransition)) : 1
    );

    record.image.style.transform =
      `translate3d(0px, ${Number.isFinite(state.breathOffsetY) ? state.breathOffsetY : 0}px, 0) rotate(${Number.isFinite(state.headRotation) ? state.headRotation : 0}deg)`;

    for (const [layerId, layer] of record.layers) {
      const transform = state.layerTransforms?.[layerId] ?? {};
      const x = Number.isFinite(transform.translateX) ? transform.translateX : 0;
      const y = Number.isFinite(transform.translateY) ? transform.translateY : 0;
      const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;
      const scaleX = Number.isFinite(transform.scaleX) ? transform.scaleX : 1;
      const scaleY = Number.isFinite(transform.scaleY) ? transform.scaleY : 1;
      layer.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
    }

    const mouthFrame = Number.isInteger(state.mouthFrame) && state.mouthFrame >= 0
      ? state.mouthFrame : 0;
    for (const [index, part] of record.mouthFrames.entries()) {
      part.style.display = state.speaking === true && index === mouthFrame % record.mouthFrames.length
        ? "block" : "none";
    }
    const eyeFrame = Number.isInteger(state.eyeFrame) && state.eyeFrame >= 0
      ? state.eyeFrame : 0;
    for (const [index, part] of record.eyeFrames.entries()) {
      part.style.display = index === eyeFrame % record.eyeFrames.length ? "block" : "none";
    }
  }

  async function resolveExpression(record, expression) {
    const key = record.sprites[expression] ?? record.sprites.default;
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError(`No sprite asset configured for expression "${expression}"`);
    }
    if (record.assetKey === key) {
      record.assetVersion += 1;
      record.pendingAssetKey = null;
      record.pendingAssetPromise = null;
      return true;
    }
    if (record.pendingAssetKey === key && record.pendingAssetPromise) return record.pendingAssetPromise;

    const version = ++record.assetVersion;
    record.pendingAssetKey = key;
    const pending = loadPart(key, expression).then(url => {
      if (destroyed || !records.has(record.element) || version !== record.assetVersion) return false;
      record.image.src = url;
      record.image.alt = `${record.id} — ${expression}`;
      record.assetKey = key;
      return true;
    }).finally(() => {
      if (version === record.assetVersion) {
        record.pendingAssetKey = null;
        record.pendingAssetPromise = null;
      }
    });
    record.pendingAssetPromise = pending;
    return pending;
  }

  async function mount({
    id, sprites, layerSprites = {}, mouthSprites = [], eyeSprites = [], initialState = {}
  } = {}) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Character renderer requires an id");
    if ([...records.values()].some(record => record.id === id)) {
      throw new TypeError(`Character renderer already has a mounted or mounting character with id "${id}"`);
    }
    if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) {
      throw new TypeError("Character sprites must be an expression-to-asset map");
    }
    if (!layerSprites || typeof layerSprites !== "object" || Array.isArray(layerSprites)) {
      throw new TypeError("Character layerSprites must be a layer-to-asset map");
    }
    if (!Array.isArray(mouthSprites) || !Array.isArray(eyeSprites)) {
      throw new TypeError("Character mouthSprites and eyeSprites must be arrays");
    }

    const document = root.ownerDocument;
    const element = document.createElement("div");
    const image = document.createElement("img");
    element.className = "qarton-character";
    element.dataset.characterId = id;
    Object.assign(element.style, {
      position: "absolute", left: "0", top: "0",
      transformOrigin: "center center", willChange: "transform, opacity",
      pointerEvents: "none"
    });
    Object.assign(image.style, {
      display: "block", width: "100%", height: "100%", objectFit: "contain"
    });
    image.className = "qarton-character-base";
    image.draggable = false;
    element.appendChild(image);

    const record = {
      id, element, image, sprites: { ...sprites },
      assetKey: null, pendingAssetKey: null, pendingAssetPromise: null, assetVersion: 0,
      layers: new Map(), mouthFrames: [], eyeFrames: []
    };
    records.set(element, record);

    try {
      const expression = typeof initialState.expression === "string" ? initialState.expression : "neutral";
      await resolveExpression(record, expression);
      if (destroyed || !records.has(element)) throw new Error("DOM character renderer has been destroyed");
      for (const [layerId, key] of Object.entries(layerSprites)) {
        const part = document.createElement("img");
        part.className = "qarton-character-layer";
        part.dataset.layerId = layerId;
        part.draggable = false;
        Object.assign(part.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" });
        const url = await loadPart(key, `layer:${layerId}`);
        if (destroyed || !records.has(element)) throw new Error("DOM character renderer has been destroyed");
        part.src = url;
        element.appendChild(part);
        record.layers.set(layerId, part);
      }
      for (const [kind, keys, target] of [
        ["mouth", mouthSprites, record.mouthFrames],
        ["eyes", eyeSprites, record.eyeFrames]
      ]) {
        for (let index = 0; index < keys.length; index += 1) {
          const part = document.createElement("img");
          part.className = `qarton-character-${kind}`;
          part.dataset.frame = String(index);
          part.draggable = false;
          Object.assign(part.style, {
            position: "absolute", inset: "0", width: "100%", height: "100%",
            objectFit: "contain", display: "none"
          });
          const url = await loadPart(keys[index], `${kind}:${index}`);
          if (destroyed || !records.has(element)) throw new Error("DOM character renderer has been destroyed");
          part.src = url;
          element.appendChild(part);
          target.push(part);
        }
      }
      if (destroyed || !records.has(element)) throw new Error("DOM character renderer has been destroyed");
      applyState(record, {
        x: Number.isFinite(initialState.x) ? initialState.x : 0,
        y: Number.isFinite(initialState.y) ? initialState.y : 0,
        opacity: Number.isFinite(initialState.opacity) ? initialState.opacity : 1,
        scale: Number.isFinite(initialState.scale) ? initialState.scale : 1,
        rotation: Number.isFinite(initialState.rotation) ? initialState.rotation : 0,
        expression,
        state: initialState.state ?? "idle",
        pose: initialState.pose ?? "idle",
        speaking: initialState.speaking === true,
        mouthFrame: initialState.mouthFrame ?? 0,
        eyeFrame: initialState.eyeFrame ?? 0,
        breathOffsetY: initialState.breathOffsetY ?? 0,
        headRotation: initialState.headRotation ?? 0,
        layerTransforms: initialState.layerTransforms ?? {}
      });
      root.appendChild(element);
      return element;
    } catch (error) {
      records.delete(element);
      record.assetVersion += 1;
      throw error;
    }
  }

  async function update(handle, state) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    const record = records.get(handle);
    if (!record) return false;
    if (!state || state.id !== record.id) {
      throw new TypeError("Character state id does not match mounted character");
    }
    applyState(record, state);
    return resolveExpression(record, String(state.expression ?? "neutral"));
  }

  function unmount(handle) {
    const record = records.get(handle);
    if (!record) return;
    record.assetVersion += 1;
    record.pendingAssetKey = null;
    record.pendingAssetPromise = null;
    records.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
  }

  function cancelMount(id) {
    const entry = [...records.entries()].find(([, record]) => record.id === id);
    if (!entry) return false;
    const [handle, record] = entry;
    record.assetVersion += 1;
    record.pendingAssetKey = null;
    record.pendingAssetPromise = null;
    records.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const [handle, record] of records) {
      record.assetVersion += 1;
      record.pendingAssetKey = null;
      record.pendingAssetPromise = null;
      handle.remove?.();
      if (handle.parentNode === root) root.removeChild(handle);
    }
    records.clear();
  }

  return Object.freeze({ mount, update, unmount, cancelMount, destroy });
}
