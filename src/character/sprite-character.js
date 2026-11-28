export const CHARACTER_LAYER_LAYOUTS = Object.freeze({
  body: Object.freeze({ x: 0.5, y: 0.34, width: 0.86, height: 0.66, pivotX: 0.5, pivotY: 0.05, z: 0 }),
  hand_left: Object.freeze({ x: 0.245, y: 0.535, width: 0.22, height: 0.22, pivotX: 0.5, pivotY: 0.9, z: 3 }),
  hand_right: Object.freeze({ x: 0.755, y: 0.535, width: 0.22, height: 0.22, pivotX: 0.5, pivotY: 0.9, z: 3 }),
  head: Object.freeze({ x: 0.5, y: 0.29, width: 0.4, height: 0.36, pivotX: 0.5, pivotY: 0.88, z: 2 }),
  eyes: Object.freeze({ x: 0.5, y: 0.14, width: 0.28, height: 0.09, pivotX: 0.5, pivotY: 0.5, z: 5 }),
  eye_left: Object.freeze({ x: 0.43, y: 0.14, width: 0.14, height: 0.09, pivotX: 0.5, pivotY: 0.5, z: 5 }),
  eye_right: Object.freeze({ x: 0.57, y: 0.14, width: 0.14, height: 0.09, pivotX: 0.5, pivotY: 0.5, z: 5.01 }),
  brows: Object.freeze({ x: 0.5, y: 0.095, width: 0.28, height: 0.07, pivotX: 0.5, pivotY: 0.5, z: 6 }),
  brow_left: Object.freeze({ x: 0.43, y: 0.095, width: 0.14, height: 0.07, pivotX: 0.5, pivotY: 0.5, z: 6 }),
  brow_right: Object.freeze({ x: 0.57, y: 0.095, width: 0.14, height: 0.07, pivotX: 0.5, pivotY: 0.5, z: 6.01 }),
  mouth: Object.freeze({ x: 0.5, y: 0.22, width: 0.19, height: 0.075, pivotX: 0.5, pivotY: 0.5, z: 7 }),
  hair_back: Object.freeze({ x: 0.5, y: 0.24, width: 0.49, height: 0.46, pivotX: 0.5, pivotY: 0.75, z: 1 }),
  hair_front: Object.freeze({ x: 0.5, y: 0.17, width: 0.46, height: 0.3, pivotX: 0.5, pivotY: 0.9, z: 4 }),
  full: Object.freeze({ x: 0.5, y: 0.5, width: 1, height: 1, pivotX: 0.5, pivotY: 0.5, z: 0 })
});

const VALID_ROLES = new Set(Object.keys(CHARACTER_LAYER_LAYOUTS));
export const FACIAL_LAYER_ROLES = Object.freeze(["eyes", "eye_left", "eye_right", "brows", "brow_left", "brow_right", "mouth"]);
const VALID_VARIANTS = new Set(["neutral", "happy", "sad", "angry", "afraid", "surprised", "thinking", "determined", "front", "side", "pose1", "pose2", "open", "round", "wide", "teeth", "closed", "rest"]);
export const MAX_IMPORTED_CHARACTER_PIXELS = 12_000_000;

export function countCharacterPixels(entry) {
  const images = [entry?.portrait, ...(entry?.layers ?? []).map(layer => layer.image)].filter(Boolean);
  return [...new Set(images)].reduce((sum, image) => sum + Math.max(0, Number(image.width) || 0) * Math.max(0, Number(image.height) || 0), 0);
}

export function parseCharacterLayerFilename(filename, selectedCharacterId) {
  const name = String(filename ?? "").split(/[\\/]/u).pop();
  const match = /^([a-z0-9][a-z0-9._-]{0,63})__(body|hand_left|hand_right|head|eyes|eye_left|eye_right|brows|brow_left|brow_right|mouth|hair_back|hair_front|full)(?:__([a-z0-9-]+))?(?:__(front|side))?\.(png|webp)$/iu.exec(name);
  if (match) {
    const [, characterId, rawRole, rawVariant = "neutral", explicitView] = match;
    const role = rawRole.toLowerCase();
    let variant = rawVariant.toLowerCase(), view = explicitView?.toLowerCase();
    if (!view && ["eyes", "eye_left", "eye_right", "brows", "brow_left", "brow_right", "mouth"].includes(role) && ["front", "side"].includes(variant)) {
      view = variant; variant = "neutral";
    }
    if (!VALID_VARIANTS.has(variant)) throw new TypeError(`Unsupported sprite variant in ${name}`);
    return Object.freeze({ characterId, role, variant, ...(view ? { view } : {}) });
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
    view: String(layer.view ?? "any").toLowerCase(),
    z: Number(layer.z ?? layer.layout?.z ?? base.z + index * 0.001),
    image: layer.image ?? layer.bitmap ?? null,
    sourceRect: layer.sourceRect
  };
  for (const field of ["x", "y", "width", "height", "pivotX", "pivotY"]) normalized[field] = clampUnit(normalized[field], base[field]);
  // Keep the authored anchor record alongside its flattened draw fields. The
  // renderer uses the flattened values; the calibrated-rig validator must be
  // able to distinguish authored anchors from fallback layout defaults.
  normalized.layout = Object.freeze(Object.fromEntries(["x", "y", "width", "height", "pivotX", "pivotY"].map(field => [field, normalized[field]])));
  if (!["any", "front", "side"].includes(normalized.view)) throw new TypeError("Sprite layer view must be any, front, or side");
  if (normalized.width <= 0 || normalized.height <= 0 || !Number.isFinite(normalized.z)) throw new RangeError("Sprite layer dimensions and z order must be valid");
  return Object.freeze(normalized);
}

export function selectCharacterLayers(layers, { expression = "neutral", pose = "front", viseme = "rest", blink = false } = {}) {
  const normalized = layers.map((layer, index) => normalizeCharacterLayer(layer, index));
  const view = pose === "side" ? "side" : "front";
  const visible = normalized.filter(layer => layer.view === "any" || layer.view === view);
  const variantByRole = new Map();
  for (const layer of visible) if (layer.variant !== "neutral" && layer.variant !== "front") {
    const key = layer.role;
    if (!variantByRole.has(key)) variantByRole.set(key, new Set());
    variantByRole.get(key).add(layer.variant);
  }
  return visible.filter(layer => {
    const variants = variantByRole.get(layer.role) ?? new Set();
    const desired = layer.role === "mouth" ? (viseme === "rest" ? "closed" : viseme) : ["eyes", "eye_left", "eye_right"].includes(layer.role) ? (blink ? "closed" : expression) : ["brows", "brow_left", "brow_right"].includes(layer.role) ? expression : ["body", "head", "hand_left", "hand_right"].includes(layer.role) ? pose : "";
    if (!variants.size) return layer.variant === "neutral" || layer.variant === "front";
    if (desired && variants.has(desired)) return layer.variant === desired;
    return layer.variant === "neutral" || layer.variant === "front";
  }).sort((a, b) => a.z - b.z);
}

const ANCHOR_FIELDS = ["x", "y", "width", "height", "pivotX", "pivotY"];
export function isCalibratedFaceRig(layers, pose = "front") {
  if (!Array.isArray(layers)) return false;
  const view = pose === "side" ? "side" : "front";
  const face = layers.filter(layer => FACIAL_LAYER_ROLES.includes(layer.role) && (layer.view ?? "any") === view);
  const anchored = role => face.filter(layer => layer.role === role).length > 0 && face.filter(layer => layer.role === role).every(layer =>
    layer.layout && ANCHOR_FIELDS.every(field => Number.isFinite(layer.layout[field])));
  const head = layers.some(layer => layer.role === "head" && (layer.view ?? "any") === view && layer.layout && ANCHOR_FIELDS.every(field => Number.isFinite(layer.layout[field])));
  const mouth = new Set(face.filter(layer => layer.role === "mouth").map(layer => layer.variant));
  return head && ["eye_left", "eye_right", "brow_left", "brow_right"].every(anchored) && ["closed", "open", "round", "wide", "teeth"].every(variant => mouth.has(variant)) &&
    face.filter(layer => layer.role === "mouth").every(layer => layer.layout && ANCHOR_FIELDS.every(field => Number.isFinite(layer.layout[field])));
}

// HTMLImageElement.width can be the layout width, not the decoded width.
export function assertCharacterSourceRect(rect, image, label = "Character layer") {
  const { x, y, width, height } = rect;
  const imageWidth = image?.naturalWidth ?? image?.width;
  const imageHeight = image?.naturalHeight ?? image?.height;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
      !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
      x + width > imageWidth || y + height > imageHeight) {
    throw new RangeError(`${label} sourceRect exceeds decoded atlas bounds (${imageWidth} × ${imageHeight}) or is invalid`);
  }
}

export function drawLayeredCharacter(ctx, layers, { x, top, width, height, headRotation = 0, armMotion = 0, bodySway = 0, eyeX = 0, eyeY = 0, expression = "neutral", pose = "front", viseme = "rest", blink = false, facing = "right" } = {}) {
  if (!ctx || !Array.isArray(layers) || ![x, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError("Canvas, character layers, and finite character bounds are required");
  if (!["left", "right"].includes(facing)) throw new TypeError("Character facing must be left or right");
  const selected = selectCharacterLayers(layers, { expression, pose, viseme, blink });
  for (const layer of selected) {
    if (layer.sourceRect) assertCharacterSourceRect(layer.sourceRect, layer.image, layer.role);
  }
  const head = selected.find(layer => layer.role === "head") ?? CHARACTER_LAYER_LAYOUTS.head;
  const headPivotX = width * (head.x - 0.5), headPivotY = height * head.y;
  const mirrorSign = facing === "left" ? -1 : 1;
  const headAttached = new Set(["hair_back", "hair_front", ...FACIAL_LAYER_ROLES]);
  const drawn = [];
  const geometry = [];
  for (const layer of selected) {
    if (!layer.image) continue;
    const w = width * layer.width, h = height * layer.height;
    const mirrored = facing === "left";
    // Atlas portrait tiles include the immediate skin around each eye.
    const eyeLayer = !layer.sourceRect && ["eyes", "eye_left", "eye_right"].includes(layer.role);
    const localX = width * (layer.x - 0.5) + (eyeLayer ? eyeX * width * 0.025 * mirrorSign : 0);
    const localY = height * layer.y + (eyeLayer ? eyeY * height * 0.012 : 0);
    let rotation = 0;
    if (layer.role === "head" || headAttached.has(layer.role)) rotation = headRotation * mirrorSign;
    if (layer.role === "body") rotation = bodySway * mirrorSign;
    if (layer.role === "hand_left") rotation = -armMotion * mirrorSign;
    if (layer.role === "hand_right") rotation = armMotion * mirrorSign;
    const attached = headAttached.has(layer.role);
    ctx.save(); ctx.translate(x, top); if (mirrored) ctx.scale(-1, 1);
    if (attached) { ctx.translate(headPivotX, headPivotY); ctx.rotate(headRotation * mirrorSign); ctx.translate(-headPivotX, -headPivotY); }
    ctx.translate(localX, localY); if (layer.role === "head") ctx.rotate(headRotation * mirrorSign);
    if (layer.role === "body" || layer.role === "hand_left" || layer.role === "hand_right") ctx.rotate(rotation);
    const destination = [-w * layer.pivotX, -h * layer.pivotY, w, h];
    if (layer.sourceRect) {
      const { x: sx, y: sy, width: sw, height: sh } = layer.sourceRect;
      ctx.drawImage(layer.image, sx, sy, sw, sh, ...destination);
    } else {
      ctx.drawImage(layer.image, ...destination);
    }
    ctx.restore(); drawn.push(layer.role + (layer.variant === "neutral" ? "" : `:${layer.variant}`));
    geometry.push(Object.freeze({ role: layer.role, variant: layer.variant, z: layer.z, anchorX: x + localX * mirrorSign,
      anchorY: top + localY, width: w, height: h, pivotX: layer.pivotX, pivotY: layer.pivotY,
      headAttached: attached || layer.role === "head", rotation }));
  }
  return Object.freeze({ drawnLayers: Object.freeze(drawn), layerCount: selected.length, geometry: Object.freeze(geometry) });
}
