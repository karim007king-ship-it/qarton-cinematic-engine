import {
  addStudioSequenceScene,
  compileProject,
  compileStudioSequence,
  createStudioSequenceV1,
  deleteStudioSequenceScene,
  drawFrame,
  duplicateStudioSequenceScene,
  reorderStudioSequenceScene,
  sampleFrame,
  sampleStudioSequence
} from "../../packages/motion-studio/index.js";
import { createAssetRegistry } from "../../packages/motion-studio/asset-registry.js";
import { createSceneClock } from "../../src/motion/scene-clock.js";
import { createCameraMotionProject } from "../motion-studio-lab/studio-motion-presets.js";
import { decodeImageBitmap } from "../motion-studio-lab/studio-image.js";

const DEFAULT_VIEWPORT = Object.freeze({ width: 720, height: 1280, fps: 24 });
const ASPECTS = Object.freeze({ "9:16": [720, 1280], "16:9": [1280, 720], "1:1": [1080, 1080], "4:5": [864, 1080], "4:3": [960, 720], "3:4": [720, 960] });
const PLACEHOLDER_ID = "placeholder-image";
const MIN_DURATION_MS = 3000;
const MAX_DURATION_MS = 60000;
const DEFAULT_DURATION_MS = 8000;
const DEFAULT_MOTION = Object.freeze({ preset: "static", speed: 1, strength: 50 });
const PRESET_MAP = Object.freeze({
  static: { preset: "static", reverse: false },
  "zoom-in": { preset: "zoom-in", reverse: false },
  "zoom-out": { preset: "zoom-out", reverse: false },
  right: { preset: "pan-horizontal", reverse: false },
  left: { preset: "pan-horizontal", reverse: true },
  down: { preset: "pan-vertical", reverse: false },
  up: { preset: "pan-vertical", reverse: true }
});

function safeId(prefix, value) {
  return prefix + "-" + value.toString(36).replace(/[^a-z0-9]/giu, "");
}

function makeSceneId(counter) { return safeId("scene", counter); }

function applyCameraMotion(project, settings) {
  const mapping = PRESET_MAP[settings.preset];
  if (!mapping) throw new TypeError("حركة كاميرا غير معروفة.");
  const base = { ...project };
  delete base.camera;
  const generated = createCameraMotionProject(base, {
    preset: mapping.preset,
    speed: settings.speed,
    strength: settings.strength,
    focusX: 50,
    focusY: 50
  });
  if (!mapping.reverse) return generated;
  return {
    ...generated,
    camera: generated.camera
      .map(({ atMs, value }) => ({ atMs: project.durationMs - atMs, value }))
      .sort((left, right) => left.atMs - right.atMs)
  };
}

function makeProject(sceneId, assetId, durationMs, settings) {
  const base = {
    version: 1,
    durationMs,
    viewport: DEFAULT_VIEWPORT,
    layers: [{ id: safeId("layer", sceneId), assetId, z: 0 }]
  };
  return applyCameraMotion(base, settings);
}

function makeScene(sceneId, assetId = PLACEHOLDER_ID, durationMs = DEFAULT_DURATION_MS, settings = DEFAULT_MOTION) {
  return {
    id: sceneId,
    project: makeProject(sceneId, assetId, durationMs, settings),
    visualEffectsTrack: { version: 1, seed: 1, clips: [] }
  };
}

function formatTime(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

export function createStudioV2Engine({ canvas, onState = () => {}, onError = () => {}, decodeImage = decodeImageBitmap } = {}) {
  const context = canvas?.getContext?.("2d", { alpha: false, desynchronized: true });
  if (!context) throw new Error("تعذر إنشاء معاينة المحرك في هذا المتصفح.");
  let viewport = DEFAULT_VIEWPORT;
  let fitMode = "fill";
  let aspectRatio = "9:16";
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const placeholderSurface = document.createElement("canvas");
  placeholderSurface.width = viewport.width;
  placeholderSurface.height = viewport.height;
  const placeholderContext = placeholderSurface.getContext("2d", { alpha: false });
  const gradient = placeholderContext.createLinearGradient(0, 0, viewport.width, viewport.height);
  gradient.addColorStop(0, "#15171d");
  gradient.addColorStop(0.55, "#28221a");
  gradient.addColorStop(1, "#0a0b0e");
  placeholderContext.fillStyle = gradient;
  placeholderContext.fillRect(0, 0, viewport.width, viewport.height);

  let sceneCounter = 1;
  let assetCounter = 0;
  const importVersions = new Map();
  let currentSceneId = makeSceneId(sceneCounter);
  let sequence = createStudioSequenceV1({
    viewport,
    scenes: [makeScene(currentSceneId)],
    assets: [{ id: PLACEHOLDER_ID, kind: "image", name: "بدون صورة", mimeType: "image/png", size: 0 }]
  });
  const assetRegistry = createAssetRegistry(sequence);
  const decodedImages = new Map([[PLACEHOLDER_ID, placeholderSurface]]);
  const objectUrls = new Map();
  const motionSettings = new Map([[currentSceneId, { ...DEFAULT_MOTION }]]);
  let compiledSequence = compileStudioSequence(sequence);
  let compiledProjects = new WeakMap();
  let clock = createSceneClock({ durationMs: compiledSequence.durationMs });
  let playing = false;
  let rafId = 0;
  let lastSceneId = "";
  let disposed = false;
  let sceneStateSequence = null;
  let sceneStateCache = null;
  const renderImages = new Map();

  function selectedScene() {
    return assetRegistry.sequence.scenes.find(scene => scene.id === currentSceneId) ?? assetRegistry.sequence.scenes[0];
  }

  function sceneStartMs(sceneId) {
    let cursor = 0;
    for (const scene of assetRegistry.sequence.scenes) {
      if (scene.id === sceneId) return cursor;
      cursor += scene.project.durationMs;
    }
    return 0;
  }

  function compiledProject(project) {
    let compiled = compiledProjects.get(project);
    if (!compiled) {
      compiled = compileProject(project, {
        get(id) {
          const image = renderImage(id);
          if (!image) throw new Error("تعذر العثور على الصورة المحلية للمشهد.");
          return image;
        }
      });
      compiledProjects.set(project, compiled);
    }
    return compiled;
  }

  function renderImage(id) {
    const source = decodedImages.get(id);
    if (!source) return null;
    const key = `${id}:${viewport.width}x${viewport.height}:${fitMode}`;
    if (renderImages.has(key)) return renderImages.get(key);
    const surface = document.createElement("canvas");
    surface.width = viewport.width;
    surface.height = viewport.height;
    const ctx = surface.getContext("2d", { alpha: false });
    const sw = source.width || source.videoWidth || viewport.width;
    const sh = source.height || source.videoHeight || viewport.height;
    const scale = fitMode === "fit" ? Math.min(viewport.width / sw, viewport.height / sh) : Math.max(viewport.width / sw, viewport.height / sh);
    const w = sw * scale, h = sh * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#08090d";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.drawImage(source, (viewport.width - w) / 2, (viewport.height - h) / 2, w, h);
    renderImages.set(key, surface);
    return surface;
  }

  function stopAnimationFrame() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function makeState(sample) {
    const scenes = assetRegistry.sequence.scenes;
    const sceneIndex = scenes.findIndex(scene => scene.id === sample.sceneId);
    const scene = sample.scene;
    const assetId = scene.project.layers[0]?.assetId ?? PLACEHOLDER_ID;
    const metadata = assetRegistry.sequence.assets.find(asset => asset.id === assetId);
    const motion = motionSettings.get(scene.id) ?? { ...DEFAULT_MOTION };
    const keyframes = scene.project.camera ?? [];
    if (sceneStateSequence !== assetRegistry.sequence) {
      sceneStateCache = Object.freeze(scenes.map((item, index) => {
        const id = item.project.layers[0]?.assetId ?? PLACEHOLDER_ID;
        const asset = assetRegistry.sequence.assets.find(entry => entry.id === id);
        return Object.freeze({ id: item.id, index, hasImage: id !== PLACEHOLDER_ID, name: asset?.name ?? "", thumbnailUrl: objectUrls.get(id) ?? "", durationMs: item.project.durationMs });
      }));
      sceneStateSequence = assetRegistry.sequence;
    }
    return Object.freeze({
      engineReady: true,
      aspectRatio,
      fitMode,
      playing,
      selectedSceneId: scene.id,
      selectedIndex: sceneIndex,
      sceneCount: scenes.length,
      scenes: sceneStateCache,
      hasImage: assetId !== PLACEHOLDER_ID,
      imageName: assetId === PLACEHOLDER_ID ? "" : (metadata?.name ?? ""),
      assetId,
      timeMs: sample.sequenceTimeMs,
      sceneTimeMs: sample.sceneTimeMs,
      totalDurationMs: sample.totalDurationMs,
      sceneDurationMs: sample.sceneDurationMs,
      formattedTime: formatTime(sample.sequenceTimeMs),
      formattedTotal: formatTime(sample.totalDurationMs),
      camera: sampleFrame(compiledProject(scene.project), sample.sceneTimeMs).camera,
      cameraKeyframes: keyframes.map(frame => frame.atMs),
      motion,
      imageAssetCount: assetRegistry.sequence.assets.filter(asset => asset.kind === "image" && asset.id !== PLACEHOLDER_ID).length,
      canDelete: scenes.length > 1,
      canMoveRight: sceneIndex > 0,
      canMoveLeft: sceneIndex >= 0 && sceneIndex < scenes.length - 1
    });
  }

  function render() {
    if (disposed) return;
    try {
      const timeMs = clock.time();
      const sample = sampleStudioSequence(compiledSequence, timeMs);
      currentSceneId = sample.sceneId;
      const frame = sampleFrame(compiledProject(sample.scene.project), sample.sceneTimeMs);
      drawFrame(context, frame);
      canvas.dataset.renderedScene = sample.sceneId;
      canvas.dataset.cameraPose = [
        frame.camera.x, frame.camera.y, frame.camera.zoom, frame.camera.rotation
      ].map(value => Number(value).toFixed(4)).join(",");
      canvas.dataset.cameraKeyframes = (sample.scene.project.camera ?? []).map(item => item.atMs).join(",");
      if (sample.sceneId !== lastSceneId) lastSceneId = sample.sceneId;
      onState(makeState(sample));
    } catch (error) {
      canvas.dataset.engineError = error?.message ?? String(error);
      onError(error);
      throw error;
    }
  }

  function scheduleFrame() {
    if (!rafId && playing && !disposed) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = 0;
    if (!playing || disposed) return;
    if (clock.time() >= compiledSequence.durationMs) {
      clock.pause();
      playing = false;
      render();
      return;
    }
    render();
    scheduleFrame();
  }

  function editSequence(nextSequence, { sceneId = currentSceneId, seekToStart = true } = {}) {
    const wasPlaying = playing;
    const oldTime = clock.time();
    stopAnimationFrame();
    playing = false;
    clock.pause();
    assetRegistry.replaceSequence(nextSequence);
    sequence = assetRegistry.sequence;
    compiledSequence = compileStudioSequence(sequence);
    compiledProjects = new WeakMap();
    const nextSelected = sequence.scenes.some(scene => scene.id === sceneId) ? sceneId : sequence.scenes[0].id;
    currentSceneId = nextSelected;
    clock = createSceneClock({ durationMs: compiledSequence.durationMs });
    clock.seek(seekToStart ? sceneStartMs(nextSelected) : Math.min(oldTime, compiledSequence.durationMs));
    if (wasPlaying && !seekToStart) { playing = true; clock.resume(); }
    render();
    if (playing) scheduleFrame();
  }

  function makeSequenceWithScene(sceneId, project) {
    const scenes = assetRegistry.sequence.scenes.map(scene =>
      scene.id === sceneId ? { ...scene, project } : scene
    );
    return createStudioSequenceV1({
      viewport: assetRegistry.sequence.viewport,
      scenes,
      assets: assetRegistry.sequence.assets
    });
  }

  function cleanAsset(id) {
    if (!id || id === PLACEHOLDER_ID || assetRegistry.references(id).length) return;
    for (const key of renderImages.keys()) if (key.startsWith(`${id}:`)) renderImages.delete(key);
    if (assetRegistry.sequence.assets.some(asset => asset.id === id)) {
      try { assetRegistry.remove(id); } catch (error) { onError(error); return; }
    }
    const bitmap = decodedImages.get(id);
    bitmap?.close?.();
    decodedImages.delete(id);
    const url = objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(id);
    sequence = assetRegistry.sequence;
    compiledSequence = compileStudioSequence(sequence);
    compiledProjects = new WeakMap();
  }

  function refreshSceneProject(sceneId, project, motion = motionSettings.get(sceneId) ?? DEFAULT_MOTION) {
    const next = makeSequenceWithScene(sceneId, project);
    motionSettings.set(sceneId, { ...motion });
    editSequence(next, { sceneId, seekToStart: false });
  }

  function sceneProjectForMotion(scene, settings) {
    return applyCameraMotion(scene.project, settings);
  }

  function updateMotion(patch) {
    const scene = selectedScene();
    const previous = motionSettings.get(scene.id) ?? { ...DEFAULT_MOTION };
    const nextMotion = { ...previous, ...patch };
    const project = sceneProjectForMotion(scene, nextMotion);
    refreshSceneProject(scene.id, project, nextMotion);
  }

  function pruneUnreferencedAssets() {
    for (const asset of [...assetRegistry.sequence.assets]) {
      if (asset.id !== PLACEHOLDER_ID && assetRegistry.references(asset.id).length === 0) cleanAsset(asset.id);
    }
  }

  function addScene() {
    sceneCounter += 1;
    const id = makeSceneId(sceneCounter);
    const blank = makeScene(id, PLACEHOLDER_ID, MIN_DURATION_MS, DEFAULT_MOTION);
    const scene = { ...blank, project: { ...blank.project, viewport } };
    const next = addStudioSequenceScene(assetRegistry.sequence, scene);
    motionSettings.set(id, motion);
    editSequence(next, { sceneId: id, seekToStart: true });
    return id;
  }

  function duplicateScene() {
    const source = selectedScene();
    sceneCounter += 1;
    const id = makeSceneId(sceneCounter);
    const next = duplicateStudioSequenceScene(assetRegistry.sequence, source.id, { newId: id });
    motionSettings.set(id, { ...(motionSettings.get(source.id) ?? DEFAULT_MOTION) });
    editSequence(next, { sceneId: id, seekToStart: true });
    return id;
  }

  function deleteScene() {
    const scenes = assetRegistry.sequence.scenes;
    if (scenes.length <= 1) throw new Error("يجب إبقاء مشهد واحد على الأقل.");
    const index = scenes.findIndex(scene => scene.id === currentSceneId);
    const removedId = currentSceneId;
    const removedAssetIds = scenes[index].project.layers.map(layer => layer.assetId);
    const next = deleteStudioSequenceScene(assetRegistry.sequence, removedId);
    motionSettings.delete(removedId);
    const nextId = next.scenes[Math.max(0, index - 1)].id;
    editSequence(next, { sceneId: nextId, seekToStart: true });
    removedAssetIds.forEach(cleanAsset);
    pruneUnreferencedAssets();
    render();
  }

  function moveScene(direction) {
    const scenes = assetRegistry.sequence.scenes;
    const index = scenes.findIndex(scene => scene.id === currentSceneId);
    const toIndex = direction === "right" ? index - 1 : index + 1;
    if (toIndex < 0 || toIndex >= scenes.length) return;
    const next = reorderStudioSequenceScene(assetRegistry.sequence, currentSceneId, toIndex);
    editSequence(next, { sceneId: currentSceneId, seekToStart: true });
  }

  async function addImage(file) {
    const targetSceneId = currentSceneId;
    if (!assetRegistry.sequence.scenes.some(scene => scene.id === targetSceneId)) throw new DOMException("Target scene no longer exists", "AbortError");
    const generation = (importVersions.get(targetSceneId) ?? 0) + 1;
    importVersions.set(targetSceneId, generation);
    let bitmap = null;
    let assetId = "";
    let linked = false;
    let url = "";
    try {
      bitmap = await decodeImage(file, { isCurrent: () => !disposed && importVersions.get(targetSceneId) === generation && assetRegistry.sequence.scenes.some(item => item.id === targetSceneId) });
      if (disposed || importVersions.get(targetSceneId) !== generation) throw new DOMException("Image selection was superseded", "AbortError");
      const scene = assetRegistry.sequence.scenes.find(item => item.id === targetSceneId);
      if (!scene) throw new DOMException("Target scene was deleted during import", "AbortError");
      assetCounter += 1;
      assetId = safeId("image", assetCounter);
      const asset = {
        id: assetId,
        kind: "image",
        name: (file.name || "image").slice(0, 255),
        mimeType: file.type,
        size: file.size
      };
      assetRegistry.add(asset);
      assetRegistry.relink(assetId, file);
      linked = true;
      url = URL.createObjectURL(file);
      decodedImages.set(assetId, bitmap);
      objectUrls.set(assetId, url);
      const oldAssetId = scene.project.layers[0]?.assetId ?? PLACEHOLDER_ID;
      const project = {
        ...scene.project,
        layers: scene.project.layers.map((layer, index) =>
          index === 0 ? { ...layer, assetId } : layer
        )
      };
      const next = makeSequenceWithScene(scene.id, project);
      editSequence(next, { sceneId: scene.id, seekToStart: false });
      bitmap = null;
      url = "";
      cleanAsset(oldAssetId);
      render();
      return Object.freeze({ ok: true, name: asset.name });
    } catch (error) {
      if (assetId && linked && !assetRegistry.references(assetId).length) {
        try { assetRegistry.remove(assetId); } catch {}
      } else if (assetId && !linked && assetRegistry.sequence.assets.some(asset => asset.id === assetId)) {
        try { assetRegistry.remove(assetId); } catch {}
      }
      if (assetId) decodedImages.delete(assetId);
      for (const key of renderImages.keys()) if (key.startsWith(`${assetId}:`)) renderImages.delete(key);
      if (url) URL.revokeObjectURL(url);
      bitmap?.close?.();
      throw error;
    }
  }

  function deleteImage() {
    const scene = selectedScene();
    const oldAssetId = scene.project.layers[0]?.assetId ?? PLACEHOLDER_ID;
    if (oldAssetId === PLACEHOLDER_ID) return false;
    const project = {
      ...scene.project,
      layers: scene.project.layers.map((layer, index) =>
        index === 0 ? { ...layer, assetId: PLACEHOLDER_ID } : layer
      )
    };
    editSequence(makeSequenceWithScene(scene.id, project), { sceneId: scene.id, seekToStart: false });
    cleanAsset(oldAssetId);
    render();
    return true;
  }

  function selectScene(id) {
    if (!assetRegistry.sequence.scenes.some(scene => scene.id === id)) return;
    stopAnimationFrame();
    playing = false;
    clock.pause();
    currentSceneId = id;
    clock.seek(sceneStartMs(id));
    render();
  }

  function play() {
    if (clock.time() >= compiledSequence.durationMs) clock.seek(0);
    playing = true;
    clock.resume();
    render();
    scheduleFrame();
  }

  function pause() {
    clock.pause();
    playing = false;
    stopAnimationFrame();
    render();
  }

  function stop() {
    pause();
    clock.seek(0);
    render();
  }

  function seek(timeMs) {
    clock.seek(timeMs);
    render();
  }

  function setFit(fit) {
    if (fit !== "fit" && fit !== "fill") throw new RangeError("اختر احتواء أو ملء.");
    fitMode = fit;
    renderImages.clear();
    compiledProjects = new WeakMap();
    render();
  }

  function setAspectRatio(value) {
    const dims = value === "original" ? null : ASPECTS[value];
    if (value !== "original" && !dims) throw new RangeError("نسبة أبعاد غير معروفة.");
    const firstImage = [...decodedImages.entries()].find(([id]) => id !== PLACEHOLDER_ID)?.[1];
    aspectRatio = value;
    const width = dims?.[0] ?? Math.max(1, firstImage?.width ?? viewport.width);
    const height = dims?.[1] ?? Math.max(1, firstImage?.height ?? viewport.height);
    const scale = Math.min(1, 2048 / Math.max(width, height));
    const nextViewport = Object.freeze({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fps: viewport.fps });
    const scenes = assetRegistry.sequence.scenes.map(scene => ({ ...scene, project: { ...scene.project, viewport: nextViewport } }));
    viewport = nextViewport;
    canvas.width = viewport.width; canvas.height = viewport.height;
    placeholderSurface.width = viewport.width; placeholderSurface.height = viewport.height;
    const next = createStudioSequenceV1({ viewport, scenes, assets: assetRegistry.sequence.assets });
    editSequence(next, { sceneId: currentSceneId, seekToStart: false });
    renderImages.clear();
  }

  function dispose() {
    disposed = true;
    playing = false;
    stopAnimationFrame();
    for (const bitmap of decodedImages.values()) bitmap?.close?.();
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    decodedImages.clear();
    renderImages.clear();
    objectUrls.clear();
  }

  render();
  return Object.freeze({
    addImage,
    addScene,
    deleteImage,
    deleteScene,
    dispose,
    duplicateScene,
    getState() {
      return makeState(sampleStudioSequence(compiledSequence, clock.time()));
    },
    moveScene,
    pause,
    play,
    seek,
    selectScene,
    setDuration(seconds) {
      if (!Number.isFinite(seconds)) throw new TypeError("مدة غير صالحة.");
      const scene = selectedScene();
      const durationMs = Math.round(seconds * 1000);
      if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) throw new RangeError("المدة بين 3 و60 ثانية.");
      const project = { ...scene.project, durationMs };
      const motion = motionSettings.get(scene.id) ?? { ...DEFAULT_MOTION };
      refreshSceneProject(scene.id, sceneProjectForMotion({ ...scene, project }, motion), motion);
    },
    setMotionPreset(preset) { updateMotion({ preset }); },
    setMotionSpeed(speed) { updateMotion({ speed: Number(speed) }); },
    setMotionStrength(strength) { updateMotion({ strength: Number(strength) }); },
    setFit,
    setAspectRatio,
    stop,
    togglePlayback() { playing ? pause() : play(); }
  });
}

