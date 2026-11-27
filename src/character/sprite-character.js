export const CHARACTER_LAYER_LAYOUTS = Object.freeze({
  body: Object.freeze({ x: 0.5, y: 0.68, width: 0.86, height: 0.66, pivotX: 0.5, pivotY: 0.1, z: 0 }),
  hand_left: Object.freeze({ x: 0.31, y: 0.56, width: 0.25, height: 0.22, pivotX: 0.5, pivotY: 0.1, z: 2 }),
  hand_right: Object.freeze({ x: 0.69, y: 0.56, width: 0.25, height: 0.22, pivotX: 0.5, pivotY: 0.1, z: 2 }),
  head: Object.freeze({ x: 0.5, y: 0.27, width: 0.4, height: 0.34, pivotX: 0.5, pivotY: 0.86, z: 3 }),
  eyes: Object.freeze({ x: 0.5, y: 0.267, width: 0.28, height: 0.09, pivotX: 0.5, pivotY: 0.5, z: 5 }),
  brows: Object.freeze({ x: 0.5, y: 0.224, width: 0.28, height: 0.07, pivotX: 0.5, pivotY: 0.5, z: 6 }),
  mouth: Object.freeze({ x: 0.5, y: 0.342, width: 0.13, height: 0.07, pivotX: 0.5, pivotY: 0.5, z: 7 }),
  hair_back: Object.freeze({ x: 0.5, y: 0.24, width: 0.49, height: 0.46, pivotX: 0.5, pivotY: 0.75, z: 2 }),
  hair_front: Object.freeze({ x: 0.5, y: 0.17, width: 0.46, height: 0.3, pivotX: 0.5, pivotY: 0.9, z: 8 }),
  full: Object.freeze({ x: 0.5, y: 0.5, width: 1, height: 1, pivotX: 0.5, pivotY: 0.5, z: 0 })
});

const VALID_ROLES = new Set(Object.keys(CHARACTER_LAYER_LAYOUTS));
const VALID_VARIANTS = new Set(["neutral", "happy", "sad", "angry", "afraid", "surprised", "thinking", "determined", "front", "side", "pose1", "pose2", "open", "round", "wide", "teeth", "closed", "rest"]);
export const MAX_IMPORTED_CHARACTER_PIXELS = 12_000_000;

export function countCharacterPixels(entry) {
  const images = [entry?.portrait, ...(entry?.layers ?? []).map(layer => layer.image)].filter(Boolean);
  return [...new Set(images)].reduce((sum, image) => sum + Math.max(0, Number(image.width) || 0) * Math.max(0, Number(image.height) || 0), 0);
}

export function parseCharacterLayerFilename(filename, selectedCharacterId) {
  const name = String(filename ?? "").split(/[\\/]/u).pop();
  const match = /^([a-z0-9][a-z0-9._-]{0,63})__(body|hand_left|hand_right|head|eyes|brows|mouth|hair_back|hair_front|full)(?:__([a-z0-9_-]+))?\.(png|webp)$/iu.exec(name);
  if (match) {
    const [, characterId, role, variant = "neutral"] = match;
    if (!VALID_VARIANTS.has(variant.toLowerCase())) throw new TypeError(`Unsupported sprite variant in ${name}`);
    return Object.freeze({ characterId, role: role.toLowerCase(), variant: variant.toLowerCase() });
  }
  if (!/\.(png|webp)$/iu.test(name)) throw new TypeError(`Use PNG or WebP artwork: ${name}`);
  return Object.freeze({ characterId: selectedCharacterId, role: "full", variant: "neutral" });
}

function clampUnit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new RangeError("Sprite layer anchors and bounds must be normalized from 0 to 1");
  return number;
}

export function normalizeCharacterLayer(layer, index = 0) {
  const role = String(layer?.role ?? "").toLowerCase();
  if (!VALID_ROLES.has(role)) throw new TypeError(`Unsupported character layer role: ${role}`);
  const base = CHARACTER_LAYER_LAYOUTS[role];
  const normalized = {
    ...base,
    ...(layer.layout ?? {}),
    role,
    variant: String(layer.variant ?? "neutral").toLowerCase(),
    z: Number(layer.z ?? layer.layout?.z ?? base.z + index * 0.001),
    image: layer.image ?? layer.bitmap ?? null
  };
  for (const field of ["x", "y", "width", "height", "pivotX", "pivotY"]) normalized[field] = clampUnit(normalized[field], base[field]);
  if (normalized.width <= 0 || normalized.height <= 0 || !Number.isFinite(normalized.z)) throw new RangeError("Sprite layer dimensions and z order must be valid");
  return Object.freeze(normalized);
}

export function selectCharacterLayers(layers, { expression = "neutral", pose = "front", viseme = "rest", blink = false } = {}) {
  const normalized = layers.map((layer, index) => normalizeCharacterLayer(layer, index));
  const variantByRole = new Map();
  for (const layer of normalized) if (!new Set(["neutral", "front"]).has(layer.variant)) {
    const key = layer.role;
    if (!variantByRole.has(key)) variantByRole.set(key, new Set());
    variantByRole.get(key).add(layer.variant);
  }
  return normalized.filter(layer => {
    const variants = variantByRole.get(layer.role) ?? new Set();
    const desired = layer.role === "mouth" ? viseme : layer.role === "eyes" ? (blink ? "closed" : expression) : layer.role === "brows" ? expression : ["body", "head", "hand_left", "hand_right"].includes(layer.role) ? pose : "";
    if (!variants.size) return layer.variant === "neutral" || layer.variant === "front";
    if (desired && variants.has(desired)) return layer.variant === desired;
    return layer.variant === "neutral" || layer.variant === "front";
  }).sort((a, b) => a.z - b.z);
}

export function drawLayeredCharacter(ctx, layers, { x, top, width, height, headRotation = 0, armMotion = 0, expression = "neutral", pose = "front", viseme = "rest", blink = false, facing = "right" } = {}) {
  if (!ctx || !Array.isArray(layers) || ![x, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError("Canvas, character layers, and finite character bounds are required");
  if (!["left", "right"].includes(facing)) throw new TypeError("Character facing must be left or right");
  const selected = selectCharacterLayers(layers, { expression, pose, viseme, blink });
  const drawn = [];
  for (const layer of selected) {
    if (!layer.image) continue;
    const w = width * layer.width, h = height * layer.height;
    const mirrored = facing === "left";
    const px = x - width / 2 + width * (mirrored ? 1 - layer.x : layer.x), py = top + height * layer.y;
    let rotation = 0;
    if (layer.role === "head") rotation = headRotation * (mirrored ? -1 : 1);
    if (layer.role === "hand_left") rotation = (mirrored ? 1 : -1) * armMotion;
    if (layer.role === "hand_right") rotation = (mirrored ? -1 : 1) * armMotion;
    ctx.save(); ctx.translate(px, py); if (mirrored) ctx.scale(-1, 1); ctx.rotate(rotation);
    ctx.drawImage(layer.image, -w * layer.pivotX, -h * layer.pivotY, w, h);
    ctx.restore(); drawn.push(layer.role + (layer.variant === "neutral" ? "" : `:${layer.variant}`));
  }
  return Object.freeze({ drawnLayers: Object.freeze(drawn), layerCount: selected.length });
}
