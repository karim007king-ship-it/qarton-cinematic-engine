const TRANSFORM_DEFAULTS = Object.freeze({
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1
});

const TRANSFORM_KEYS = Object.keys(TRANSFORM_DEFAULTS);

function normalizeTransform(transform, layerId) {
  if (transform === undefined) return Object.freeze({ ...TRANSFORM_DEFAULTS });
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
    throw new TypeError(`Rig layer "${layerId}" transform must be an object`);
  }
  const normalized = {};
  for (const key of TRANSFORM_KEYS) {
    const value = transform[key] ?? TRANSFORM_DEFAULTS[key];
    if (!Number.isFinite(value) || (key.startsWith("scale") && value < 0)) {
      throw new TypeError(`Rig layer "${layerId}" has an invalid ${key}`);
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

/**
 * Validate and freeze a parent-child character rig.
 * Parent transforms are local to their parent; layer order remains the
 * supplied order so existing painter-order assumptions stay predictable.
 */
export function createCharacterRig(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new TypeError("Character rig layers must be a non-empty array");
  }
  const byId = new Map();
  const normalized = layers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new TypeError(`Rig layer ${index} must be an object`);
    }
    const id = layer.id;
    if (typeof id !== "string" || !id.trim() || byId.has(id)) {
      throw new TypeError("Rig layer ids must be non-empty and unique");
    }
    if (layer.parent !== undefined && (typeof layer.parent !== "string" || !layer.parent.trim())) {
      throw new TypeError(`Rig layer "${id}" parent must be a non-empty id`);
    }
    const item = Object.freeze({
      ...layer,
      id,
      parent: layer.parent ?? null,
      transform: normalizeTransform(layer.transform, id)
    });
    byId.set(id, item);
    return item;
  });

  for (const layer of normalized) {
    if (layer.parent && !byId.has(layer.parent)) {
      throw new TypeError(`Rig layer "${layer.id}" references missing parent "${layer.parent}"`);
    }
    if (layer.parent === layer.id) {
      throw new TypeError(`Rig layer "${layer.id}" cannot parent itself`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new TypeError(`Character rig contains a parent cycle at "${id}"`);
    if (visited.has(id)) return;
    visiting.add(id);
    const layer = byId.get(id);
    if (layer.parent) visit(layer.parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const layer of normalized) visit(layer.id);

  const children = new Map(normalized.map(layer => [layer.id, []]));
  const roots = [];
  for (const layer of normalized) {
    if (layer.parent) children.get(layer.parent).push(layer.id);
    else roots.push(layer.id);
  }

  return Object.freeze({
    layers: Object.freeze(normalized),
    roots: Object.freeze(roots),
    children: Object.freeze(Object.fromEntries(
      [...children].map(([id, ids]) => [id, Object.freeze(ids)])
    ))
  });
}

/**
 * Compose local rig transforms into deterministic world-space transforms.
 * This uses a 2D affine matrix so rotation and non-uniform scale are handled
 * correctly when transforms are nested.
 */
export function composeRigTransforms(rig, animatedTransforms = {}) {
  if (!rig || !Array.isArray(rig.layers)) throw new TypeError("A normalized character rig is required");
  if (!animatedTransforms || typeof animatedTransforms !== "object" || Array.isArray(animatedTransforms)) {
    throw new TypeError("Animated rig transforms must be an object");
  }

  const world = {};
  const identity = [1, 0, 0, 1, 0, 0];
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
  const matrixFor = transform => {
    const radians = transform.rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return [
      cosine * transform.scaleX,
      sine * transform.scaleX,
      -sine * transform.scaleY,
      cosine * transform.scaleY,
      transform.translateX,
      transform.translateY
    ];
  };
  const visit = (id, parentMatrix) => {
    const layer = rig.layers.find(item => item.id === id);
    const animated = animatedTransforms[id] ?? {};
    if (!animated || typeof animated !== "object" || Array.isArray(animated)) {
      throw new TypeError(`Animated transform for "${id}" must be an object`);
    }
    const local = { ...layer.transform };
    for (const key of TRANSFORM_KEYS) {
      if (animated[key] !== undefined) {
        if (!Number.isFinite(animated[key]) || (key.startsWith("scale") && animated[key] < 0)) {
          throw new TypeError(`Animated transform for "${id}" has an invalid ${key}`);
        }
        local[key] = key.startsWith("scale")
          ? layer.transform[key] * animated[key]
          : layer.transform[key] + animated[key];
      }
    }
    const matrix = multiply(parentMatrix, matrixFor(local));
    world[id] = Object.freeze({
      translateX: matrix[4],
      translateY: matrix[5],
      rotation: Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI,
      scaleX: Math.hypot(matrix[0], matrix[1]),
      scaleY: Math.hypot(matrix[2], matrix[3])
    });
    for (const childId of rig.children[id] ?? []) visit(childId, matrix);
  };
  for (const rootId of rig.roots) visit(rootId, identity);
  return Object.freeze(world);
}
