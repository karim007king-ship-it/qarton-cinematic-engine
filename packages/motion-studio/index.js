import { createCameraTrack, sampleCameraTrack } from "@qarton/cinematic-engine/camera";
import { clamp } from "@qarton/cinematic-engine/motion";
import { createTimeline } from "@qarton/cinematic-engine/motion/timeline";
import { compileCinematicAudioProject } from "../../src/audio/cinematic-audio-core.js";
import { createCharacterAnimation } from "../../src/character/animation-core.js";
import { compileCinematicEffects } from "../../src/effects/cinematic-effects.js";

export { EXPORT_LIMITS, EXPORT_PROFILES, ExportError, planExport, rasterForQuality,
  prepareAudioMix, MIME_CANDIDATES, probeExport, startExport } from "./export/index.js";

export {
  addCameraKeyframe,
  deleteCameraKeyframe,
  moveCameraKeyframe,
  normalizeCameraPose,
  updateCameraKeyframe,
  validateCameraKeyframes,
  CAMERA_POSE_LIMITS,
  DEFAULT_CAMERA_POSE
} from "./keyframes.js";

const LIMITS = Object.freeze({ dimension: 4096, pixels: 8_388_608, fps: 60, durationMs: 300_000,
  layers: 64, keys: 1024 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const IDENTITY = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 });
const compiledProjects = new WeakSet();

function fields(value, required, optional, label) {
  if (!value || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new TypeError(`${label} has invalid fields`);
  }
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value) || /\s/u.test(value)) {
    throw new TypeError(`${label} must be an opaque ASCII identifier`);
  }
}

function compileTrack(keys, durationMs, label) {
  if (!Array.isArray(keys)) throw new TypeError(`${label} must be an array`);
  integer(keys.length, 1, LIMITS.keys, `${label} length`);

  let previousMs = -1;
  const timeline = createTimeline(Array.from(keys, (key, index) => {
    fields(key, ["atMs", "value"], [], `${label} key ${index}`);
    integer(key.atMs, 0, durationMs, `${label} atMs`);
    if (key.atMs <= previousMs) throw new RangeError(`${label} times must increase strictly`);
    previousMs = key.atMs;

    const pose = key.value;
    fields(pose, ["x", "y", "zoom", "rotation"], [], `${label} pose`);
    if (![pose.x, pose.y, pose.zoom, pose.rotation].every(Number.isFinite) ||
        Math.abs(pose.x) > 32768 || Math.abs(pose.y) > 32768 ||
        pose.zoom < 0.01 || pose.zoom > 64 || Math.abs(pose.rotation) > 36000) {
      throw new RangeError(`${label} pose is outside Studio limits`);
    }
    return { id: String(index), atMs: key.atMs, type: "pose", payload: pose };
  }));
  return createCameraTrack(timeline.events.map(({ atMs, payload }) => ({ atMs, ...payload })));
}

/** Compile JSON metadata and bind caller-owned, already decoded Canvas image sources. */
export function compileProject(project, assetProvider) {
  fields(project, ["version", "durationMs", "viewport", "layers"], ["camera"], "Project");
  if (project.version !== 1) throw new RangeError("Studio project version must be 1");
  const { durationMs, viewport, layers } = project;
  integer(durationMs, 1, LIMITS.durationMs, "Duration");
  fields(viewport, ["width", "height", "fps"], [], "Viewport");
  const { width, height, fps } = viewport;
  integer(width, 1, LIMITS.dimension, "Width");
  integer(height, 1, LIMITS.dimension, "Height");
  integer(width * height, 1, LIMITS.pixels, "Viewport pixels");
  integer(fps, 1, LIMITS.fps, "FPS");
  if (!Array.isArray(layers)) throw new TypeError("Layers must be an array");
  integer(layers.length, 1, LIMITS.layers, "Layer count");
  if (typeof assetProvider?.get !== "function") throw new TypeError("Image provider requires get(id)");

  const camera = Object.hasOwn(project, "camera") ? compileTrack(project.camera, durationMs, "Camera") : null;
  const ids = new Set();
  const orderedLayers = Array.from(layers, (layer, order) => {
    fields(layer, ["id", "assetId", "z"], ["track"], "Layer");
    const { id, assetId, z } = layer;
    identifier(id, "Layer ID");
    identifier(assetId, "Asset ID");
    if (ids.has(id)) throw new TypeError(`Duplicate layer ID: ${id}`);
    ids.add(id);
    integer(z, -2147483648, 2147483647, "Layer z");
    const track = Object.hasOwn(layer, "track") ? compileTrack(layer.track, durationMs, id) : null;
    return { id, assetId, z, order, track };
  }).sort((a, b) => a.z - b.z || a.order - b.order);

  const images = new Map();
  const compiledLayers = orderedLayers.map(({ order, assetId, ...layer }) => {
    if (!images.has(assetId)) {
      const image = assetProvider.get(assetId);
      if (!image || typeof image !== "object" || typeof image.then === "function") {
        throw new TypeError(`Missing decoded image: ${assetId}`);
      }
      images.set(assetId, image);
    }
    return Object.freeze({ ...layer, assetId, image: images.get(assetId) });
  });
  const compiled = Object.freeze({
    durationMs, viewport: Object.freeze({ width, height, fps }), camera,
    layers: Object.freeze(compiledLayers)
  });
  compiledProjects.add(compiled);
  return compiled;
}

/** Sample absolute milliseconds. Finite times outside the project clamp to its endpoints. */
export function sampleFrame(compiled, timeMs) {
  if (!compiledProjects.has(compiled)) throw new TypeError("Expected a compiled Studio project");
  const atMs = clamp(timeMs, 0, compiled.durationMs);
  return Object.freeze({
    atMs,
    viewport: compiled.viewport,
    camera: compiled.camera ? sampleCameraTrack(compiled.camera, atMs) : IDENTITY,
    layers: Object.freeze(compiled.layers.map(({ track, ...layer }) => Object.freeze({
      ...layer, pose: track ? sampleCameraTrack(track, atMs) : IDENTITY
    })))
  });
}

function applyPose(ctx, { x, y, zoom, rotation }, centerX, centerY) {
  ctx.translate(centerX + x, centerY + y);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(zoom, zoom);
  ctx.translate(-centerX, -centerY);
}

/** Paint an entire frame on a dedicated 2D canvas with the project's backing dimensions. */
export function drawFrame(ctx, frame) {
  const { width, height } = frame.viewport;
  if (ctx?.canvas?.width !== width || ctx.canvas.height !== height) {
    throw new RangeError("Canvas backing dimensions must match the project viewport");
  }
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.shadowColor = "transparent";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.clearRect(0, 0, width, height);
    applyPose(ctx, frame.camera, width / 2, height / 2);
    for (const { image, pose } of frame.layers) {
      ctx.save();
      try {
        applyPose(ctx, pose, width / 2, height / 2);
        ctx.drawImage(image, 0, 0, width, height);
      } finally {
        ctx.restore();
      }
    }
  } finally {
    ctx.restore();
  }
}

const SEQUENCE_LIMITS = Object.freeze({ scenes: 32, assets: 256, durationMs: 300_000 });
const SEQUENCE_ASSET_KINDS = new Set(["image", "audio", "font", "other"]);
const SEQUENCE_MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const compiledSequences = new WeakMap();

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cloneData(value, label) {
  try { return structuredClone(value); }
  catch (cause) { throw new TypeError(`${label} must contain cloneable JSON data`, { cause }); }
}

function validateSequenceViewport(viewport) {
  fields(viewport, ["width", "height", "fps"], [], "Sequence viewport");
  integer(viewport.width, 1, LIMITS.dimension, "Sequence viewport width");
  integer(viewport.height, 1, LIMITS.dimension, "Sequence viewport height");
  integer(viewport.width * viewport.height, 1, LIMITS.pixels, "Sequence viewport pixels");
  integer(viewport.fps, 1, LIMITS.fps, "Sequence viewport FPS");
  return { width: viewport.width, height: viewport.height, fps: viewport.fps };
}

function cutTransitionsFor(scenes) {
  return scenes.slice(1).map((scene, index) => Object.freeze({
    fromSceneId: scenes[index].id,
    toSceneId: scene.id,
    type: "cut",
    durationMs: 0
  }));
}

function validateSequenceAssets(assets) {
  if (!Array.isArray(assets) || assets.length > SEQUENCE_LIMITS.assets) {
    throw new RangeError(`Sequence assets must contain at most ${SEQUENCE_LIMITS.assets} records`);
  }
  const byId = new Map();
  const snapshot = assets.map((asset, index) => {
    fields(asset, ["id", "kind", "name", "mimeType", "size"], [], `Sequence asset ${index}`);
    identifier(asset.id, `Sequence asset ${index} id`);
    if (byId.has(asset.id)) throw new TypeError(`Duplicate sequence asset id: ${asset.id}`);
    if (!SEQUENCE_ASSET_KINDS.has(asset.kind)) throw new TypeError(`Sequence asset ${asset.id} has an unsupported kind`);
    if (typeof asset.name !== "string" || !asset.name.trim() || asset.name.length > 255) {
      throw new TypeError(`Sequence asset ${asset.id} needs a non-empty name of at most 255 characters`);
    }
    if (typeof asset.mimeType !== "string" || !SEQUENCE_MIME.test(asset.mimeType)) {
      throw new TypeError(`Sequence asset ${asset.id} has an invalid MIME type`);
    }
    integer(asset.size, 0, Number.MAX_SAFE_INTEGER, `Sequence asset ${asset.id} size`);
    const frozen = Object.freeze({ id: asset.id, kind: asset.kind, name: asset.name.trim(), mimeType: asset.mimeType.toLowerCase(), size: asset.size });
    byId.set(asset.id, frozen);
    return frozen;
  });
  return { assets: snapshot, byId };
}

function assertAssetReference(assetMap, assetId, kind, label) {
  const asset = assetMap.get(assetId);
  if (!asset || asset.kind !== kind) throw new TypeError(`${label} references missing ${kind} asset: ${assetId}`);
}

function normalizeSequenceScene(scene, index, viewport, assetsById) {
  fields(scene, ["id", "project"], ["audioTracks", "characterTracks", "visualEffectsTrack"], `Sequence scene ${index}`);
  identifier(scene.id, `Sequence scene ${index} id`);
  const project = cloneData(scene.project, `Sequence scene ${scene.id} project`);
  const projectViewport = project?.viewport;
  if (!projectViewport || projectViewport.width !== viewport.width || projectViewport.height !== viewport.height || projectViewport.fps !== viewport.fps) {
    throw new RangeError(`Sequence scene ${scene.id} viewport must match the sequence viewport`);
  }
  for (const layer of project.layers ?? []) assertAssetReference(assetsById, layer.assetId, "image", `Sequence scene ${scene.id} layer`);
  const decodedImages = { get: () => Object.freeze({ sequenceAssetPlaceholder: true }) };
  compileProject(project, decodedImages);

  const audioTracks = cloneData(scene.audioTracks ?? [], `Sequence scene ${scene.id} audioTracks`);
  const audio = compileCinematicAudioProject({ durationMs: project.durationMs, tracks: audioTracks });
  for (const clip of audio.clips) assertAssetReference(assetsById, clip.asset, "audio", `Sequence scene ${scene.id} audio clip`);

  const characterTracks = cloneData(scene.characterTracks ?? [], `Sequence scene ${scene.id} characterTracks`);
  if (!Array.isArray(characterTracks) || characterTracks.length > 32) {
    throw new RangeError(`Sequence scene ${scene.id} characterTracks must contain at most 32 tracks`);
  }
  const characterIds = new Set();
  for (const track of characterTracks) {
    const animation = createCharacterAnimation({ character: track?.character, durationMs: project.durationMs, keyframes: track?.keyframes });
    for (const assetId of animation.frameAssets) assertAssetReference(assetsById, assetId, "image", `Sequence scene ${scene.id} character frame`);
    const id = track.character.id;
    if (characterIds.has(id)) throw new TypeError(`Sequence scene ${scene.id} has duplicate character track id: ${id}`);
    characterIds.add(id);
  }

  const visualEffectsTrack = cloneData(scene.visualEffectsTrack ?? { version: 1, seed: 1, clips: [] },
    `Sequence scene ${scene.id} visualEffectsTrack`);
  fields(visualEffectsTrack, ["version", "seed", "clips"], [], `Sequence scene ${scene.id} visualEffectsTrack`);
  if (visualEffectsTrack.version !== 1) throw new RangeError(`Sequence scene ${scene.id} visualEffectsTrack version must be 1`);
  compileCinematicEffects({ version: "CinematicEffectsV1", width: viewport.width, height: viewport.height,
    durationMs: project.durationMs, seed: visualEffectsTrack.seed, layers: [], clips: visualEffectsTrack.clips });

  return Object.freeze({
    id: scene.id,
    project: deepFreeze(project),
    audioTracks: deepFreeze(audioTracks),
    characterTracks: deepFreeze(characterTracks),
    visualEffectsTrack: deepFreeze(visualEffectsTrack)
  });
}

function validateSequenceTransitions(transitions, scenes) {
  if (!Array.isArray(transitions) || transitions.length !== Math.max(0, scenes.length - 1)) {
    throw new RangeError("StudioSequenceV1 requires exactly one Cut between each adjacent pair of scenes");
  }
  return transitions.map((transition, index) => {
    fields(transition, ["fromSceneId", "toSceneId", "type", "durationMs"], [], `Sequence transition ${index}`);
    if (transition.fromSceneId !== scenes[index].id || transition.toSceneId !== scenes[index + 1].id) {
      throw new TypeError(`Sequence transition ${index} must connect its adjacent scenes in order`);
    }
    if (transition.type !== "cut" || transition.durationMs !== 0) {
      throw new TypeError("L11-B supports only zero-duration Cut transitions");
    }
    return Object.freeze({ fromSceneId: transition.fromSceneId, toSceneId: transition.toSceneId, type: "cut", durationMs: 0 });
  });
}

/** Validate, clone, and freeze a strict, metadata-only StudioSequenceV1 envelope. */
export function validateStudioSequenceV1(input) {
  fields(input, ["version", "kind", "viewport", "scenes", "assets", "transitions"], [], "StudioSequenceV1");
  if (input.version !== 1 || input.kind !== "studio-sequence") throw new TypeError("Expected StudioSequenceV1");
  const viewport = validateSequenceViewport(input.viewport);
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > SEQUENCE_LIMITS.scenes) {
    throw new RangeError(`StudioSequenceV1 scenes must contain between 1 and ${SEQUENCE_LIMITS.scenes} scenes`);
  }
  const { assets, byId: assetsById } = validateSequenceAssets(input.assets);
  const sceneIds = new Set();
  let totalDurationMs = 0;
  const sceneIntervals = [];
  const scenes = input.scenes.map((scene, index) => {
    const normalized = normalizeSequenceScene(scene, index, viewport, assetsById);
    if (sceneIds.has(normalized.id)) throw new TypeError(`Duplicate sequence scene id: ${normalized.id}`);
    sceneIds.add(normalized.id);
    const durationMs = normalized.project.durationMs;
    const startMs = totalDurationMs;
    totalDurationMs += durationMs;
    if (!Number.isSafeInteger(totalDurationMs) || totalDurationMs > SEQUENCE_LIMITS.durationMs) {
      throw new RangeError(`StudioSequenceV1 duration must not exceed ${SEQUENCE_LIMITS.durationMs} ms`);
    }
    sceneIntervals.push(Object.freeze({ sceneIndex: index, sceneId: normalized.id, startMs, endMs: totalDurationMs, durationMs }));
    return normalized;
  });
  const transitions = validateSequenceTransitions(input.transitions, scenes);
  const snapshot = deepFreeze({ version: 1, kind: "studio-sequence", viewport: Object.freeze(viewport),
    scenes: Object.freeze(scenes), assets: Object.freeze(assets), transitions: Object.freeze(transitions) });
  compiledSequences.set(snapshot, Object.freeze({ durationMs: totalDurationMs, intervals: Object.freeze(sceneIntervals) }));
  return snapshot;
}

function sequenceInput(viewport, scenes, assets = []) {
  return { version: 1, kind: "studio-sequence", viewport, scenes, assets, transitions: cutTransitionsFor(scenes) };
}

/** Construct a frozen sequence and insert deterministic zero-duration Cuts between scenes. */
export function createStudioSequenceV1({ viewport, scenes, assets = [] } = {}) {
  return validateStudioSequenceV1(sequenceInput(viewport, scenes, assets));
}

/** Compile scene intervals once for absolute-time preview, seek, and replay sampling. */
export function compileStudioSequence(sequence) {
  const snapshot = validateStudioSequenceV1(sequence);
  const metadata = compiledSequences.get(snapshot);
  const byScene = new Map(snapshot.scenes.map((scene, index) => [scene.id, Object.freeze({ scene, interval: metadata.intervals[index] })]));
  const compiled = Object.freeze({ version: 1, kind: "compiled-studio-sequence", sequence: snapshot,
    viewport: snapshot.viewport, durationMs: metadata.durationMs, scenes: snapshot.scenes, transitions: snapshot.transitions });
  compiledSequences.set(compiled, Object.freeze({ durationMs: metadata.durationMs, intervals: metadata.intervals, byScene }));
  return compiled;
}

/** Return the single active scene and its scene-local time; cuts are half-open, except the final endpoint. */
export function sampleStudioSequence(compiled, timeMs) {
  const metadata = compiledSequences.get(compiled);
  if (!metadata || compiled.kind !== "compiled-studio-sequence") throw new TypeError("Expected a compiled StudioSequenceV1");
  if (!Number.isFinite(timeMs)) throw new TypeError("Sequence sample time must be finite");
  const sequenceTimeMs = clamp(timeMs, 0, metadata.durationMs);
  let low = 0, high = metadata.intervals.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sequenceTimeMs < metadata.intervals[middle].endMs) high = middle;
    else low = middle + 1;
  }
  const interval = metadata.intervals[low];
  const { scene } = metadata.byScene.get(interval.sceneId);
  return Object.freeze({ sequenceTimeMs, totalDurationMs: metadata.durationMs, sceneIndex: low, sceneId: scene.id,
    sceneTimeMs: Math.min(interval.durationMs, Math.max(0, sequenceTimeMs - interval.startMs)),
    sceneDurationMs: interval.durationMs, scene, transition: low === 0 ? null : compiled.transitions[low - 1] });
}

export { addStudioSequenceSceneV2, compileStudioSequenceV2, createStudioSequenceV2,
  deleteStudioSequenceSceneV2, duplicateStudioSequenceSceneV2, migrateStudioSequenceV1ToV2,
  migrateStudioSequenceV2ToV1, parseStudioSequenceV2, reorderStudioSequenceSceneV2,
  sampleStudioSequenceV2, serializeStudioSequenceV2, validateStudioSequenceV2 } from "./studio-sequence-v2.js";
export { createStudioSequenceCompositor } from "./studio-sequence-compositor.js";

function rebuildStudioSequence(sequence, scenes) {
  return createStudioSequenceV1({ viewport: sequence.viewport, scenes, assets: sequence.assets });
}

/** Insert one scene immutably at an absolute list index. Existing asset metadata remains shared. */
export function addStudioSequenceScene(sequence, scene, index = sequence?.scenes?.length) {
  const snapshot = validateStudioSequenceV1(sequence);
  integer(index, 0, snapshot.scenes.length, "Scene insertion index");
  const scenes = snapshot.scenes.map(item => cloneData(item, "Scene"));
  scenes.splice(index, 0, cloneData(scene, "Scene"));
  return rebuildStudioSequence(snapshot, scenes);
}

/** Remove one scene; referenced assets are intentionally retained for the later asset-registry gate. */
export function deleteStudioSequenceScene(sequence, sceneId) {
  const snapshot = validateStudioSequenceV1(sequence);
  if (!snapshot.scenes.some(scene => scene.id === sceneId)) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
  if (snapshot.scenes.length === 1) throw new RangeError("StudioSequenceV1 must contain at least one scene");
  return rebuildStudioSequence(snapshot, snapshot.scenes.filter(scene => scene.id !== sceneId).map(scene => cloneData(scene, "Scene")));
}

/** Duplicate one scene with a caller-supplied fresh ID so IDs remain reproducible across seek/replay. */
export function duplicateStudioSequenceScene(sequence, sceneId, { newId, index } = {}) {
  const snapshot = validateStudioSequenceV1(sequence);
  identifier(newId, "Duplicate scene id");
  if (snapshot.scenes.some(scene => scene.id === newId)) throw new TypeError(`Duplicate sequence scene id: ${newId}`);
  const sourceIndex = snapshot.scenes.findIndex(scene => scene.id === sceneId);
  if (sourceIndex < 0) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
  const insertionIndex = index ?? sourceIndex + 1;
  integer(insertionIndex, 0, snapshot.scenes.length, "Scene insertion index");
  const scenes = snapshot.scenes.map(scene => cloneData(scene, "Scene"));
  const duplicate = cloneData(scenes[sourceIndex], "Scene");
  duplicate.id = newId;
  scenes.splice(insertionIndex, 0, duplicate);
  return rebuildStudioSequence(snapshot, scenes);
}

/** Move a scene to an absolute list index without changing the source sequence. */
export function reorderStudioSequenceScene(sequence, sceneId, toIndex) {
  const snapshot = validateStudioSequenceV1(sequence);
  const fromIndex = snapshot.scenes.findIndex(scene => scene.id === sceneId);
  if (fromIndex < 0) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
  integer(toIndex, 0, snapshot.scenes.length - 1, "Scene reorder index");
  const scenes = snapshot.scenes.map(scene => cloneData(scene, "Scene"));
  const [moved] = scenes.splice(fromIndex, 1);
  scenes.splice(toIndex, 0, moved);
  return rebuildStudioSequence(snapshot, scenes);
}

/** Convert an existing single-scene project plus its stored sidecar tracks into an immutable sequence. */
export function legacyStudioProjectToSequence(project, options = {}) {
  const allowed = ["sceneId", "assets", "audioTracks", "characterTrack", "characterTracks", "visualEffectsTrack"];
  fields(options, [], allowed, "Legacy sequence options");
  if (Object.hasOwn(options, "characterTrack") && Object.hasOwn(options, "characterTracks")) {
    throw new TypeError("Provide characterTrack or characterTracks, not both");
  }
  const characterTracks = Object.hasOwn(options, "characterTracks") ? options.characterTracks :
    (options.characterTrack === undefined ? [] : [options.characterTrack]);
  const scene = {
    id: options.sceneId ?? "legacy-scene",
    project,
    audioTracks: options.audioTracks ?? [],
    characterTracks,
    visualEffectsTrack: options.visualEffectsTrack ?? { version: 1, seed: 1, clips: [] }
  };
  return createStudioSequenceV1({ viewport: project?.viewport, scenes: [scene], assets: options.assets ?? [] });
}
