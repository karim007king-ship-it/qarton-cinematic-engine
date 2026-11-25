Warning: truncated output (original token count: 37941)
Total output lines: 2644

import { errorText, setExportErrorMessage } from "./studio-errors.js";
import { compileProject, sampleFrame, planExport, rasterForQuality, probeExport, startExport } from "@qarton/cinematic-engine/motion-studio";
import { createStudioSequenceV1 } from "@qarton/cinematic-engine/motion-studio";
import { createRequestToken, makeProject, makeProjectFile, parseProjectFile, prepareProjectUpdate, VIEWPORT } from "./studio-model.js?v=l7b-character-01";
import { decodeImageBitmap } from "./studio-image.js?v=l4-flex-01";
import { DEFAULT_OUTPUT_VIEWPORT, imageRect, inferAspectPreset, projectSizeForPreset, safePreviewSize } from "./studio-dimensions.js?v=l4-flex-01";
import {
  EXPORT_PROFILES, chooseDefaultFormat, createExportLock, createRecordingSession, estimateVideoBytes,
  exportDurationMs, exportFrameCount, exportFrameTime, exportViewportFor, extensionForMime, projectForRaster, projectTimeAt,
  scheduleTestPulses, supportedCandidates
} from "./studio-export-core.js?v=l5-export-01";
import { createStudioTimeline } from "./studio-timeline.js?v=l6b-cleanup-01";
import { compileCharacterTrack, makeCharacterTrack } from "./studio-character-track.js?v=l7b-character-01";
import { createCharacterTimeline } from "./studio-character-timeline.js?v=l7b-character-01";
import { compileAudioTracks, makeAudioTracks, addAudioClip, editAudioClip, deleteAudioClip, setAudioTrackVolume, setAudioViseme, validateAudioFile, readAudioDuration } from "./studio-audio-model.js?v=l8b-audio-timeline-01";
import { createStudioAudioTimeline } from "./studio-audio-timeline.js?v=l8b-audio-timeline-01";
import { createCinematicAudioPlayer } from "../../src/audio/cinematic-audio-core.js";
import { addVisualEffect, deleteVisualEffect, editVisualEffect, moveVisualEffect, makeVisualEffectsTrack, compileVisualEffectsTrack, VISUAL_EFFECT_CHANNELS, VISUAL_EFFECT_TYPES } from "./studio-visual-effects-model.js?v=l9b-effects-01";
import { createStudioVisualEffectsTimeline } from "./studio-visual-effects-timeline.js?v=l9b-effects-01";
import { drawStudioScene } from "./studio-scene-renderer.js?v=l10b-integrated-01";
import { createStudioSequenceEditor, parseStudioSequenceFile, serializeStudioSequenceFile, STUDIO_SEQUENCE_FILE_FORMAT } from "./studio-sequence-editor.js?v=l11d-multiscene-01";
import { CAMERA_MOTION_PRESETS, createCameraMotionProject } from "./studio-motion-presets.js?v=l11f1-smart-editor-01";
import { createPersistentAssetRegistry } from "../../packages/motion-studio/asset-persistence.js";
import { openAssetStorage } from "../../packages/motion-studio/asset-storage.js";
import { prepareStudioSequenceExport } from "./studio-sequence-export.js?v=l11e-sequence-export-01";
import { createStudioSequenceRuntime, decodeStudioSequenceAudio } from "./studio-sequence-runtime.js?v=l11h4-integrated-01";

const $ = (id) => document.getElementById(id);
const studioRoot = document.querySelector(".studio");
let activeEditorSection = "motion";

function mountCompactWorkspace() {
  const workspace = studioRoot.querySelector(".workspace");
  const preview = workspace?.querySelector(".preview-panel");
  const controls = workspace?.querySelector(".controls-panel");
  if (!workspace || !preview || !controls) return;
  const panel = (name) => document.querySelector(`[data-tool-panel="${name}"]`);
  const previewHeading = preview.querySelector(".preview-heading");
  const stageWrap = preview.querySelector(".stage-wrap");
  const transport = preview.querySelector(".transport");
  const sceneSection = $("sceneSection");
  const imagePicker = $("previewImagePicker");
  const projectCard = controls.querySelector(".project-card");
  const imageLabel = projectCard?.querySelector("label.file-picker[for='imageInput']");
  if (imageLabel) imagePicker.append(imageLabel, $("imageInput"));
  if (previewHeading) {
    const fullscreen = document.createElement("button");
    fullscreen.id = "fullscreenPreviewButton";
    fullscreen.type = "button";
    fullscreen.className = "fullscreen-button";
    fullscreen.setAttribute("aria-label", "ملء الشاشة");
    fullscreen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    previewHeading.append(fullscreen);
  }
  $("previewCanvasHost").append(previewHeading, stageWrap);
  $("previewTransportHost").append(transport);
  const camTimeline = preview.querySelector(".timeline-card:not(.character-timeline-card):not(.audio-timeline-card):not(.visual-effects-card)");
  const characterTimeline = preview.querySelector(".character-timeline-card");
  const audioTimelinePanel = $("audioToolsSection");
  const effectsTimelinePanel = $("effectsToolsSection");
  const motionPanel = panel("motion");
  const morePanel = panel("more");
  const advancedMotion = $("professionalMotionControls");
  const advancedMotionContent = $("advancedMotionContent");
  motionPanel.append($("automaticMotionPanel"), $("simpleMotionPanel"), advancedMotion);
  if (camTimeline) advancedMotionContent.append(camTimeline);
  if (characterTimeline) advancedMotionContent.append(characterTimeline);
  const cards = [...controls.querySelectorAll(":scope > .control-card")];
  const [dimensionsCard, durationCard, cameraCard, legacyExportCard, integratedExportCard] = cards.slice(1);
  if (sceneSection) panel("scenes").append(sceneSection);
  if (audioTimelinePanel) panel("audio").append(audioTimelinePanel);
  if (effectsTimelinePanel) panel("effects").append(effectsTimelinePanel);
  if (projectCard) morePanel.append(projectCard);
  const advancedProject = document.createElement("details");
  advancedProject.id = "advancedProjectOptions";
  advancedProject.className = "advanced-options project-options";
  advancedProject.innerHTML = '<summary>إعدادات المشروع المتقدمة</summary>';
  for (const card of [dimensionsCard, durationCard, cameraCard]) if (card) advancedProject.append(card);
  if (legacyExportCard) {
    const legacy = document.createElement("details");
    legacy.id = "legacyExportDetails";
    legacy.className = "advanced-options";
    legacy.innerHTML = '<summary>التصدير القديم L5</summary>';
    legacy.append(legacyExportCard);
    advancedProject.append(legacy);
  }
  if (integratedExportCard) {
    integratedExportCard.querySelector("h2").textContent = "تصدير الفيديو";
    const hint = integratedExportCard.querySelector(":scope > .hint");
    if (hint) hint.textContent = "أنشئ فيديو من المشهد الحالي مع الحركة والصوت والمؤثرات.";
    const options = integratedExportCard.querySelector(":scope > .control-grid");
    if (options) {
      const details = document.createElement("details");
      details.className = "advanced-options export-options";
      details.innerHTML = '<summary>خيارات الجودة والصيغة المتقدمة</summary>';
      details.append(options);
      integratedExportCard.insertBefore(details, integratedExportCard.querySelector(".export-actions"));
    }
    morePanel.append(integratedExportCard);
  }
  morePanel.append(advancedProject);
  controls.remove();
  workspace.remove();
  sceneSection.querySelector(".asset-library")?.removeAttribute("open");
  document.querySelector(".studio-footer")?.remove();
  document.querySelector("#professionalMotionControls").open = false;
}
mountCompactWorkspace();
const canvas = $("stage");
const context = canvas.getContext("2d", { alpha: false });
const imageInput = $("imageInput");
const projectInput = $("projectInput");
const seek = $("seek");
const timelineLane = $("timelineLane");
const timelineRuler = $("timelineRuler");
const timelinePlayhead = $("timelinePlayhead");
const timelineKeyframes = $("timelineKeyframes");
const timelineSelection = $("timelineSelection");
const timelineMessage = $("timelineMessage");
const addKeyframeButton = $("addKeyframeButton");
const deleteKeyframeButton = $("deleteKeyframeButton");
const keyframeFields = { x: $("keyframeX"), y: $("keyframeY"), zoom: $("keyframeZoom"), rotation: $("keyframeRotation") };
const status = $("status");
const errorMessage = $("errorMessage");
const imageName = $("imageName");
const timeReadout = $("timeReadout");
const playPauseButton = $("playPauseButton");
const aspectSelect = $("aspectPreset");
const fitSelect = $("fitMode");
const imageRequest = createRequestToken();
const audioRequest = createRequestToken();
const exportLock = createExportLock();
const exportFormat = $("exportFormat");
const exportDuration = $("exportDuration");
const exportQuality = $("exportQuality");
const exportAudioEnabled = $("exportAudioEnabled");
const exportButton = $("exportButton");
const cancelExportButton = $("cancelExportButton");
const exportStatus = $("exportStatus");
const exportProgress = $("exportProgress");
const exportVideo = $("exportVideo");
const exportDownload = $("exportDownload");
const exportMetadata = $("exportMetadata");
const exportError = $("exportError");
const tryWebmButton = $("tryWebmButton");
const integratedQuality = $("integratedQuality");
const integratedFormat = $("integratedFormat");
const integratedAudio = $("integratedAudio");
const integratedMissingAudio = $("integratedMissingAudio");
const integratedFrom = $("integratedFrom");
const integratedTo = $("integratedTo");
const integratedProbeButton = $("integratedProbeButton");
const integratedExportButton = $("integratedExportButton");
const integratedProgress = $("integratedProgress");
const integratedStatus = $("integratedStatus");
const integratedError = $("integratedError");
const integratedVideo = $("integratedVideo");
const integratedDownload = $("integratedDownload");
const integratedMetadata = $("integratedMetadata");
let activeExport = null;
let exportVideoUrl = null;
let integratedVideoUrl = null;
let exportCapability = { mp4: [], webm: [] };
const integratedCapabilities = new Map();
let exportFormatInitialized = false;
let pendingImageRequest = null;
let exportStatusHasResult = false;

let aspectPreset = "original";
let fitMode = "fit";
let previewViewport = safePreviewSize(DEFAULT_OUTPUT_VIEWPORT.width, DEFAULT_OUTPUT_VIEWPORT.height);
let placeholder = makePlaceholder(previewViewport);
let imageSource = placeholder;
let selectedImageFile = null;
let selectedImageDimensions = null;
let currentFileInfo = null;
let project = makeProject({
  durationMs: 12000, viewport: { ...DEFAULT_OUTPUT_VIEWPORT, fps: VIEWPORT.fps },
  startZoom: 1, endZoom: 1.25, startX: 0, endX: 0, startY: 0, endY: 0
});
let visualEffectsTrack = makeVisualEffectsTrack();
let currentMs = 0;
let isPlaying = false;
let pausedAt = null;
let rafId = 0;
let quickMotionUndo = null;
let committingQuickMotion = false;

canvas.width = previewViewport.width;
canvas.height = previewViewport.height;
canvas.style.aspectRatio = `${previewViewport.width} / ${previewViewport.height}`;

const sceneImageSources = new Map();
const imageProvider = { get: (assetId) => sceneImageSources.get(assetId) ?? (project.layers.some((layer) => layer.assetId === assetId) ? imageSource : null) };
let compiled;
let visualEffectsCompiled;
let timelineEditor = null;
let characterTrack = makeCharacterTrack();
let characterAnimation = compileCharacterTrack(characterTrack, project.durationMs);
let characterTimeline = null;
let audioTracks = makeAudioTracks();
let audioAssets = [];
const audioFiles = new Map();
let activeAudioAssetId = null;
let audioAssetSerial = 0;
let audioPlayer = null;
let audioCompiled = compileAudioTracks(audioTracks, project.durationMs);
let audioMasterVolume = 1;
let audioClipSelection = null;
let audioTimeline = null;
let pendingAudioRequest = null;
let microphoneButton = null;
let microphoneSession = null;
let microphoneStarting = false;
let microphoneFinalizing = false;
let visualEffectsTimeline = null;
let visualEffectSelection = null;
const makeLocalId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const initialImageAsset = { id: project.layers[0].assetId, kind: "image", name: "image-placeholder.png", mimeType: "image/png", size: 0 };
const CURRENT_PROJECT_KEY = "qarton-motion-studio-current-project";
function readStoredProjectId() {
  try {
    const id = localStorage.getItem(CURRENT_PROJECT_KEY);
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id) ? id : null;
  } catch { return null; }
}
let projectStorageId = readStoredProjectId() ?? makeLocalId("project");
const AUDIO_DURATION_METADATA_PREFIX = "qarton-motion-studio-audio-durations:";
function readAudioDurationHint(assetId) {
  try {
    const metadata = JSON.parse(localStorage.getItem(`${AUDIO_DURATION_METADATA_PREFIX}${projectStorageId}`) || "{}");
    const durationMs = metadata?.[assetId];
    if (Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= 3_600_000) return durationMs;
  } catch { /* Storage metadata is advisory; the browser decoder remains authoritative when available. */ }
  let inferredMs = 0;
  for (const scene of sequenceEditor?.sequence.scenes ?? []) for (const track of scene.audioTracks) {
    for (const clip of track.clips) if (clip.asset === assetId && Number.isSafeInteger(clip.durationMs)) {
      inferredMs = Math.max(inferredMs, clip.durationMs);
    }
  }
  return inferredMs;
}
function rememberAudioDuration(assetId, durationMs) {
  const value = Math.round(durationMs);
  if (typeof assetId !== "string" || !Number.isSafeInteger(value) || value <= 0 || value > 3_600_000) return false;
  try {
    const key = `${AUDIO_DURATION_METADATA_PREFIX}${projectStorageId}`;
    let metadata = {};
    try { metadata = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* Replace corrupt advisory metadata. */ }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) metadata = {};
    metadata[assetId] = value;
    const keys = Object.keys(metadata);
    for (const staleId of keys.slice(0, Math.max(0, keys.length - 256))) delete metadata[staleId];
    localStorage.setItem(key, JSON.stringify(metadata));
    return true;
  } catch { return false; }
}
let sequenceEditor = createStudioSequenceEditor(createStudioSequenceV1({
  viewport: project.viewport,
  scenes: [{ id: "scene-1", project, audioTracks, characterTracks: [characterTrack], visualEffectsTrack }],
  assets: [initialImageAsset]
}), { names: { "scene-1": "المشهد 1" } });
let activeSceneId = sequenceEditor.activeSceneId;
let sequenceTimeMs = 0;
let sequenceEpochMs = 0;
let sequenceBaseMs = 0;
let assetStorage = null;
let persistentAssets = null;
let assetStorageStatus = "جارٍ فتح التخزين المحلي…";
const localAssetFiles = new Map();
const sceneSettings = new Map([[activeSceneId, { aspectPreset, fitMode, image: null }]]);
const sceneThumbnails = new Map();
let sceneLoadToken = 0;
let pendingSceneActivation = null;
let exportPreparing = false;
let sequenceAutosaveTimer = 0;
const assetReady = openAssetStorage().then(async storage => {
  assetStorage = storage;
  persistentAssets = createPersistentAssetRegistry(sequenceEditor.sequence, { storage, projectId: projectStorageId });
  await persistentAssets.restore();
  assetStorageStatus = "محفوظة محليًا على هذا الجهاز";
  renderAssetLibrary();
}).catch(error => {
  assetStorageStatus = `التخزين المحلي غير متاح: ${errorText(error)}`;
  $("assetLibraryMessage").textContent = assetStorageStatus;
  return null;
});

function compilePreviewEffects(track, sourceProject = project, viewport = previewViewport) {
  return compileVisualEffectsTrack(track, projectForRaster(sourceProject, viewport));
}
function getCurrentScene() { return sequenceEditor.scenes.find(scene => scene.id === activeSceneId) ?? null; }
function microphoneOperationActive() { return microphoneStarting || microphoneSession !== null || microphoneFinalizing; }
function currentScenePayload() {
  return { id: activeSceneId, project, audioTracks, characterTracks: [characterTrack, ...(sceneExtraCharacterTracks.get(activeSceneId) ?? [])], visualEffectsTrack };
}
function sceneImageSettings(sceneId = activeSceneId) {
  const stored = sceneSettings.get(sceneId);
  if (stored?.aspectPreset && stored?.fitMode) return stored;
  const scene = sequenceEditor.sequence.scenes.find(item => item.id === sceneId);
  return { aspectPreset: scene ? inferAspectPreset(scene.project.viewport.width, scene.project.viewport.height) : aspectPreset, fitMode: "fit" };
}
const sceneExtraCharacterTracks = new Map();
function captureCurrentScene({ refresh = false } = {}) {
  if (!sequenceEditor) return null;
  const next = sequenceEditor.updateScene(activeSceneId, () => currentScenePayload());
  void persistentAssets?.replaceSequence(next.sequence).catch(error => {
    $("assetLibraryMessage").textContent = `تعذر تحديث فهرس الأصول: ${errorText(error)}`;
  });
  persistSequenceMetadata();
  if (refresh) renderSequenceOverview();
  return next;
}
function scheduleSequenceAutosave() {
  if (sequenceAutosaveTimer) clearTimeout(sequenceAutosaveTimer);
  sequenceAutosaveTimer = setTimeout(() => {
    sequenceAutosaveTimer = 0;
    try { captureCurrentScene(); }
    catch (error) { $("assetLibraryMessage").textContent = `تعذر حفظ تعديلات المشهد: ${errorText(error)}`; }
  }, 250);
}
async function ensureAssetStorage() {
  await assetReady;
  if (!persistentAssets) throw new Error("التخزين المحلي غير متاح في هذا المتصفح.");
  return persistentAssets;
}
function mimeForFile(file) {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.toLowerCase().split(".").at(-1);
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif",
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", webm: "audio/webm" })[ext] ?? "";
}
function sequenceAssetFromFile(file, id = makeLocalId("asset")) {
  let mimeType = mimeForFile(file);
  const kind = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : null;
  if (!kind || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 64 * 1024 * 1024) {
    throw new TypeError("اختر صورة أو ملف صوت صالحًا بحجم لا يتجاوز 64 MiB.");
  }
  if (kind === "audio") mimeType = validateAudioFile(file).mime;
  return { id, kind, name: file.name.slice(0, 255), mimeType, size: file.size };
}
async function registerAssetFile(file) {
  await assetReady;
  const registry = persistentAssets;
  const candidate = sequenceAssetFromFile(file);
  // Matching metadata alone does not establish identical asset contents.
  let found;
  for (const existing of sequenceEditor.sequence.assets) {
    if (existing.kind !== candidate.kind || existing.name !== candidate.name ||
        existing.mimeType !== candidate.mimeType || existing.size !== candidate.size) continue;
    const previous = getAssetBlob(existing.id);
    // Preserve explicit relinking of an imported asset whose bytes are missing.
    if (!previous) { found = existing; break; }
    let identical = true;
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      const end = Math.min(file.size, offset + 1024 * 1024);
      const left = new Uint8Array(await previous.slice(offset, end).arrayBuffer());
      const right = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      if (left.length !== right.length || !left.every((value, index) => value === right[index])) {
        identical = false;
        break;
      }
    }
    if (identical) { found = existing; break; }
  }
  const asset = found ?? candidate;
  const linkedFile = (file.type || "").toLowerCase() === candidate.mimeType ? file : new File([file], file.name, { type: candidate.mimeType });
  if (!found) {
    const oldSequence = sequenceEditor.sequence;
    const next = createStudioSequenceV1({ viewport: oldSequence.viewport, scenes: oldSequence.scenes,
      assets: [...oldSequence.assets, asset] });
    sequenceEditor.replaceSequence(next);
    await registry?.replaceSequence(next);
  }
  localAssetFiles.set(asset.id, linkedFile);
  if (registry && !registry.get(asset.id)) await registry.relink(asset.id, linkedFile);
  renderAssetLibrary();
  persistSequenceMetadata();
  return asset;
}
function getAssetBlob(id) { return persistentAssets?.get(id) ?? localAssetFiles.get(id) ?? null; }
function assetMetadataToAudio(asset) {
  return { id: asset.id, name: asset.name, type: asset.mimeType, size: asset.size };
}
function persistSequenceMetadata() {
  try {
    const settingsByScene = Object.fromEntries(sequenceEditor.scenes.map(scene => {
      const settings = sceneImageSettings(scene.id);
      return [scene.id, { aspectPreset: settings.aspectPreset, fitMode: settings.fitMode }];
    }));
    const text = serializeStudioSequenceFile(sequenceEditor, { projectId: projectStorageId, aspectPreset, fitMode, audioMasterVolume, sceneSettings: settingsByScene });
    localStorage.setItem(`qarton-motion-studio-sequence:${projectStorageId}`, text);
    // Publish the current-project pointer only after its metadata is saved.
    localStorage.setItem(CURRENT_PROJECT_KEY, projectStorageId);
  } catch (error) {
    $("assetLibraryMessage").textContent = `تعذر حفظ بيانات التسلسل محليًا: ${errorText(error)}`;
  }
}
async function restoreMostRecentSequence() {
  try {
    const id = readStoredProjectId();
    if (!id) return;
    const text = localStorage.getItem(`qarton-motion-studio-sequence:${id}`);
    if (!text) return;
    const loaded = parseStudioSequenceFile(text);
    aspectPreset = loaded.settings.aspectPreset; fitMode = loaded.settings.fitMode; audioMasterVolume = loaded.audioMasterVolume;
    aspectSelect.value = aspectPreset; fitSelect.value = fitMode; $("audioMasterVolume").value = String(audioMasterVolume);
    await attachSequenceProject(loaded.editor, loaded.projectId, loaded.sceneSettings);
    await activateStudioScene(sequenceEditor.scenes[0].id, { globalTimeMs: 0, localTimeMs: 0 });
    $("assetLibraryMessage").textContent = "استُعيد تسلسل المشروع من هذا الجهاز. الأصول غير المتاحة تحتاج إلى إعادة ربط.";
  } catch (error) { $("assetLibraryMessage").textContent = `تعذر استعادة التسلسل المحلي: ${errorText(error)}`; }
}
async function attachSequenceProject(nextEditor, nextProjectId, nextSceneSettings = null) {
  await assetReady;
  sequenceEditor = nextEditor;
  projectStorageId = nextProjectId;
  activeSceneId = sequenceEditor.activeSceneId;
  sceneSettings.clear();
  for (const scene of sequenceEditor.scenes) {
    const stored = nextSceneSettings?.[scene.id];
    sceneSettings.set(scene.id, stored
      ? { ...stored, image: null }
      : { aspectPreset: inferAspectPreset(scene.project.viewport.width, scene.project.viewport.height), fitMode: fitMode, image: null });
  }
  persistentAssets = assetStorage ? createPersistentAssetRegistry(sequenceEditor.sequence, { storage: assetStorage, projectId: projectStorageId }) : null;
  if (persistentAssets) {
    const missing = await persistentAssets.restore();
    $("assetLibraryMessage").textContent = missing.length
      ? `تم فتح المشروع. أعد ربط ${missing.length} أصل من مكتبة هذا الجهاز.`
      : "تم فتح المشروع واستعادة الأصول المحلية.";
  }
  renderSequenceOverview();
  persistSequenceMetadata();
}

function makePlaceholder(size) {
  const surface = document.createElement("canvas");
  surface.width = size.width;
  surface.height = size.height;
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "#171820";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.fillStyle = "#e7bd69";
  ctx.textAlign = "center";
  ctx.font = `bold ${Math.max(16, Math.min(38, size.width / 18))}px system-ui, sans-serif`;
  ctx.fillText("اختر صورة للبدء", size.width / 2, size.height / 2);
  return surface;
}

function fail(error) {
  errorMessage.textContent = errorText(error);
  errorMessage.hidden = false;
  status.textContent = "تعذّرت العملية";
}
function clearFailure() { errorMessage.hidden = true; errorMessage.textContent = ""; }
function formatTime(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
// Both export paths own a video element and an object URL. Release them consistently.
function resetExportMedia(video, download, objectUrl) {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.hidden = true;
  download.hidden = true;
  download.removeAttribute("href");
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  return null;
}
function clearExportResult() {
  exportStatusHasResult = false;
  exportError.hidden = true;
  exportError.textContent = "";
  tryWebmButton.hidden = true;
  exportVideoUrl = resetExportMedia(exportVideo, exportDownload, exportVideoUrl);
  exportMetadata.textContent = "لم يُنشأ فيديو بعد.";
  exportProgress.value = 0;
}
function clearIntegratedResult() {
  integratedError.hidden = true;
  integratedError.textContent = "";
  integratedProgress.value = 0;
  integratedVideoUrl = resetExportMedia(integratedVideo, integratedDownload, integratedVideoUrl);
  integratedMetadata.textContent = "لم يُنشأ تصدير متكامل بعد.";
}
function cancelActiveExport(reason = "تغير المشروع أثناء التصدير.") {
  const running = activeExport;
  if (!running) return;
  const abortError = new DOMException(reason, "AbortError");
  running.controller.abort(abortError);
  running.session?.cancel(abortError);
  if (running.rafId) cancelAnimationFrame(running.rafId);
  if (running.stopTimer) clearTimeout(running.stopTimer);
  if (running.kind === "integrated") integratedStatus.textContent = "جارٍ إلغاء التصدير وتنظيف موارد الصوت والصورة…";
  else exportStatus.textContent = "جارٍ إيقاف التسجيل وتنظيف الموارد…";
}
function invalidateExport(reason) {
  cancelActiveExport(reason);
  clearExportResult();
  clearIntegratedResult();
  refreshExportControls();
}
function refreshExportControls() {
  studioRoot.dataset.imageReady = String(Boolean(currentFileInfo));
  const RecorderClass = typeof MediaRecorder === "function" ? MediaRecorder : null;
  const hasMediaRecorder = Boolean(RecorderClass && typeof canvas.captureStream === "function");
  exportCapability = {
    mp4: hasMediaRecorder ? supportedCandidates(RecorderClass, "mp4") : [],
    webm: hasMediaRecorder ? supportedCandidates(RecorderClass, "webm") : []
  };
  for (const format of ["mp4", "webm"]) {
    const option = exportFormat.querySelector(`option[value="${format}"]`);
    option.disabled = exportCapability[format].length === 0;
    option.textContent = `${format.toUpperCase()}${option.disabled ? " · غير مدعوم" : " · متاح"}`;
  }
  const preferred = chooseDefaultFormat(RecorderClass);
  if (preferred && (!exportFormatInitialized || exportCapability[exportFormat.value]?.length === 0)) exportFormat.value = preferred;
  exportFormatInitialized = true;
  const available = Boolean(preferred);
  const recordingBlocked = microphoneOperationActive();
  exportButton.disabled = !available || !currentFileInfo || Boolean(activeExport) || recordingBlocked || pendingImageRequest !== null || pendingAudioRequest !== null;
  exportFormat.disabled = Boolean(activeExport || recordingBlocked);
  if (!exportStatusHasResult && !activeExport) {
    exportStatus.textContent = !hasMediaRecorder
      ? "التصدير غير متاح: هذا المتصفح لا يوفر MediaRecorder وCanvas captureStream."
      : available
        ? `فحص MediaRecorder: MP4 ${exportCapability.mp4.length ? "مدعوم" : "غير مدعوم"}، WebM ${exportCapability.webm.length ? "مدعوم" : "غير مدعوم"}. قد يرفض الجهاز بدء التسجيل رغم الفحص.`
        : "لا يدعم هذا المتصفح WebM ولا MP4 عبر MediaRecorder.";
  }
  refreshIntegratedControls();
}
function integratedRaster() {
  return rasterForQuality(project.viewport, integratedQuality.value);
}
function integratedCapabilityKey() {
  const raster = integratedRaster();
  return `${raster.width}x${raster.height}:${project.viewport.fps}:${integratedAudio.value}:${integratedFormat.value}`;
}
function refreshIntegratedControls() {
  let hasVerified = false;
  try { hasVerified = getVerifiedIntegratedCapabilities().length > 0; }
  catch { hasVerified = false; }
  const blocked = Boolean(activeExport || microphoneOperationActive() || pendingImageRequest !== null || pendingAudioRequest !== null || !currentFileInfo);
  integratedProbeButton.disabled = blocked;
  integratedExportButton.disabled = blocked || !hasVerified;
  integratedExportButton.textContent = blocked ? "التصدير غير متاح حاليًا" : hasVerified ? "تصدير المشروع مع الصوت" : "افحص الصيغة والدقة أولًا";
  integratedExportButton.title = blocked ? "انتظر اكتمال تحميل الأصول أو انتهاء التصدير" : hasVerified ? "ابدأ تصدير المشروع" : "اضغط زر فحص الصيغة والدقة";
  for (const control of [integratedQuality, integratedFormat, integratedAudio, integratedMissingAudio, integratedFrom, integratedTo]) control.disabled = Boolean(activeExport || microphoneOperationActive());
}
function refreshMicrophoneBusyControls() {
  const recording = microphoneOperationActive();
  if (microphoneButton) {
    microphoneButton.textContent = microphoneStarting ? "انتظر إذن الميكروفون…"
      : microphoneFinalizing ? "جارٍ اعتماد التسجيل…"
        : microphoneSession ? "إيقاف التسجيل" : "تسجيل بالميكروفون";
    microphoneButton.disabled = microphoneStarting || microphoneFinalizing || (!microphoneSession && (Boolean(activeExport) || pendingAudioRequest !== null));
  }
  const locked = recording || Boolean(activeExport);
  for (const id of ["imageInput", "projectInput", "audioInput", "audioTrackType", "addAudioClip", "deleteAudioClip", "audioClipStart", "audioClipDuration", "audioClipVolume", "sceneName", "sceneDuration", "addSceneButton", "duplicateSceneButton", "deleteSceneButton", "moveSceneLeftButton", "moveSceneRightButton", "playPauseButton", "replayButton", "seek", "sequenceSeek", "duration", "aspectPreset", "fitMode", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "saveProjectButton", "loadProjectButton"]) {
    const control = $(id); if (control) control.disabled = locked;
  }
  for (const control of document.querySelectorAll(".scene-select, .sequence-block")) control.disabled = locked;
  timelineEditor?.setBusy(locked);
  characterTimeline?.setBusy(locked);
  audioTimeline?.setBusy(locked);
  visualEffectsTimeline?.setBusy(locked);
  if (!recording) {
    renderAudioInspector();
    renderVisualEffectInspector();
    renderSequenceOverview({ rebuildCards: false, rebuildAssets: false });
  }
  refreshExportControls();
}
function setExportBusy(busy) {
  const locked = busy || microphoneOperationActive();
  for (const id of ["imageInput", "projectInput", "audioInput", "audioTrackType", "addAudioClip", "deleteAudioClip", "audioClipStart", "audioClipDuration", "audioClipVolume", "dialogueLanguage", "visemeType", "phonemeLabel", "addViseme", "audioMasterVolume", "visualEffectType", "addVisualEffect", "deleteVisualEffect", "visualEffectStart", "visualEffectDuration", "visualEffectEasing", "aspectPreset", "fitMode", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "saveProjectButton", "loadProjectButton", "motionSpeed", "motionStrength", "motionFocusX", "motionFocusY", "motionFromSeconds", "motionToSeconds", "integratedQuality", "integratedFormat", "integratedAudio", "integratedMissingAudio", "integratedFrom", "integratedTo"]) {
    $(id).disabled = locked;
  }
  for (const button of document.querySelectorAll("[data-motion-preset]")) button.disabled = locked;
  for (const id of ["sceneName", "sceneDuration", "addSceneButton", "duplicateSceneButton", "deleteSceneButton", "moveSceneLeftButton", "moveSceneRightButton", "playPauseButton", "replayButton", "seek", "sequenceSeek"]) {
    const control = $(id); if (control) control.disabled = locked;
  }
  for (const button of document.querySelectorAll(".scene-select, .sequence-block")) button.disabled = locked;
  timelineEditor?.setBusy(busy);
  characterTimeline?.setBusy(busy);
  audioTimeline?.setBusy(busy);
  visualEffectsTimeline?.setBusy(busy);
  if (microphoneOperationActive()) {
    timelineEditor?.setBusy(true);
    characterTimeline?.setBusy(true);
    audioTimeline?.setBusy(true);
    visualEffectsTimeline?.setBusy(true);
  }
  renderVisualEffectInspector();
  renderAudioInspector();
  exportButton.disabled = locked || !currentFileInfo || !exportCapability.mp4.length && !exportCapability.webm.length;
  exportFormat.disabled = locked;
  exportDuration.disabled = locked;
  exportQuality.disabled = locked;
  exportAudioEnabled.disabled = locked;
  if (microphoneButton) microphoneButton.disabled = busy || microphoneStarting || microphoneFinalizing || (!microphoneSession && pendingAudioRequest !== null);
  cancelExportButton.hidden = !busy;
  cancelExportButton.disabled = !busy;
  integratedProbeButton.disabled = locked || !currentFileInfo || pendingImageRequest !== null || pendingAudioRequest !== null;
  integratedExportButton.disabled = locked || !currentFileInfo || getVerifiedIntegratedCapabilities().length === 0;
  refreshMotionUndoButtons();
}
function createTestAudioGraph() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("المسار الصوتي الاختباري غير متاح؛ أوقف خيار الصوت أو استخدم متصفحًا يدعم Web Audio.");
  const audio = new AudioContextClass();
  const destination = audio.createMediaStreamDestination();
  const gain = audio.createGain();
  gain.gain.value = 0.18;
  gain.connect(destination);
  return { audio, stream: destination.stream, gain };
}
function renderExportFrame(ctx, exportCompiled, exportCharacter, exportAudio, exportEffects, elapsedMs, exportLengthMs) {
  const projectMs = projectTimeAt(elapsedMs, exportLengthMs, exportCompiled.durationMs);
  return drawStudioScene({ ctx, compiledProject: exportCompiled, timeMs: projectMs,
    characterAnimation: exportCharacter, characterTrack, audioSample: exportAudio.sample(projectMs),
    visualEffectsCompiled: exportEffects, viewport: exportCompiled.viewport });
}
async function exportVideoFile() {
  if (microphoneOperationActive()) return;
  const unlock = exportLock.acquire();
  if (!unlock) return;
  if (!currentFileInfo) {
    unlock();
    exportStatus.textContent = "اختر صورة قبل تصدير الفيديو.";
    return;
  }
  const candidates = exportCapability[exportFormat.value] || [];
  if (!candidates.length) {
    unlock();
    exportStatus.textContent = `الصيغة ${exportFormat.value.toUpperCase()} غير مدعومة في هذا المتصفح.`;
    return;
  }

  clearFailure();
  clearExportResult();
  const controller = new AbortController();
  const running = { kind: "legacy", controller, session: null, rafId: 0, stopTimer: 0 };
  activeExport = running;
  setExportBusy(true);
  exportError.hidden = true;
  const quality = exportQuality.value;
  const profile = EXPORT_PROFILES[quality];
  const exportLengthMs = exportDurationMs(exportDuration.value, project.durationMs);
  const expectedBytes = estimateVideoBytes(exportLengthMs, profile.videoBitsPerSecond + (exportAudioEnabled.checked ? 96_000 : 0));
  const maxVideoBytes = 24 * 1024 * 1024;
  let stream;
  let audioGraph;
  let exportCanvas;
  let result = null;
  try {
    if (expectedBytes > maxVideoBytes) throw new RangeError("الحجم المتوقع يتجاوز 24 ميغابايت؛ اختر مدة أو جودة أقل.");
    const rasterViewport = exportViewportFor(project.viewport, quality);
    exportCanvas = document.createElement("canvas");
    exportCanvas.width = rasterViewport.width;
    exportCanvas.height = rasterViewport.height;
    const exportContext = exportCanvas.getContext("2d", { alpha: false });
    if (!exportContext) throw new Error("لم تتوفر ذاكرة كافية لإنشاء Canvas التصدير.");
    const exportCompiled = compileProject(projectForRaster(project, rasterViewport), imageProvider);
    const exportCharacter = compileCharacterTrack(characterTrack, exportCompiled.durationMs);
    const exportAudio = compileAudioTracks(audioTracks, exportCompiled.durationMs);
    const exportEffects = compilePreviewEffects(visualEffectsTrack, project, rasterViewport);
    renderExportFrame(exportContext, exportCompiled, exportCharacter, exportAudio, exportEffects, 0, exportLengthMs);
    stream = exportCanvas.captureStream(rasterViewport.fps);
    if (exportAudioEnabled.checked) {
      audioGraph = createTestAudioGraph();
      const audioTrack = audioGraph.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error("لم ينشئ Web Audio مسارًا صوتيًا للتسجيل.");
      stream.addTrack(audioTrack);
      await audioGraph.audio.resume();
      if (controller.signal.aborted) throw controller.signal.reason;
    }

    const mimeType = candidates[0];
    running.session = createRecordingSession({
      stream, mimeType, durationMs: exportLengthMs, videoBitsPerSecond: profile.videoBitsPerSecond,
      maxBytes: maxVideoBytes, signal: controller.signal, autoStop: false
    });
    if (audioGraph) scheduleTestPulses(audioGraph.audio, audioGraph.gain, exportLengthMs);
    const videoTrack = stream.getVideoTracks()[0];
    const nominalIntervalMs = 1000 / rasterViewport.fps;
    const totalFrames = exportFrameCount(exportLengthMs, rasterViewport.fps);
    let lastFrameIndex = -1;
    const presentFrame = (frameIndex) => {
      if (frameIndex <= lastFrameIndex) return;
      const frameMs = exportFrameTime(frameIndex, rasterViewport.fps, exportLengthMs);
      renderExportFrame(exportContext, exportCompiled, exportCharacter, exportAudio, exportEffects, frameMs, exportLengthMs);
      try { videoTrack?.requestFrame?.(); } catch { /* timed captureStream(fps) remains the fallback */ }
      lastFrameIndex = frameIndex;
    };
    presentFrame(0);
    exportStatus.textContent = `جارٍ تسجيل ${exportLengthMs / 1000} ثوانٍ بدقة ${rasterViewport.width}×${rasterViewport.height} وبمعدل مستهدف ${rasterViewport.fps} إطارًا/ث… اترك الصفحة في الواجهة.`;
    const paint = (now) => {
      if (activeExport !== running || controller.signal.aborted) return;
      const elapsed = Math.min(exportLengthMs, now - running.session.startedAt);
      const frameIndex = elapsed >= exportLengthMs
        ? totalFrames - 1
        : Math.min(totalFrames - 1, Math.floor(elapsed / nominalIntervalMs));
      presentFrame(frameIndex);
      exportProgress.value = elapsed / exportLengthMs;
      if (elapsed < exportLengthMs) {
        running.rafId = requestAnimationFrame(paint);
      } else {
        exportProgress.value = 1;
        // Give the capture track a short window to mux the exact endpoint frame before stopping.
        running.stopTimer = setTimeout(() => running.session.stop(), 100);
      }
    };
    running.rafId = requestAnimationFrame(paint);
    result = await running.session.promise;
    if (controller.signal.aborted || activeExport !== running) return;
    const safeMime = result.mimeType || candidates[0];
    exportVideoUrl = URL.createObjectURL(result.blob);
    exportVideo.src = exportVideoUrl;
    exportVideo.hidden = fa…17941 tokens truncated…ared.surface;
    for (const layer of project.layers) sceneImageSources.set(layer.assetId, prepared.surface);
    sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
    compiled = compileProject(projectForRaster(project, previewViewport), imageProvider);
    renderAt(currentMs);
    status.textContent = "المعاينة جاهزة";
  } catch (error) {
    if (imageRequest.isCurrent(requestToken)) fail(error);
  } finally {
    if (pendingImageRequest === requestToken) pendingImageRequest = null;
    refreshExportControls();
  }
}

playPauseButton.addEventListener("click", () => {
  if (isPlaying) pauseSequencePlayback(); else void play();
});
$("replayButton").addEventListener("click", () => { void replay(); });
seek.addEventListener("input", () => {
  seekTo(Number(seek.value));
});
$("sequenceSeek").addEventListener("input", () => seekSequenceTo(Number($("sequenceSeek").value)));
$("addSceneButton").addEventListener("click", () => { void addScene(); });
$("duplicateSceneButton").addEventListener("click", () => { void duplicateActiveScene(); });
$("deleteSceneButton").addEventListener("click", () => { void deleteActiveScene(); });
$("moveSceneLeftButton").addEventListener("click", () => {
  const scene = getCurrentScene(); if (scene) void reorderScene(scene.id, scene.index - 1);
});
$("moveSceneRightButton").addEventListener("click", () => {
  const scene = getCurrentScene(); if (scene) void reorderScene(scene.id, scene.index + 1);
});
$("sceneName").addEventListener("change", () => {
  try {
    sequenceEditor.rename(activeSceneId, $("sceneName").value);
    persistSequenceMetadata();
    renderSequenceOverview();
    $("sceneName").removeAttribute("aria-invalid");
  } catch (error) {
    $("sceneName").setAttribute("aria-invalid", "true");
    $("sceneName").value = sequenceEditor.nameOf(activeSceneId);
    $("assetLibraryMessage").textContent = errorText(error);
  }
});
$("sceneDuration").addEventListener("change", () => {
  try {
    const text = $("sceneDuration").value.trim();
    if (!text || $("sceneDuration").validity.badInput) throw new TypeError("أدخل مدة صالحة للمشهد بين 3 و60 ثانية.");
    const seconds = Number(text);
    if (!Number.isSafeInteger(seconds)) throw new TypeError("مدة المشهد يجب أن تكون عددًا صحيحًا بالثواني.");
    captureCurrentScene();
    sequenceEditor.setDuration(activeSceneId, seconds * 1000);
    persistSequenceMetadata();
    project = structuredClone(sequenceEditor.sequence.scenes.find(scene => scene.id === activeSceneId).project);
    $("duration").value = String(seconds);
    updateProject({ resetPlayback: true });
    renderSequenceOverview();
    $("sceneDuration").removeAttribute("aria-invalid");
  } catch (error) {
    $("sceneDuration").setAttribute("aria-invalid", "true");
    $("sceneDuration").value = String(project.durationMs / 1000);
    $("assetLibraryMessage").textContent = errorText(error);
  }
});
timelineEditor = createStudioTimeline({
  lane: timelineLane,
  ruler: timelineRuler,
  playhead: timelinePlayhead,
  markers: timelineKeyframes,
  selectionLabel: timelineSelection,
  message: timelineMessage,
  addButton: addKeyframeButton,
  deleteButton: deleteKeyframeButton,
  fields: keyframeFields,
  getProject: () => project,
  getCompiled: () => compiled,
  getCurrentTime: () => currentMs,
  isBusy: () => Boolean(activeExport),
  formatTime,
  samplePose: (compiledProject, atMs) => sampleFrame(compiledProject, atMs).camera,
  seek: (atMs) => seekTo(atMs),
  syncPlaybackSeek: () => {
    if (currentMs < project.durationMs && !isPlaying) {
      playPauseButton.textContent = pausedAt === null ? "تشغيل" : "متابعة";
    }
  },
  commitProject: commitKeyframeProject
});
const characterFields = Object.fromEntries([...document.querySelectorAll("[data-character-channel]")]
  .map(input => { input.dataset.channel = input.dataset.characterChannel; return [input.dataset.characterChannel, input]; }));
characterTimeline = createCharacterTimeline({
  lane: $("characterTimelineLane"), markers: $("characterTimelineMarkers"),
  playhead: $("characterTimelinePlayhead"), selection: $("characterTimelineSelection"),
  message: $("characterTimelineMessage"), addButton: $("addCharacterKeyframe"),
  deleteButton: $("deleteCharacterKeyframe"), fields: characterFields,
  getTrack: () => characterTrack, getDuration: () => project.durationMs, getTime: () => currentMs,
  getAnimation: () => characterAnimation, isBusy: () => Boolean(activeExport),
  seek: atMs => {
    seekTo(atMs);
  },
  commit: commitCharacterTrack, formatTime
});
audioTimeline = createStudioAudioTimeline({
  root: $("audioTracks"), ruler: $("audioTimelineRuler"), getTracks: () => audioTracks,
  getDuration: () => project.durationMs, getCurrentTime: () => currentMs,
  isBusy: () => Boolean(activeExport), formatTime,
  onSelect: (selection) => { audioClipSelection = selection; const selected = selectedAudioClip(); if (selected) $("audioTrackType").value = selected.track.type; renderAudioInspector(); },
  onMove: (trackId, clipId, startMs) => commitAudioTracks(editAudioClip(audioTracks, project.durationMs, trackId, clipId, { startMs })),
  onVolume: (trackId, volume) => {
    try { audioTracks = setAudioTrackVolume(audioTracks, project.durationMs, trackId, volume); audioPlayer.setTrackVolume(trackId, volume); }
    catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
  },
  onDragEnd: ({ cancelled }) => { if (cancelled) $("audioTimelineMessage").textContent = "أُلغي السحب؛ حُفظ آخر توقيت صالح للمقطع."; }
});
audioTimeline.render();
$("audioMasterVolume").value = String(audioMasterVolume);
renderAudioInspector();
visualEffectsTimeline = createStudioVisualEffectsTimeline({
  root: $("visualEffectsTracks"), ruler: $("visualEffectsRuler"), getTrack: () => visualEffectsTrack,
  getDuration: () => project.durationMs, getCurrentTime: () => currentMs,
  isBusy: () => Boolean(activeExport), formatTime,
  onSelect: (id) => { visualEffectSelection = id; renderVisualEffectInspector(); },
  onMove: (id, atMs) => commitVisualEffectsTrack(moveVisualEffect(visualEffectsTrack, project, id, atMs), "تم نقل المؤثر على المسار.", { refreshTimeline: false, refreshInspector: false }),
  onSeek: (atMs) => seekTo(atMs),
  onDragEnd: ({ cancelled, error }) => {
    if (error) $("visualEffectsMessage").textContent = `تعذر نقل المؤثر: ${errorText(error)}`;
    else if (cancelled) $("visualEffectsMessage").textContent = "أُلغي السحب؛ أُعيد المؤثر إلى توقيته الأصلي.";
  }
});
visualEffectsTimeline.render();
renderVisualEffectInspector();
$("addVisualEffect").addEventListener("click", () => {
  if (activeExport) return;
  try {
    const next = addVisualEffect(visualEffectsTrack, project, $("visualEffectType").value, Math.min(currentMs, project.durationMs));
    const added = next.clips.at(-1);
    visualEffectSelection = added.id;
    commitVisualEffectsTrack(next, `أُضيف ${added.type} عند ${formatTime(added.atMs)}.`);
    visualEffectsTimeline.select(added.id);
  } catch (error) { $("visualEffectsMessage").textContent = errorText(error); }
});
$("deleteVisualEffect").addEventListener("click", () => {
  if (activeExport || !visualEffectSelection) return;
  try {
    visualEffectsTrack = deleteVisualEffect(visualEffectsTrack, project, visualEffectSelection);
    visualEffectSelection = null;
    visualEffectsCompiled = compilePreviewEffects(visualEffectsTrack, project, previewViewport);
    visualEffectsTimeline.clearSelection(); renderVisualEffectInspector(); renderAt(currentMs);
    $("visualEffectsMessage").textContent = "حُذف المؤثر المحدد.";
  } catch (error) { $("visualEffectsMessage").textContent = errorText(error); }
});
for (const [id, field] of [["visualEffectStart", "atMs"], ["visualEffectDuration", "durationMs"], ["visualEffectEasing", "easing"]]) {
  $(id).addEventListener("change", () => {
    if (!selectedVisualEffect() || activeExport) return;
    try { commitVisualEffectPatch({ [field]: field === "easing" ? $(id).value : readEffectNumber($(id)) }); }
    catch (error) { $("visualEffectsMessage").textContent = errorText(error); }
  });
}
for (const source of ["visualEffectFrom", "visualEffectTo"]) {
  $(source).addEventListener("change", event => {
    const input = event.target.closest?.("[data-effect-field]");
    if (!input || !selectedVisualEffect() || activeExport) return;
    try {
      const channel = VISUAL_EFFECT_CHANNELS[selectedVisualEffect().type].find(({ key }) => key === input.dataset.effectField);
      if (!channel) throw new TypeError("قناة المؤثر غير معروفة.");
      commitVisualEffectPatch({ [input.dataset.effectSource]: { [channel.key]: channel.kind === "color" ? input.value : readEffectNumber(input) } }, { refreshTimeline: false, refreshInspector: false });
      input.removeAttribute("aria-invalid");
    } catch (error) { input.setAttribute("aria-invalid", "true"); $("visualEffectsMessage").textContent = errorText(error); }
  });
}
function renderCharacterRuler() {
  const ruler = $("characterTimelineRuler"); ruler.replaceChildren();
  for (let i = 0; i <= 4; i++) { const label = document.createElement("span"); label.textContent = formatTime(Math.round(project.durationMs * i / 4)); ruler.append(label); }
}
const renderCharacterTimeline = characterTimeline.render.bind(characterTimeline);
function refreshCharacterTimeline() { renderCharacterRuler(); renderCharacterTimeline(); }
$("assetLibraryInput").addEventListener("change", async () => {
  const files = Array.from($("assetLibraryInput").files ?? []);
  if (!files.length) return;
  $("assetLibraryMessage").textContent = "جارٍ إضافة الأصول وتخزينها محليًا…";
  try {
    for (const file of files) {
      const asset = await registerAssetFile(file);
      if (asset.kind === "audio" && !audioFiles.has(asset.id)) {
        let durationMs = 0; try { durationMs = await readAudioDuration(file); } catch { /* Keep the asset available for relinking. */ }
        audioFiles.set(asset.id, { file, url: URL.createObjectURL(file), durationMs });
      }
    }
    audioAssets = sequenceEditor.sequence.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
    renderAssetLibrary();
    $("assetLibraryMessage").textContent = `أُضيف ${files.length} أصل إلى المكتبة المشتركة على هذا الجهاز.`;
  } catch (error) { $("assetLibraryMessage").textContent = errorText(error); }
  finally { $("assetLibraryInput").value = ""; renderAssetLibrary(); }
});

$("audioInput").addEventListener("change", () => { void importStudioAudio($("audioInput").files?.[0]); });
microphoneButton = document.createElement("button");
microphoneButton.type = "button";
microphoneButton.className = "secondary-button microphone-record-button";
microphoneButton.textContent = "تسجيل بالميكروفون";
microphoneButton.setAttribute("aria-label", "بدء التسجيل بالميكروفون");
const microphoneHelp = document.createElement("p");
microphoneHelp.className = "hint microphone-record-help";
microphoneHelp.textContent = "التسجيل يحتاج إذن الميكروفون واتصالًا آمنًا مثل HTTPS. اختيار ملف من الهاتف، بما فيه content://، يبقى عبر منتقي Android. الصيغ المدعومة يحددها المتصفح؛ AMR غير متاح قياسيًا في Chromium.";
$("audioInput").after(microphoneButton, microphoneHelp);
const MICROPHONE_MIME_TYPES = Object.freeze([
  { mime: "audio/webm;codecs=opus", base: "audio/webm", extension: "webm" },
  { mime: "audio/mp4", base: "audio/mp4", extension: "m4a" },
  { mime: "audio/webm", base: "audio/webm", extension: "webm" },
  { mime: "audio/ogg;codecs=opus", base: "audio/ogg", extension: "ogg" }
]);
function microphoneRecordingMime(RecorderClass) {
  return MICROPHONE_MIME_TYPES.find(({ mime }) => RecorderClass.isTypeSupported(mime)) ?? null;
}
function addRecordedAudioToTimeline(imported, capture) {
  if (activeSceneId !== capture.sceneId) throw new Error("تغير المشهد أثناء اعتماد التسجيل؛ أُبقي الملف في مكتبة الأصول ولم أضعه في مشهد آخر.");
  const track = audioTracks.find(item => item.id === capture.trackId);
  if (!track) throw new Error("مسار التسجيل المحدد لم يعد متاحًا.");
  const startMs = Math.max(0, Math.min(capture.startMs, project.durationMs - 1));
  const durationMs = Math.max(1, Math.min(Math.round(imported.durationMs), project.durationMs - startMs));
  const clip = { id: `audio-clip-${Date.now()}-${++audioAssetSerial}`, asset: imported.id, name: imported.metadata.name,
    startMs, durationMs, volume: 1,
    ...(track.type === "dialogue" ? { language: $("dialogueLanguage").value, visemes: [] } : {}) };
  const next = addAudioClip(audioTracks, project.durationMs, track.id, clip);
  commitAudioTracks(next, { resume: false });
  const committed = audioTracks.find(item => item.id === track.id)?.clips.find(item => item.id === clip.id);
  if (!committed) throw new Error("لم يُعتمد التسجيل في Timeline.");
  audioClipSelection = { trackId: track.id, clipId: clip.id };
  audioTimeline.select(audioClipSelection);
  renderAudioInspector();
  $("audioTimelineMessage").textContent = `تم التحقق وإضافة التسجيل إلى مسار ${track.type === "music" ? "الموسيقى" : track.type === "sfx" ? "المؤثرات" : "الحوار"} عند ${formatTime(startMs)} لمدة ${formatTime(durationMs)}.`;
}
microphoneButton.addEventListener("click", async () => {
  if (microphoneSession) {
    if (microphoneSession.recorder.state === "recording") {
      microphoneSession.stopRequestedAt = performance.now();
      try { microphoneSession.recorder.stop(); }
      catch (error) { $("audioTimelineMessage").textContent = `تعذر إيقاف التسجيل: ${errorText(error)}`; }
    }
    return;
  }
  if (microphoneStarting || microphoneFinalizing || activeExport || pendingAudioRequest !== null) return;
  const track = audioTracks.find(item => item.type === $("audioTrackType").value);
  if (!track) { $("audioTimelineMessage").textContent = "اختر مسارًا صوتيًا قبل التسجيل."; return; }
  if (currentMs >= project.durationMs) { $("audioTimelineMessage").textContent = "حرّك المؤشر إلى داخل مدة المشهد قبل التسجيل."; return; }
  microphoneStarting = true;
  stopPlayback();
  refreshMicrophoneBusyControls();
  let stream;
  let recorder;
  let timer = 0;
  try {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== "function") {
      throw new Error("الميكروفون يتطلب HTTPS أو WebView يتيح getUserMedia بصلاحية آمنة. افتح رابط HTTPS أو استورد ملفًا صوتيًا.");
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (activeExport || pendingAudioRequest !== null) throw new Error("انتظر انتهاء العملية الحالية قبل التسجيل.");
    const supported = microphoneRecordingMime(MediaRecorder);
    if (!supported) throw new Error("لا يدعم هذا المتصفح تسجيل WebM أو MP4 أو OGG. AMR غير متاح في MediaRecorder القياسي.");
    recorder = new MediaRecorder(stream, { mimeType: supported.mime });
    const capture = { sceneId: activeSceneId, startMs: Math.round(currentMs), trackId: track.id };
    const session = { recorder, stream, chunks: [], bytes: 0, failed: false,
      startedAt: 0, stopRequestedAt: null, timer: 0, capture, mime: supported };
    microphoneSession = session;
    recorder.ondataavailable = event => {
      if (!event.data?.size) return;
      session.bytes += event.data.size;
      if (session.bytes > 20 * 1024 * 1024) {
        session.failed = true;
        if (recorder.state === "recording") {
          session.stopRequestedAt = performance.now();
          try { recorder.stop(); } catch { /* onstop still owns cleanup */ }
        }
        return;
      }
      session.chunks.push(event.data);
    };
    recorder.onerror = event => {
      session.failed = true;
      session.error = event.error;
      if (recorder.state === "recording") {
        session.stopRequestedAt = performance.now();
        try { recorder.stop(); } catch { /* onstop still owns cleanup */ }
      }
    };
    recorder.onstop = async () => {
      clearTimeout(session.timer);
      session.stopRequestedAt ??= performance.now();
      stream.getTracks().forEach(mediaTrack => mediaTrack.stop());
      microphoneSession = null;
      microphoneFinalizing = true;
      refreshMicrophoneBusyControls();
      try {
        if (session.failed || !session.bytes) throw session.error ?? new Error("لم ينتج التسجيل أي بيانات صوتية.");
        const baseMime = (recorder.mimeType || supported.base).split(";")[0].toLowerCase();
        const elapsedMs = Math.round(session.stopRequestedAt - session.startedAt);
        if (!Number.isFinite(elapsedMs) || elapsedMs < 250) throw new Error("التسجيل قصير جدًا؛ سجّل لمدة ربع ثانية على الأقل.");
        const file = new File(session.chunks, `recording-${Date.now()}.${supported.extension}`, { type: baseMime });
        const imported = await importStudioAudio(file);
        if (!imported) throw new Error("تعذر التحقق من التسجيل؛ لم تتم إضافته إلى Timeline.");
        addRecordedAudioToTimeline(imported, session.capture);
      } catch (error) {
        $("audioTimelineMessage").textContent = `تعذر اعتماد التسجيل: ${errorText(error)}`;
      } finally {
        microphoneFinalizing = false;
        refreshMicrophoneBusyControls();
      }
    };
    recorder.start(250);
    session.startedAt = performance.now();
    session.timer = setTimeout(() => {
      if (microphoneSession === session && recorder.state === "recording") {
        session.stopRequestedAt = performance.now();
        try { recorder.stop(); } catch { /* onstop still owns cleanup */ }
      }
    }, 60000);
    $("audioTimelineMessage").textContent = `جارٍ التسجيل بصيغة ${supported.base} (الحد 60 ثانية). أوقفه لإضافته تلقائيًا إلى Timeline.`;
  } catch (error) {
    stream?.getTracks().forEach(mediaTrack => mediaTrack.stop());
    if (microphoneSession?.recorder === recorder) microphoneSession = null;
    let message = errorText(error);
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") message = "لم يُسمح بالميكروفون. اسمح للموقع باستخدامه وافتح Motion Studio عبر HTTPS أو WebView آمن.";
    else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") message = "لم يعثر Android على ميكروفون متاح.";
    else if (error?.name === "NotReadableError" || error?.name === "TrackStartError") message = "الميكروفون مشغول أو رفض Android بدء الالتقاط.";
    $("audioTimelineMessage").textContent = message;
  } finally {
    microphoneStarting = false;
    refreshMicrophoneBusyControls();
  }
});
window.addEventListener("pagehide", () => {
  const session = microphoneSession;
  if (!session) return;
  clearTimeout(session.timer);
  session.recorder.onstop = null;
  try { if (session.recorder.state === "recording") session.recorder.stop(); } catch { /* Closing the page releases the encoder. */ }
  session.stream.getTracks().forEach(track => track.stop());
  microphoneSession = null;
});
async function importStudioAudio(file) {
  if (!file) return null;
  const requestToken = audioRequest.begin();
  pendingAudioRequest = requestToken;
  let imported = null;
  // Do not let an Add tap during metadata/storage work attach the previous file.
  activeAudioAssetId = null;
  $("audioFileName").textContent = file.name || "جارٍ تجهيز الملف الصوتي…";
  $("audioTimelineMessage").textContent = "جارٍ تجهيز الملف الصوتي؛ سيُفعّل زر الإضافة بعد اكتمال التحقق.";
  renderAudioInspector(); refreshMicrophoneBusyControls();
  try {
    const metadata = validateAudioFile(file);
    $("audioTimelineMessage").textContent = "جارٍ التحقق من فك ترميز الصوت وقراءة مدته…";
    const durationMs = await readAudioDuration(file);
    if (!audioRequest.isCurrent(requestToken)) return;
    const shared = await registerAssetFile(file);
    if (!audioRequest.isCurrent(requestToken)) return;
    const id = shared.id;
    const normalizedFile = file.type === metadata.mime ? file : new File([file], file.name, { type: metadata.mime });
    const url = URL.createObjectURL(normalizedFile);
    const previous = audioFiles.get(id);
    if (previous?.url) URL.revokeObjectURL(previous.url);
    audioFiles.set(id, { file: normalizedFile, url, durationMs });
    rememberAudioDuration(id, durationMs);
    audioAssets = sequenceEditor.sequence.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
    activeAudioAssetId = id;
    rebuildAudioPlayer({ resume: isPlaying });
    $("audioFileName").textContent = `${metadata.name} · ${(metadata.size / 1024 / 1024).toFixed(2)} MiB · ${(durationMs / 1000).toFixed(2)} ث`;
    $("audioTimelineMessage").textContent = `تم التحقق من الملف. مدته ${(durationMs / 1000).toFixed(2)} ثانية؛ أضفه إلى مسار عند المؤشر.`;
    renderAudioInspector();
    imported = { id, durationMs, metadata };
  } catch (error) {
    if (audioRequest.isCurrent(requestToken)) {
      activeAudioAssetId = null;
      const reason = /\.amr$/i.test(file.name) || /^audio\/amr(?:-wb)?$/i.test(file.type)
        ? "تسجيل AMR غير مدعوم في Chromium. اختر M4A أو WAV أو WebM أو MP3."
        : errorText(error);
      $("audioFileName").textContent = `لم يُعتمد الملف: ${reason}`;
      $("audioTimelineMessage").textContent = reason;
    }
  }
  finally {
    const isCurrentRequest = audioRequest.isCurrent(requestToken);
    if (pendingAudioRequest === requestToken) pendingAudioRequest = null;
    if (isCurrentRequest) {
      $("audioInput").value = "";
      // The inspector was rendered while pendingAudioRequest was still set.
      // Re-render only after clearing it so Add is enabled for the imported asset.
      renderAudioInspector();
      refreshMicrophoneBusyControls();
    }
  }
  return imported;
}
$("addAudioClip").addEventListener("click", () => {
  if (activeExport || microphoneOperationActive()) return;
  if (pendingAudioRequest !== null) {
    $("audioTimelineMessage").textContent = "انتظر اكتمال تجهيز الملف الصوتي قبل إضافته.";
    return;
  }
  if (!activeAudioAssetId) {
    $("audioTimelineMessage").textContent = "اختر ملفًا صوتيًا من الهاتف أو مكتبة الأصول أولًا.";
    return;
  }
  try {
    const trackType = $("audioTrackType").value;
    const track = audioTracks.find((item) => item.type === trackType);
    if (!track) throw new Error("المسار الصوتي المحدد غير موجود.");
    const startMs = Math.max(0, Math.min(Math.round(currentMs), project.durationMs - 1));
    const assetId = activeAudioAssetId;
    const metadata = audioAssets.find(({ id }) => id === assetId);
    const source = audioFiles.get(assetId);
    if (!source?.url || !Number.isFinite(source.durationMs) || source.durationMs <= 0) {
      throw new Error("ملف الصوت غير جاهز للتشغيل. أعد استيراده أو ربطه من المكتبة.");
    }
    if (!metadata || !sequenceEditor.sequence.assets.some(asset => asset.id === assetId && asset.kind === "audio")) {
      throw new Error("تعذر مطابقة ملف الصوت المحدد مع أصل المشروع. أعد استيراده من الهاتف.");
    }
    const durationMs = Math.max(1, Math.min(Math.round(source.durationMs), project.durationMs - startMs));
    const clip = { id: `audio-clip-${Date.now()}-${++audioAssetSerial}`, asset: assetId, name: metadata.name, startMs, durationMs, volume: 1,
      ...(trackType === "dialogue" ? { language: $("dialogueLanguage").value, visemes: [] } : {}) };
    const next = addAudioClip(audioTracks, project.durationMs, track.id, clip);
    commitAudioTracks(next);
    const committed = audioTracks.find(item => item.id === track.id)?.clips.find(item => item.id === clip.id);
    if (!committed) throw new Error("لم يُعتمد المقطع في المسار الصوتي؛ أعد المحاولة.");
    audioClipSelection = { trackId: track.id, clipId: clip.id };
    audioTimeline.select(audioClipSelection);
    renderAudioInspector();
    $("audioTimelineMessage").textContent = `أُضيف ${metadata.name} إلى المسار عند ${formatTime(startMs)} لمدة ${formatTime(durationMs)}.`;
  } catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
$("deleteAudioClip").addEventListener("click", () => {
  if (activeExport || microphoneOperationActive() || !audioClipSelection) return;
  try {
    audioTracks = deleteAudioClip(audioTracks, project.durationMs, audioClipSelection.trackId, audioClipSelection.clipId);
    audioClipSelection = null; rebuildAudioPlayer({ resume: true }); audioTimeline.clearSelection(); renderAudioInspector(); renderAt(currentMs);
  } catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
for (const [id, field] of [["audioClipStart", "startMs"], ["audioClipDuration", "durationMs"], ["audioClipVolume", "volume"]]) {
  $(id).addEventListener("change", () => {
    const selected = selectedAudioClip(); if (!selected || activeExport || microphoneOperationActive()) return;
    try {
      const value = Number($(id).value);
      const next = editAudioClip(audioTracks, project.durationMs, selected.track.id, selected.clip.id, { [field]: value });
      commitAudioTracks(next); audioTimeline.select(audioClipSelection);
      $("audioTimelineMessage").textContent = "تم تحديث المقطع الصوتي.";
    } catch (error) { $("audioTimelineMessage").textContent = errorText(error); renderAudioInspector(); }
  });
}
$("dialogueLanguage").addEventListener("change", () => {
  const selected = selectedAudioClip(); if (!selected || selected.track.type !== "dialogue" || activeExport || microphoneOperationActive()) return;
  try { commitAudioTracks(editAudioClip(audioTracks, project.durationMs, selected.track.id, selected.clip.id, { language: $("dialogueLanguage").value })); }
  catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
$("addViseme").addEventListener("click", () => {
  const selected = selectedAudioClip(); if (!selected || selected.track.type !== "dialogue" || activeExport) return;
  try {
    const atMs = currentMs - selected.clip.startMs;
    const next = setAudioViseme(audioTracks, project.durationMs, selected.track.id, selected.clip.id, atMs, $("visemeType").value, $("phonemeLabel").value);
    commitAudioTracks(next); audioTimeline.select(audioClipSelection);
    $("audioTimelineMessage").textContent = `أُضيف مفتاح ${$("visemeType").selectedOptions[0].textContent} عند ${formatTime(currentMs)}.`;
  } catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
$("audioMasterVolume").addEventListener("input", () => {
  audioMasterVolume = Number($("audioMasterVolume").value);
  try { audioPlayer.setMasterVolume(audioMasterVolume); }
  catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
for (const id of ["duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY"]) {
  $(id).addEventListener("input", () => updateProject({ resetPlayback: id === "duration", editedControl: id }));
}

aspectSelect.addEventListener("change", () => {
  aspectPreset = aspectSelect.value;
  sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
  persistSequenceMetadata();
  updateProject({ viewport: dimensionsForCurrentPreset() });
  refreshSelectedImage();
});
fitSelect.addEventListener("change", () => {
  invalidateExport("تغيّرت طريقة عرض الصورة.");
  fitMode = fitSelect.value;
  sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
  persistSequenceMetadata();
  refreshSelectedImage();
});

imageInput.addEventListener("change", async () => {
  invalidateExport("اختيرت صورة جديدة.");
  const requestToken = imageRequest.begin();
  pendingImageRequest = requestToken;
  clearFailure();
  const file = imageInput.files?.[0];
  if (!file) return;
  selectedImageFile = file;
  selectedImageDimensions = null;
  currentFileInfo = null;
  imageSource = placeholder;
  refreshExportControls();
  renderAt(currentMs);
  status.textContent = "جارٍ تحميل الصورة…";
  try {
    const asset = await registerAssetFile(file);
    if (!imageRequest.isCurrent(requestToken)) return;
    const prepared = await loadImageSurface(file, requestToken);
    if (!prepared || !imageRequest.isCurrent(requestToken)) return;
    imageSource = prepared.surface;
    sceneImageSources.set(asset.id, imageSource);
    project = { ...project, layers: project.layers.map((layer, index) => index === 0 ? { ...layer, assetId: asset.id } : layer) };
    currentFileInfo = { name: asset.name, type: asset.mimeType, size: asset.size };
    compiled = compileProject(projectForRaster(project, previewViewport), imageProvider);
    sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
    captureCurrentScene({ refresh: true });
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    imageName.textContent = `${currentFileInfo.name} · ${prepared.dimensions.width}×${prepared.dimensions.height}`;
    renderAt(currentMs);
    makeThumbnail();
    renderSequenceOverview({ rebuildAssets: false });
    status.textContent = "المعاينة جاهزة";
    refreshExportControls();
  } catch (error) {
    if (imageRequest.isCurrent(requestToken)) fail(error);
  }
  finally {
    if (pendingImageRequest === requestToken) pendingImageRequest = null;
    imageInput.value = "";
    refreshExportControls();
  }
});

$("saveProjectButton").addEventListener("click", async () => {
  clearFailure();
  try {
    captureCurrentScene();
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    const data = sequenceEditor.scenes.length > 1
      ? serializeStudioSequenceFile(sequenceEditor, { projectId: projectStorageId, aspectPreset, fitMode, audioMasterVolume })
      : JSON.stringify(makeProjectFile(project, currentFileInfo, { aspectPreset, fitMode }, characterTrack, audioTracks, audioAssets, audioMasterVolume, visualEffectsTrack), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = sequenceEditor.scenes.length > 1 ? "qarton-motion-sequence.json" : "qarton-motion-project.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "تم تجهيز ملف المشروع JSON؛ الأصول محفوظة محليًا بشكل منفصل";
  } catch (error) { fail(error); }
});
$("loadProjectButton").addEventListener("click", () => projectInput.click());
projectInput.addEventListener("change", async () => {
  invalidateExport("فُتح ملف مشروع جديد.");
  imageRequest.begin();
  audioRequest.begin(); pendingAudioRequest = null;
  clearFailure();
  const file = projectInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new RangeError("ملف المشروع أكبر من الحد المسموح (2 MiB).");
    const fileText = await file.text();
    let header;
    try { header = JSON.parse(fileText); } catch { throw new TypeError("ملف JSON غير صالح."); }
    if (header.format === STUDIO_SEQUENCE_FILE_FORMAT) {
      const loaded = parseStudioSequenceFile(fileText);
      stopPlayback();
      for (const { url } of audioFiles.values()) if (url) URL.revokeObjectURL(url);
      audioFiles.clear(); localAssetFiles.clear(); sceneThumbnails.clear(); sceneSettings.clear(); sceneExtraCharacterTracks.clear();
      aspectPreset = loaded.settings.aspectPreset; fitMode = loaded.settings.fitMode; audioMasterVolume = loaded.audioMasterVolume;
      aspectSelect.value = aspectPreset; fitSelect.value = fitMode; $("audioMasterVolume").value = String(audioMasterVolume);
      await attachSequenceProject(loaded.editor, loaded.projectId, loaded.sceneSettings);
      await activateStudioScene(sequenceEditor.scenes[0].id, { globalTimeMs: 0, localTimeMs: 0 });
      stopPlayback(); sequenceTimeMs = 0;
      status.textContent = "فُتح تسلسل المشاهد؛ أعد ربط الأصول غير المتاحة على هذا الجهاز";
      refreshExportControls();
      return;
    }
    if (file.size > 128 * 1024) throw new RangeError("ملف المشروع القديم أكبر من الحد المسموح (128 كيلوبايت).");
    const parsed = parseProjectFile(fileText);
    const importedImageProvider = { get: (assetId) => parsed.project.layers.some((layer) => layer.assetId === assetId) ? placeholder : null };
    compileProject(parsed.project, importedImageProvider);
    const parsedCharacterAnimation = compileCharacterTrack(parsed.characterTrack, parsed.project.durationMs);
    aspectPreset = parsed.settings?.aspectPreset ?? inferAspectPreset(parsed.project.viewport.width, parsed.project.viewport.height);
    fitMode = parsed.settings?.fitMode ?? "fit";
    aspectSelect.value = aspectPreset;
    fitSelect.value = fitMode;
    timelineEditor.clearSelection();
    stopPlayback();
    if (audioPlayer) { try { audioPlayer.destroy(); } catch (error) { $("audioTimelineMessage").textContent = `تعذر تنظيف الصوت القديم: ${errorText(error)}`; } }
    for (const { url } of audioFiles.values()) if (url) URL.revokeObjectURL(url);
    audioFiles.clear(); activeAudioAssetId = null;
    // Legacy imports also start a new project; never reuse another project's cached assets.
    localAssetFiles.clear(); sceneThumbnails.clear(); sceneExtraCharacterTracks.clear();
    audioTracks = parsed.audioTracks; audioAssets = parsed.audioAssets; audioMasterVolume = parsed.audioMasterVolume;
    visualEffectsTrack = parsed.visualEffectsTrack; visualEffectSelection = null;
    audioClipSelection = null;
    $("audioMasterVolume").value = String(audioMasterVolume);
    $("audioFileName").textContent = audioAssets.length ? "أعد اختيار ملفات الصوت المرتبطة بالمشروع من الهاتف" : "MP3 · M4A · AAC · WAV · OGG · WebM · حتى 20 MiB";
    audioTimeline.clearSelection(); renderAudioInspector();
    visualEffectsTimeline.clearSelection(); renderVisualEffectInspector();
    project = parsed.project;
    characterTrack = parsed.characterTrack;
    characterAnimation = parsedCharacterAnimation;
    selectedImageFile = null;
    selectedImageDimensions = null;
    currentFileInfo = null;
    imageSource = placeholder;
    sceneImageSources.clear();
    const legacyAssetMap = new Map(parsed.project.layers.map((layer, index) => [layer.assetId, {
      id: layer.assetId, kind: "image", name: parsed.image?.name ?? `legacy-image-${index + 1}.png`,
      mimeType: parsed.image?.type || "image/png", size: parsed.image?.size ?? 0
    }]));
    for (const asset of parsed.audioAssets) legacyAssetMap.set(asset.id, { id: asset.id, kind: "audio", name: asset.name,
      mimeType: asset.type, size: asset.size });
    for (const id of parsedCharacterAnimation.frameAssets ?? []) if (!legacyAssetMap.has(id)) legacyAssetMap.set(id, {
      id, kind: "image", name: `${id}.png`, mimeType: "image/png", size: 0
    });
    const legacySequence = createStudioSequenceV1({ viewport: parsed.project.viewport, assets: [...legacyAssetMap.values()], scenes: [{
      id: "legacy-scene", project: parsed.project, audioTracks: parsed.audioTracks,
      characterTracks: [parsed.characterTrack], visualEffectsTrack: parsed.visualEffectsTrack
    }] });
    await attachSequenceProject(createStudioSequenceEditor(legacySequence, { names: { "legacy-scene": "المشهد 1" } }), makeLocalId("project"), {
      "legacy-scene": { aspectPreset, fitMode }
    });
    const start = project.camera?.[0]?.value;
    const end = project.camera?.at(-1)?.value;
    $("duration").value = String(project.durationMs / 1000);
    if (start && end) {
      for (const [id, value] of [["startZoom", start.zoom], ["endZoom", end.zoom], ["startX", start.x], ["endX", end.x], ["startY", start.y], ["endY", end.y]]) $(id).value = String(value);
    }
    updateProject({ viewport: project.viewport });
    imageName.textContent = parsed.image?.name ? `أعد اختيار الصورة: ${parsed.image.name}` : "اختر الصورة من جديد لعرض المعاينة";
    stopPlayback();
    renderAt(0);
    syncOutputs();
    status.textContent = "فُتح المشروع؛ اختر الصورة المرتبطة به";
    sequenceTimeMs = 0; renderSequenceOverview(); persistSequenceMetadata();
    refreshExportControls();
  } catch (error) { fail(error); }
  finally { projectInput.value = ""; }
});

setEditorMode("simple");
setEditorSection("motion");
syncMotionTimeBounds();
refreshMotionUndoButtons();
updateProject({ viewport: project.viewport });
timelineEditor.render();
refreshCharacterTimeline();
renderAt(0);
refreshExportControls();
renderSequenceOverview();
syncIntegratedRange();
void restoreMostRecentSequence();
exportButton.addEventListener("click", () => { void exportVideoFile(); });
cancelExportButton.addEventListener("click", () => cancelActiveExport("ألغى المستخدم التسجيل."));
tryWebmButton.addEventListener("click", () => {
  exportFormat.value = "webm";
  exportFormat.dispatchEvent(new Event("change", { bubbles: true }));
});
integratedProbeButton.addEventListener("click", () => { void probeIntegratedExport(); });
integratedExportButton.addEventListener("click", () => { void exportIntegratedProject(); });
for (const control of [integratedQuality, integratedFormat, integratedAudio, integratedMissingAudio, integratedFrom, integratedTo]) {
  control.addEventListener("change", () => {
    clearIntegratedResult();
    integratedError.hidden = true;
    integratedError.textContent = "";
    integratedStatus.textContent = "تغيرت إعدادات التصدير. أعد فحص الصيغة والدقة قبل البدء.";
    refreshIntegratedControls();
  });
}
for (const control of [exportFormat, exportDuration, exportQuality, exportAudioEnabled]) {
  control.addEventListener("change", () => {
    clearExportResult();
    refreshExportControls();
  });
}
window.addEventListener("pagehide", () => {
  if (sequenceAutosaveTimer) clearTimeout(sequenceAutosaveTimer);
  try { captureCurrentScene(); } catch { /* The current JSON remains available from the last valid edit. */ }
  cancelActiveExport("غادرت الصفحة أثناء التصدير.");
  audioRequest.begin();
  try { audioPlayer?.destroy(); } catch { /* Browser is unloading; all local playback handles are being discarded. */ }
  for (const { url } of audioFiles.values()) if (url) URL.revokeObjectURL(url);
  audioFiles.clear();
  if (exportVideoUrl) URL.revokeObjectURL(exportVideoUrl);
  exportVideoUrl = null;
  if (integratedVideoUrl) URL.revokeObjectURL(integratedVideoUrl);
  integratedVideoUrl = null;
});
