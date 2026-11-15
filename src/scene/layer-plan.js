const ROLE_ORDER = Object.freeze({ background: 0, midground: 1, character: 2, foreground: 3, overlay: 4 });

/**
 * Build a deterministic render order without touching the DOM or loading assets.
 * Background and midground layers share the device's background-layer budget.
 */
export function buildLayerPlan(scene, profile) {
  if (!scene || !Array.isArray(scene.layers)) throw new TypeError("A valid scene definition is required");
  const budget = profile?.maxBackgroundLayers;
  if (!Number.isInteger(budget) || budget < 0) throw new TypeError("profile.maxBackgroundLayers must be a non-negative integer");

  const ordered = scene.layers.map((layer, index) => ({ ...layer, sourceIndex: index }))
    .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (a.depth - b.depth) || (a.sourceIndex - b.sourceIndex));

  let backgroundCount = 0;
  const planned = [];
  for (const layer of ordered) {
    const isBackground = layer.role === "background" || layer.role === "midground";
    if (isBackground && backgroundCount >= budget) continue;
    if (isBackground) backgroundCount += 1;
    const { sourceIndex, ...entry } = layer;
    planned.push(Object.freeze(entry));
  }
  return Object.freeze(planned);
}
