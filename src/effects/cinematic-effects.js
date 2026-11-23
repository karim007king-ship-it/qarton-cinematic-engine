import { createTimeline } from "../motion/timeline.js";
import { clamp, easeInOutCubic, lerp } from "../motion/easing.js";
import { sampleCameraShake } from "./camera-shake.js";
import { computeParallaxOffset } from "./parallax.js";
import { createCameraTrack, sampleCameraTrack, composeCameraPose } from "../camera/camera-track.js";
import { createSceneClock } from "../motion/scene-clock.js";

const TYPES = new Set(["fade", "dissolve", "vignette", "letterbox", "shake", "flash", "tint"]);
const COLOR = /^#[\da-f]{6}$/iu;
const CHANNELS = Object.freeze({
  fade: ["opacity", "color"], dissolve: ["progress", "color"], vignette: ["intensity"],
  letterbox: ["ratio"], shake: ["amplitude", "frequencyHz", "seed"],
  flash: ["intensity", "color"], tint: ["strength", "color"]
});
const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
  range(value, min, max, label);
};
const range = (value, min, max, label) => {
  finite(value, label);
  if (value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
};
function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
}
function assertKeys(value, required, optional, label) {
  assertRecord(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError(`${label} has unknown field ${String(key)}`);
  }
  for (const key of optional) {
    if (Object.hasOwn(value, key) && value[key] == null) throw new TypeError(`${label}.${key} must not be null or undefined`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
}
function assertDenseArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${label}[${index}] is missing`);
  }
}
const color = (value, label) => {
  if (typeof value !== "string" || !COLOR.test(value)) throw new TypeError(`${label} must be a #RRGGBB color`);
  return value.toLowerCase();
};

function validateProject(project) {
  assertKeys(project, ["version", "width", "height", "durationMs", "layers", "clips"], ["seed", "camera"], "project");
  if (project.version !== "CinematicEffectsV1") {
    throw new TypeError('project.version must be "CinematicEffectsV1"');
  }
  integer(project.width, 1, 4096, "width");
  integer(project.height, 1, 4096, "height");
  integer(project.durationMs, 1, 3_600_000, "durationMs");
  integer(project.seed ?? 1, -1_000_000, 1_000_000, "seed");
  assertDenseArray(project.layers, "layers");
  assertDenseArray(project.clips, "clips");
  const ids = new Set();
  const layers = project.layers.map((layer, index) => {
    assertKeys(layer, ["id"], ["assetId", "depth", "x", "y", "speedX", "speedY", "color", "z"], `layers[${index}]`);
    if (typeof layer.id !== "string" || !layer.id.trim() || ids.has(layer.id)) {
      throw new TypeError(`layers[${index}] needs a unique non-empty id`);
    }
    ids.add(layer.id);
    range(layer.depth ?? 0, -4, 4, `layers[${index}].depth`);
    range(layer.x ?? 0, -4096, 4096, `layers[${index}].x`);
    range(layer.y ?? 0, -4096, 4096, `layers[${index}].y`);
    range(layer.speedX ?? 0, -1000, 1000, `layers[${index}].speedX`);
    range(layer.speedY ?? 0, -1000, 1000, `layers[${index}].speedY`);
    const fill = color(layer.color ?? "#20334a", `layers[${index}].color`);
    integer(layer.z ?? index, -10000, 10000, `layers[${index}].z`);
    if (layer.assetId !== undefined && (typeof layer.assetId !== "string" || !layer.assetId.trim())) throw new TypeError(`layers[${index}].assetId must be a non-empty string`);
    return Object.freeze({ id: layer.id, assetId: layer.assetId ?? null, depth: layer.depth ?? 0,
      x: layer.x ?? 0, y: layer.y ?? 0, speedX: layer.speedX ?? 0, speedY: layer.speedY ?? 0,
      color: fill, z: layer.z ?? index });
  }).sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  const seen = new Set();
  const clips = project.clips.map((clip, index) => {
    assertKeys(clip, ["id", "type", "atMs", "durationMs", "from", "to"], ["easing"], `clips[${index}]`);
    if (typeof clip.id !== "string" || !clip.id.trim() || seen.has(clip.id)) {
      throw new TypeError(`clips[${index}] needs a unique non-empty id`);
    }
    if (!TYPES.has(clip.type)) throw new TypeError(`clips[${index}].type is unsupported`);
    integer(clip.atMs, 0, project.durationMs, `clips[${index}].atMs`);
    integer(clip.durationMs, 0, project.durationMs, `clips[${index}].durationMs`);
    if (clip.atMs + clip.durationMs > project.durationMs) throw new RangeError(`clips[${index}] ends after the scene`);
    const fields = CHANNELS[clip.type];
    assertKeys(clip.from, fields, [], `clips[${index}].from`);
    assertKeys(clip.to, fields, [], `clips[${index}].to`);
    const from = {}, to = {};
    for (const field of fields) {
      if (field === "color") {
        from[field] = color(clip.from[field], `clips[${index}].from.color`);
        to[field] = color(clip.to[field], `clips[${index}].to.color`);
      }
      else {
        const bounds = field === "ratio" ? [0, 0.2] : field === "frequencyHz" ? [0, 60] : field === "amplitude" ? [0, 64] : field === "seed" ? [-1e6, 1e6] : [0, 1];
        if (field === "seed") {
          integer(clip.from[field], bounds[0], bounds[1], `clips[${index}].from.seed`);
          integer(clip.to[field], bounds[0], bounds[1], `clips[${index}].to.seed`);
        } else {
          range(clip.from[field], bounds[0], bounds[1], `clips[${index}].from.${field}`);
          range(clip.to[field], bounds[0], bounds[1], `clips[${index}].to.${field}`);
        }
        from[field] = clip.from[field]; to[field] = clip.to[field];
      }
    }
    if (clip.easing !== undefined && !["linear", "easeInOutCubic"].includes(clip.easing)) throw new TypeError(`clips[${index}].easing is unsupported`);
    seen.add(clip.id);
    return Object.freeze({ id: clip.id, type: clip.type, atMs: clip.atMs, durationMs: clip.durationMs,
      from: Object.freeze(from), to: Object.freeze(to), easing: clip.easing ?? "linear" });
  });
  const timeline = createTimeline(clips.map(({id, atMs, type}) => ({id, atMs, type})));
  const clipsById = new Map(clips.map(clip => [clip.id, clip]));
  const orderedClips = timeline.events.map(event => clipsById.get(event.id));
  const cameraFrames = project.camera ?? [{atMs: 0}];
  assertDenseArray(cameraFrames, "camera");
  if (cameraFrames.length === 0) throw new TypeError("camera must contain at least one keyframe");
  cameraFrames.forEach((frame, index) => {
    assertKeys(frame, ["atMs"], ["x", "y", "zoom", "rotation"], `camera[${index}]`);
    integer(frame.atMs, 0, project.durationMs, `camera[${index}].atMs`);
    range(frame.x ?? 0, -4096, 4096, `camera[${index}].x`);
    range(frame.y ?? 0, -4096, 4096, `camera[${index}].y`);
    range(frame.zoom ?? 1, 0.1, 8, `camera[${index}].zoom`);
    range(frame.rotation ?? 0, -180, 180, `camera[${index}].rotation`);
  });
  const camera = createCameraTrack(cameraFrames);
  if (camera.keyframes.some(frame => frame.atMs > project.durationMs)) throw new RangeError("camera keyframe exceeds scene duration");
  return Object.freeze({ version: project.version, width: project.width, height: project.height,
    durationMs: project.durationMs, seed: project.seed ?? 1, layers: Object.freeze(layers), clips: Object.freeze(orderedClips), timeline, camera });
}

/** Validate and compile a serializable CinematicEffectsV1 scene. Compilation is renderer-independent. */
export function compileCinematicEffects(project) { return validateProject(project); }

function clipProgress(clip, timeMs) {
  if (clip.durationMs === 0) return timeMs < clip.atMs ? 0 : 1;
  const raw = clamp((timeMs - clip.atMs) / clip.durationMs);
  return clip.easing === "easeInOutCubic" ? easeInOutCubic(raw) : raw;
}

/** Return an immutable, repeatable render sample at an absolute scene time. */
export function sampleCinematicEffects(compiled, timeMs) {
  if (!compiled || compiled.version !== "CinematicEffectsV1") throw new TypeError("A compiled CinematicEffectsV1 scene is required");
  range(timeMs, 0, compiled.durationMs, "timeMs");
  const result = { timeMs, width: compiled.width, height: compiled.height,
    layers: [], fade: {opacity: 1, color: "#000000"}, dissolve: {progress: 0, color: "#000000"},
    vignette: 0, letterbox: 0, shake: {x: 0, y: 0, rotation: 0}, flash: {intensity: 0, color: "#ffffff"}, tint: {strength: 0, color: "#ffffff"} };
  let vignette = 0, letterbox = 0, flash = 0, tintStrength = 0;
  let cameraX = 0, cameraY = 0;
  const camera = sampleCameraTrack(compiled.camera, timeMs);
  for (const clip of compiled.clips) {
    if (timeMs < clip.atMs) continue;
    const p = clipProgress(clip, timeMs);
    const read = key => typeof clip.from[key] === "number" ? lerp(clip.from[key], clip.to[key], p) : (p < 0.5 ? clip.from[key] : clip.to[key]);
    switch (clip.type) {
      case "fade": result.fade = {opacity: read("opacity"), color: read("color")}; break;
      case "dissolve": result.dissolve = {progress: read("progress"), color: read("color")}; break;
      // Clips arrive in start-time order; each started clip replaces the prior
      // state so a newer clip can lower or clear an existing effect.
      case "vignette": vignette = read("intensity"); break;
      case "letterbox": letterbox = read("ratio"); break;
      case "shake": {
        if (clip.durationMs === 0 && timeMs > clip.atMs) break;
        const duration = Math.max(1, clip.durationMs);
        const shake = sampleCameraShake({timeMs: Math.min(clip.durationMs, Math.max(0, timeMs - clip.atMs)), durationMs: duration,
          amplitude: read("amplitude"), frequencyHz: read("frequencyHz"), seed: read("seed") + compiled.seed});
        const pixelScale = Math.min(compiled.width, compiled.height) / 720;
        result.shake.x += shake.x * pixelScale; result.shake.y += shake.y * pixelScale;
        result.shake.rotation += shake.rotation; break;
      }
      case "flash": {
        flash = read("intensity"); result.flash.color = read("color");
        break;
      }
      case "tint": tintStrength = read("strength"); result.tint.color = read("color"); break;
    }
  }
  cameraX = camera.x + result.shake.x;
  cameraY = camera.y + result.shake.y;
  result.layers = compiled.layers.map(layer => {
    const parallax = computeParallaxOffset({cameraX, cameraY, depth: layer.depth});
    return Object.freeze({ ...layer, x: layer.x + layer.speedX * timeMs / 1000 + parallax.x,
      y: layer.y + layer.speedY * timeMs / 1000 + parallax.y });
  });
  result.camera = composeCameraPose(camera, result.shake);
  result.vignette = vignette; result.letterbox = letterbox;
  result.flash.intensity = flash; result.tint.strength = tintStrength;
  result.shake = Object.freeze(result.shake); result.fade = Object.freeze(result.fade); result.dissolve = Object.freeze(result.dissolve);
  result.flash = Object.freeze(result.flash); result.tint = Object.freeze(result.tint);
  result.layers = Object.freeze(result.layers);
  return Object.freeze(result);
}

/** Scene Clock transport for UI hosts; render samples remain independently seekable. */
export function createCinematicEffectsPlayer(compiled, {now = () => performance.now()} = {}) {
  if (!compiled || compiled.version !== "CinematicEffectsV1") throw new TypeError("A compiled CinematicEffectsV1 scene is required");
  const clock = createSceneClock({durationMs: compiled.durationMs, now});
  return Object.freeze({
    play() { if (clock.time() >= compiled.durationMs) clock.seek(0); clock.resume(); return sampleCinematicEffects(compiled, clock.time()); },
    pause() { clock.pause(); return sampleCinematicEffects(compiled, clock.time()); },
    seek(timeMs) { clock.seek(timeMs); return sampleCinematicEffects(compiled, clock.time()); },
    replay() { clock.pause(); clock.seek(0); clock.resume(); return sampleCinematicEffects(compiled, 0); },
    sample() { return sampleCinematicEffects(compiled, clock.time()); },
    get paused() { return clock.paused; },
    get timeMs() { return clock.time(); },
    get durationMs() { return compiled.durationMs; }
  });
}

/** Draw a pure sample with Canvas 2D. Assets map layer assetId strings to CanvasImageSource values. */
export function drawCinematicEffects(ctx, sample, assets = {}) {
  if (!ctx || typeof ctx.save !== "function" || !sample || sample.version === "invalid") throw new TypeError("Canvas 2D context and sample are required");
  const {width, height} = sample;
  ctx.save();
  try {
    ctx.translate(width / 2 + sample.camera.x, height / 2 + sample.camera.y);
    ctx.rotate(sample.camera.rotation * Math.PI / 180);
    ctx.scale(sample.camera.zoom, sample.camera.zoom);
    ctx.translate(-width / 2, -height / 2);
    for (const layer of sample.layers) {
      if (layer.assetId && assets[layer.assetId]) ctx.drawImage(assets[layer.assetId], layer.x, layer.y, width, height);
      else { ctx.fillStyle = layer.color; ctx.fillRect(layer.x, layer.y, width, height); }
    }
  } finally { ctx.restore(); }
  ctx.save();
  try {
  const overlay = (alpha, fill) => { if (alpha <= 0) return; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; };
  if (sample.tint.strength) overlay(sample.tint.strength * 0.45, sample.tint.color);
  if (sample.flash.intensity) overlay(sample.flash.intensity, sample.flash.color);
  // A compact 12×12 ordered reveal keeps dissolve rendering bounded on mobile Canvas 2D.
  if (sample.dissolve.progress > 0) {
    ctx.fillStyle = sample.dissolve.color;
    const progress = sample.dissolve.progress;
    for (let i = 0; i < 144; i++) {
      const cell = (i * 73) % 144;
      if (cell / 144 < progress) {
        const x = cell % 12, y = Math.floor(cell / 12);
        ctx.fillRect(x * width / 12, y * height / 12, width / 12 + 1, height / 12 + 1);
      }
    }
  }
  if (sample.fade.opacity < 1) overlay(1 - sample.fade.opacity, sample.fade.color);
  if (sample.vignette > 0 && typeof ctx.createRadialGradient === "function") {
    const gradient = ctx.createRadialGradient(width/2, height/2, Math.min(width,height)*0.2, width/2, height/2, Math.max(width,height)*0.72);
    gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(1, `rgba(0,0,0,${sample.vignette})`);
    ctx.fillStyle = gradient; ctx.fillRect(0,0,width,height);
  }
  if (sample.letterbox > 0) {
    const bar = height * sample.letterbox; ctx.fillStyle = "#000000";
    ctx.fillRect(0,0,width,bar); ctx.fillRect(0,height-bar,width,bar);
  }
  } finally { ctx.restore(); }
  return Object.freeze({x: sample.shake.x, y: sample.shake.y, rotation: sample.shake.rotation});
}
