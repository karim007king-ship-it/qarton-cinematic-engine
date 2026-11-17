const VALID_ROLES = new Set(["background", "midground", "foreground", "character", "overlay"]);
export function createSceneDefinition(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("Scene config must be an object");
  if (typeof config.id !== "string" || !config.id.trim()) throw new TypeError("Scene id is required");
  if (!Array.isArray(config.layers)) throw new TypeError("Scene layers must be an array");
  const sceneId = config.id.trim();
  const ids = new Set();
  const layers = config.layers.map((layer, index) => {
    if (!layer || typeof layer !== "object") throw new TypeError(`Layer at index ${index} must be an object`);
    const layerId = typeof layer.id === "string" ? layer.id.trim() : "";
    const asset = typeof layer.asset === "string" ? layer.asset.trim() : "";
    if (!layerId || ids.has(layerId)) throw new TypeError(`Layer at index ${index} needs a unique id`);
    if (!VALID_ROLES.has(layer.role)) throw new TypeError(`Layer "${layerId}" has an unsupported role`);
    if (!asset) throw new TypeError(`Layer "${layerId}" needs an asset key`);
    ids.add(layerId);
    return Object.freeze({
      id: layerId, role: layer.role, asset,
      depth: Number.isFinite(layer.depth) ? layer.depth : 0,
      opacity: Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1
    });
  });
  return Object.freeze({
    id: sceneId,
    durationMs: Number.isFinite(config.durationMs) && config.durationMs >= 0 ? config.durationMs : 0,
    layers: Object.freeze(layers)
  });
}
