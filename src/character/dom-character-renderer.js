/**
 * Optional DOM sprite adapter for single-image or independently animated
 * character layers. Asset loading is injected by the host application.
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

  function normalizeLayers({ sprites, layers }) {
    if (layers === undefined) {
      if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) {
        throw new TypeError("Character sprites must be an expression-to-asset map");
      }
      return [{ id: "body", role: "body", sprites: { ...sprites }, style: {} }];
    }
    if (!Array.isArray(layers) || layers.length === 0) {
      throw new TypeError("Character layers must be a non-empty array");
    }
    const ids = new Set();
    return layers.map((layer, index) => {
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
        throw new TypeError(`Character layer ${index} must be an object`);
      }
      const layerId = layer.id ?? `layer-${index + 1}`;
      if (typeof layerId !== "string" || !layerId.trim() || ids.has(layerId)) {
        throw new TypeError("Character layer ids must be non-empty and unique");
      }
      if (typeof layer.role !== "string" || !layer.role.trim()) {
        throw new TypeError(`Character layer "${layerId}" requires a role`);
      }
      if (!layer.sprites || typeof layer.sprites !== "object" || Array.isArray(layer.sprites)) {
        throw new TypeError(`Character layer "${layerId}" requires a sprite map`);
      }
      if (layer.style !== undefined && (!layer.style || typeof layer.style !== "object" || Array.isArray(layer.style))) {
        throw new TypeError(`Character layer "${layerId}" style must be an object`);
      }
      ids.add(layerId);
      return { id: layerId, role: layer.role, sprites: { ...layer.sprites }, style: { ...(layer.style ?? {}) } };
    });
  }

  function selectSpriteKey(layer, state) {
    const sprites = layer.sprites;
    if (layer.role === "eyes") {
      return (state.eyeFrame === 1 ? sprites.blink ?? sprites.closed : sprites.open)
        ?? sprites[state.expression] ?? sprites.default;
    }
    if (layer.role === "mouth") {
      if (state.speaking === true) {
        return (state.mouthFrame === 1 ? sprites.speakingOpen : sprites.speakingClosed)
          ?? sprites.speaking ?? sprites[state.expression] ?? sprites.default;
      }
      return sprites.neutral ?? sprites[state.expression] ?? sprites.default;
    }
    return sprites[state.expression] ?? sprites.default;
  }

  function applyState(record, state) {
    for (const key of ["x", "y", "opacity", "scale", "rotation"]) {
      if (!Number.isFinite(state[key])) throw new TypeError(`Character state ${key} must be finite`);
    }
    if (state.scale < 0) throw new TypeError("Character scale cannot be negative");
    const element = record.element;
    const breath = Number.isFinite(state.breathOffsetY) ? state.breathOffsetY : 0;
    const headRotation = Number.isFinite(state.headRotation) ? state.headRotation : 0;
    element.style.transform =
      `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.rotation}deg) scale(${state.scale})`;
    element.style.opacity = String(Math.min(1, Math.max(0, state.opacity)));
    element.dataset.expression = String(state.expression ?? "neutral");
    element.dataset.state = String(state.state ?? "idle");
    element.dataset.pose = String(state.pose ?? "idle");
    element.dataset.poseProgress = String(Number.isFinite(state.poseProgress) ? Math.min(1, Math.max(0, state.poseProgress)) : 0);
    element.dataset.speaking = String(state.speaking === true);
    element.dataset.mouthFrame = String(state.speaking === true && state.mouthFrame === 1 ? 1 : 0);
    element.dataset.expressionTransition = String(
      Number.isFinite(state.expressionTransition)
        ? Math.min(1, Math.max(0, state.expressionTransition))
        : 1
    );
    element.dataset.eyeFrame = String(state.eyeFrame === 1 ? 1 : 0);
    element.style["--qarton-breath-y"] = `${breath}px`;
    element.style["--qarton-head-rotation"] = `${headRotation}deg`;

    return Promise.all(record.layers.map(layerRecord => {
      const { layer, image } = layerRecord;
      image.dataset.layerId = layer.id;
      image.dataset.layerRole = layer.role;
      const poseTransform = state.layerTransforms?.[layer.id]
        ?? state.layerTransforms?.[layer.role]
        ?? {};
      const translateX = Number.isFinite(poseTransform.translateX) ? poseTransform.translateX : 0;
      const translateY = Number.isFinite(poseTransform.translateY) ? poseTransform.translateY : 0;
      const rotation = Number.isFinite(poseTransform.rotation) ? poseTransform.rotation : 0;
      const scaleX = Number.isFinite(poseTransform.scaleX) ? poseTransform.scaleX : 1;
      const scaleY = Number.isFinite(poseTransform.scaleY) ? poseTransform.scaleY : 1;
      if (layer.role === "head" || layer.role === "eyes" || layer.role === "mouth") {
        image.style.transform =
          `translate(${translateX}px, ${translateY + breath}px) rotate(${rotation + headRotation}deg) scale(${scaleX}, ${scaleY})`;
      } else if (layer.role === "body" || layer.role === "torso") {
        image.style.transform =
          `translate(${translateX}px, ${translateY + breath}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
      } else {
        image.style.transform =
          `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
      }
      return resolveLayerAsset(record, layerRecord, state);
    }));
  }

  async function resolveLayerAsset(record, layerRecord, state) {
    const { layer, image } = layerRecord;
    const key = selectSpriteKey(layer, state);
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError(`No sprite asset configured for character layer "${layer.id}"`);
    }
    if (layerRecord.assetKey === key) {
      layerRecord.assetVersion += 1;
      layerRecord.pendingAssetKey = null;
      layerRecord.pendingAssetPromise = null;
      return true;
    }
    if (layerRecord.pendingAssetKey === key && layerRecord.pendingAssetPromise) {
      return layerRecord.pendingAssetPromise;
    }

    const version = ++layerRecord.assetVersion;
    layerRecord.pendingAssetKey = key;
    let resolved;
    try {
      resolved = resolveSprite(key, { characterId: record.id, layerId: layer.id, role: layer.role });
    } catch (error) {
      resolved = Promise.reject(error);
    }
    const pending = Promise.resolve(resolved).then(url => {
      if (destroyed || !records.has(record.element) || version !== layerRecord.assetVersion) return false;
      if (typeof url !== "string" || !url.trim()) {
        throw new TypeError(`resolveSprite() returned an invalid URL for "${key}"`);
      }
      image.src = url;
      image.alt = `${record.id} — ${layer.id} — ${state.expression ?? "neutral"}`;
      layerRecord.assetKey = key;
      return true;
    }).finally(() => {
      if (version === layerRecord.assetVersion) {
        layerRecord.pendingAssetKey = null;
        layerRecord.pendingAssetPromise = null;
      }
    });
    layerRecord.pendingAssetPromise = pending;
    return pending;
  }

  async function mount({ id, sprites, layers, initialState = {} } = {}) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Character renderer requires an id");
    const normalizedLayers = normalizeLayers({ sprites, layers });
    const element = root.ownerDocument.createElement("div");
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

    const layerRecords = normalizedLayers.map(layer => {
      const image = root.ownerDocument.createElement("img");
      image.className = `qarton-character-layer qarton-character-layer--${layer.role}`;
      image.dataset.layerId = layer.id;
      image.dataset.layerRole = layer.role;
      Object.assign(image.style, {
        display: "block",
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
        transformOrigin: ["head", "eyes", "mouth"].includes(layer.role) ? "50% 85%" : "center center"
      }, layer.style);
      image.draggable = false;
      element.appendChild(image);
      return {
        layer, image, assetKey: null, pendingAssetKey: null,
        pendingAssetPromise: null, assetVersion: 0
      };
    });

    const record = { id, element, layers: layerRecords };
    const normalizedState = {
      x: Number.isFinite(initialState.x) ? initialState.x : 0,
      y: Number.isFinite(initialState.y) ? initialState.y : 0,
      opacity: Number.isFinite(initialState.opacity) ? initialState.opacity : 1,
      scale: Number.isFinite(initialState.scale) ? initialState.scale : 1,
      rotation: Number.isFinite(initialState.rotation) ? initialState.rotation : 0,
      expression: typeof initialState.expression === "string" ? initialState.expression : "neutral",
      state: initialState.state ?? "idle",
      pose: typeof initialState.pose === "string" ? initialState.pose : "idle",
      poseProgress: Number.isFinite(initialState.poseProgress) ? initialState.poseProgress : 0,
      layerTransforms: initialState.layerTransforms ?? {},
      speaking: initialState.speaking === true,
      mouthFrame: initialState.mouthFrame === 1 ? 1 : 0,
      eyeFrame: initialState.eyeFrame === 1 ? 1 : 0,
      expressionTransition: Number.isFinite(initialState.expressionTransition) ? initialState.expressionTransition : 1,
      breathOffsetY: Number.isFinite(initialState.breathOffsetY) ? initialState.breathOffsetY : 0,
      headRotation: Number.isFinite(initialState.headRotation) ? initialState.headRotation : 0
    };
    if (normalizedState.scale < 0) throw new TypeError("Character scale cannot be negative");

    records.set(element, record);
    try {
      await applyState(record, normalizedState);
      if (destroyed) throw new Error("DOM character renderer has been destroyed");
      root.appendChild(element);
      return element;
    } catch (error) {
      for (const layerRecord of layerRecords) layerRecord.assetVersion += 1;
      records.delete(element);
      element.remove?.();
      if (element.parentNode === root) root.removeChild(element);
      throw error;
    }
  }

  async function update(handle, state) {
    if (destroyed) throw new Error("DOM character renderer has been destroyed");
    const record = records.get(handle);
    if (!record) return false;
    if (!state || state.id !== record.id) throw new TypeError("Character state id does not match mounted character");
    await applyState(record, state);
    return true;
  }

  function unmount(handle) {
    const record = records.get(handle);
    if (!record) return;
    for (const layerRecord of record.layers) layerRecord.assetVersion += 1;
    records.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const [handle, record] of records) {
      for (const layerRecord of record.layers) layerRecord.assetVersion += 1;
      handle.remove?.();
      if (handle.parentNode === root) root.removeChild(handle);
    }
    records.clear();
  }

  return Object.freeze({ mount, update, unmount, destroy });
}
