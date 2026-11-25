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
  exportButton.disabled = !available || !currentFileInfo || Boolean(activeExport) || pendingImageRequest !== null || pendingAudioRequest !== null;
  exportFormat.disabled = Boolean(activeExport);
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
  const blocked = Boolean(activeExport || pendingImageRequest !== null || pendingAudioRequest !== null || !currentFileInfo);
  integratedProbeButton.disabled = blocked;
  integratedExportButton.disabled = blocked || !hasVerified;
  integratedExportButton.textContent = blocked ? "التصدير غير متاح حاليًا" : hasVerified ? "تصدير المشروع مع الصوت" : "افحص الصيغة والدقة أولًا";
  integratedExportButton.title = blocked ? "انتظر اكتمال تحميل الأصول أو انتهاء التصدير" : hasVerified ? "ابدأ تصدير المشروع" : "اضغط زر فحص الصيغة والدقة";
  for (const control of [integratedQuality, integratedFormat, integratedAudio, integratedMissingAudio, integratedFrom, integratedTo]) control.disabled = Boolean(activeExport);
}
function setExportBusy(busy) {
  for (const id of ["imageInput", "projectInput", "audioInput", "audioTrackType", "addAudioClip", "deleteAudioClip", "audioClipStart", "audioClipDuration", "audioClipVolume", "dialogueLanguage", "visemeType", "phonemeLabel", "addViseme", "audioMasterVolume", "visualEffectType", "addVisualEffect", "deleteVisualEffect", "visualEffectStart", "visualEffectDuration", "visualEffectEasing", "aspectPreset", "fitMode", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "saveProjectButton", "loadProjectButton", "motionSpeed", "motionStrength", "motionFocusX", "motionFocusY", "motionFromSeconds", "motionToSeconds", "integratedQuality", "integratedFormat", "integratedAudio", "integratedMissingAudio", "integratedFrom", "integratedTo"]) {
    $(id).disabled = busy;
  }
  for (const button of document.querySelectorAll("[data-motion-preset]")) button.disabled = busy;
  timelineEditor?.setBusy(busy);
  characterTimeline?.setBusy(busy);
  audioTimeline?.setBusy(busy);
  visualEffectsTimeline?.setBusy(busy);
  renderVisualEffectInspector();
  renderAudioInspector();
  exportButton.disabled = busy || !currentFileInfo || !exportCapability.mp4.length && !exportCapability.webm.length;
  exportFormat.disabled = busy;
  exportDuration.disabled = busy;
  exportQuality.disabled = busy;
  exportAudioEnabled.disabled = busy;
  cancelExportButton.hidden = !busy;
  cancelExportButton.disabled = !busy;
  integratedProbeButton.disabled = busy || !currentFileInfo || pendingImageRequest !== null || pendingAudioRequest !== null;
  integratedExportButton.disabled = busy || !currentFileInfo || getVerifiedIntegratedCapabilities().length === 0;
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
    exportVideo.hidden = false;
    exportDownload.href = exportVideoUrl;
    exportDownload.download = `qarton-motion-${Date.now()}.${extensionForMime(safeMime)}`;
    exportDownload.textContent = `حفظ ${extensionForMime(safeMime).toUpperCase()} على الهاتف`;
    exportDownload.hidden = false;
    exportProgress.value = 1;
    exportMetadata.textContent = `الصيغة الفعلية: ${safeMime} · ${rasterViewport.width}×${rasterViewport.height} · ${(result.blob.size / 1024 / 1024).toFixed(2)} MiB · ${(result.durationMs / 1000).toFixed(2)} ث`;
    exportStatusHasResult = true;
    tryWebmButton.hidden = true;
    exportStatus.textContent = "اكتمل التسجيل. شغّل المعاينة ثم احفظ الملف إذا كانت النتيجة مناسبة.";
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      exportStatusHasResult = true;
      exportStatus.textContent = "أُلغي التسجيل ونُظّفت موارده.";
    } else {
      const canTryWebm = exportFormat.value === "mp4" && exportCapability.webm.length > 0;
      setExportErrorMessage(exportError, error,
        canTryWebm ? "جرّب WebM من الزر أدناه إذا رفض الجهاز MP4." : "");
      exportError.hidden = false;
      tryWebmButton.hidden = !canTryWebm;
      exportStatusHasResult = true;
      exportStatus.textContent = "فشل التصدير؛ تحقق من الصيغة والمدة والذاكرة المتاحة.";
    }
  } finally {
    if (running.rafId) cancelAnimationFrame(running.rafId);
    if (running.stopTimer) clearTimeout(running.stopTimer);
    if (running.session && !result && running.session.recorder.state !== "inactive") running.session.cancel("انتهى التصدير قبل اكتمال التسجيل.");
    stream?.getTracks().forEach((track) => track.stop());
    if (audioGraph) await audioGraph.audio.close().catch(() => {});
    exportCanvas = null;
    if (activeExport === running) activeExport = null;
    unlock();
    setExportBusy(false);
    refreshExportControls();
  }
}
function readRequiredMilliseconds(input, label) {
  const text = input.value.trim();
  if (!text || input.validity?.badInput) throw new TypeError(`${label}: أدخل وقتًا صحيحًا بالميلي ثانية.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label}: أدخل وقتًا صحيحًا بالميلي ثانية.`);
  return value;
}
function syncIntegratedRange() {
  const durationMs = sequenceEditor?.durationMs ?? project.durationMs;
  integratedFrom.max = String(Math.max(0, durationMs - 1));
  integratedTo.max = String(durationMs);
  integratedFrom.value = String(Math.max(0, Math.min(durationMs - 1, Number(integratedFrom.value) || 0)));
  integratedTo.value = String(durationMs);
}
async function prepareSequenceExportImages(sequence, viewport, signal) {
  const surfaces = new Map();
  const sceneRenderers = [];
  const bytesPerSurface = viewport.width * viewport.height * 4;
  const maxSequenceImageBytes = 64 * 1024 * 1024;
  const surfaceCount = new Set(sequence.scenes.flatMap(scene => scene.project.layers.map(layer => `${scene.id}:${layer.assetId}`))).size;
  const plannedSurfaceBytes = surfaceCount * bytesPerSurface;
  if (!Number.isSafeInteger(plannedSurfaceBytes) || plannedSurfaceBytes > maxSequenceImageBytes) {
    throw new RangeError("تجاوزت صور المشاهد حد ذاكرة التصدير الآمن 64 MiB؛ قلل الجودة أو عدد المشاهد.");
  }
  try {
    for (const scene of sequence.scenes) {
      const fit = sceneSettings.get(scene.id)?.fitMode ?? "fit";
      const required = new Set(scene.project.layers.map(layer => layer.assetId));
      const sceneSources = new Map();
      for (const assetId of required) {
        const asset = sequence.assets.find(item => item.id === assetId && item.kind === "image");
        const blob = getAssetBlob(assetId);
        if (!asset || !blob) throw new Error(`الأصل الصوري للمشهد ${scene.id} غير متاح: ${assetId}`);
        const key = `${scene.id}:${assetId}`;
        if (!surfaces.has(key)) {
          const file = new File([blob], asset.name, { type: asset.mimeType });
          const bitmap = await decodeImageBitmap(file, { isCurrent: () => !signal?.aborted });
          try {
            if (signal?.aborted) throw signal.reason ?? new DOMException("Export cancelled", "AbortError");
            const surface = typeof OffscreenCanvas === "function"
              ? new OffscreenCanvas(viewport.width, viewport.height)
              : Object.assign(document.createElement("canvas"), { width: viewport.width, height: viewport.height });
            const context = surface.getContext("2d", { alpha: false });
            if (!context) throw new Error("لم تتوفر ذاكرة كافية لتحضير صور المشاهد.");
            context.fillStyle = "#101118"; context.fillRect(0, 0, viewport.width, viewport.height);
            const rect = imageRect(bitmap.width, bitmap.height, viewport.width, viewport.height, fit);
            context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
            surfaces.set(key, surface);
          } finally { bitmap.close?.(); }
        }
        sceneSources.set(assetId, surfaces.get(key));
      }
      const sceneProject = projectForRaster(scene.project, viewport);
      const compiledProject = compileProject(sceneProject, { get: id => sceneSources.get(id) ?? null });
      const characters = scene.characterTracks.map(track => ({ track,
        animation: compileCharacterTrack(track, scene.project.durationMs) }));
      const effects = compilePreviewEffects(scene.visualEffectsTrack, scene.project, viewport);
      sceneRenderers.push(Object.freeze({ sceneId: scene.id, compiledProject, characters, effects }));
    }
    // Raster surfaces now own the pixels; decoded source bitmaps are no longer needed.
    return { sceneRenderers, release() {
      surfaces.clear();
      sceneRenderers.length = 0;
    } };
  } catch (error) {
    surfaces.clear();
    sceneRenderers.length = 0;
    throw error;
  }
}
async function prepareSequenceAudioInfo(sequence, signal) {
  await assetReady;
  const referencedIds = new Set(sequence.scenes.flatMap(scene => scene.audioTracks.flatMap(track => track.clips.map(clip => clip.asset))));
  const info = [];
  for (const id of referencedIds) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("تم إلغاء التصدير.", "AbortError");
    const asset = sequence.assets.find(item => item.id === id && item.kind === "audio");
    const blob = getAssetBlob(id);
    if (!asset || !blob) throw new Error(`ملف الصوت المرتبط بالمشاهد غير متاح: ${id}`);
    let source = audioFiles.get(id);
    if (!source) {
      const file = new File([blob], asset.name, { type: asset.mimeType });
      const url = URL.createObjectURL(file);
      let durationMs;
      try { durationMs = await readAudioDuration(file); }
      catch (cause) { URL.revokeObjectURL(url); throw new Error(`تعذر قراءة مدة ملف الصوت ${asset.name}: ${errorText(cause)}`); }
      source = { file, url, durationMs };
      audioFiles.set(id, source);
    }
    if (!source.durationMs) throw new Error(`مدة ملف الصوت غير معروفة: ${asset.name}`);
    info.push({ id, durationMs: Math.max(1, Math.round(source.durationMs)), channels: 2, sampleRate: 48_000 });
  }
  return info;
}
function getVerifiedIntegratedCapabilities() {
  const capabilities = integratedCapabilities.get(integratedCapabilityKey()) ?? [];
  return capabilities.filter(({ verification, mimeType }) => verification === "verified" &&
    (integratedFormat.value === "auto" || mimeType.startsWith(`video/${integratedFormat.value}`)));
}
function setIntegratedProgress(progress) {
  if (!Number.isFinite(progress.targetMs) || progress.targetMs <= 0) return;
  integratedProgress.value = Math.max(0, Math.min(1, progress.elapsedMs / progress.targetMs));
  const labels = { "preparing-audio": "جارٍ فك الملفات الصوتية…", recording: "جارٍ تسجيل الصورة والصوت…",
    finalizing: "جارٍ إنهاء ملف التسجيل…", validating: "جارٍ فحص الملف الناتج…" };
  integratedStatus.textContent = `${labels[progress.phase] ?? progress.phase} ${Math.round(integratedProgress.value * 100)}%`;
}
async function probeIntegratedExport() {
  if (activeExport || !currentFileInfo) return;
  const raster = integratedRaster();
  const audioMode = integratedAudio.value;
  const capabilityKey = integratedCapabilityKey();
  const formats = integratedFormat.value === "auto" ? ["mp4", "webm"] : [integratedFormat.value];
  integratedProbeButton.disabled = true;
  integratedExportButton.disabled = true;
  for (const control of [integratedQuality, integratedFormat, integratedAudio, integratedMissingAudio, integratedFrom, integratedTo]) control.disabled = true;
  integratedStatus.textContent = `جارٍ فحص ${raster.width}×${raster.height} عند ${project.viewport.fps} إطارًا/ث…`;
  integratedError.hidden = true;
  try {
    const capabilities = await probeExport({ width: raster.width, height: raster.height,
      fps: project.viewport.fps, audioMode, formats, durationMs: 800 });
    integratedCapabilities.set(capabilityKey, capabilities);
    if (capabilityKey !== integratedCapabilityKey()) {
      integratedStatus.textContent = "تغيّرت إعدادات التصدير أثناء الفحص؛ أعد فحص الإعدادات الحالية.";
      return;
    }
    const verified = capabilities.filter(({ verification }) => verification === "verified");
    integratedStatus.textContent = verified.length
      ? `تم التحقق فعليًا من ${verified.map(({ mimeType }) => mimeType).join(" و")} على هذه الدقة. الفحص يثبت التشغيل وفك الوسائط للمقطع القصير فقط.${verified.some(({ durationMetadata }) => durationMetadata === "unavailable") ? " مدة الحاوية والبحث قرب النهاية غير متاحين لهذا المتصفح." : ""}`
      : "لم ينجح تسجيل وفك الملف التجريبي على هذه الدقة والصيغة؛ جرّب دقة أقل أو فيديو فقط.";
    if (!verified.length) {
      integratedError.textContent = capabilities.map(({ mimeType, reason }) => `${mimeType}: ${reason}`).join(" · ") || "لا توجد صيغة معلنة لهذا الجهاز.";
      integratedError.hidden = false;
    }
  } catch (error) {
    integratedError.textContent = errorText(error);
    integratedError.hidden = false;
    integratedStatus.textContent = "تعذر فحص إمكانيات التصدير.";
  } finally { refreshIntegratedControls(); }
}
async function exportIntegratedProject() {
  if (activeExport || exportPreparing) return;
  exportPreparing = true;
  setExportBusy(true);
  try {
    const sceneActivation = pendingSceneActivation;
    if (sceneActivation) await sceneActivation;
  } catch (error) {
    exportPreparing = false;
    setExportBusy(false);
    refreshExportControls();
    setExportErrorMessage(integratedError, error);
    integratedError.hidden = false;
    integratedStatus.textContent = "تعذر تثبيت المشهد الحالي قبل التصدير.";
    return;
  }
  if (activeExport) {
    exportPreparing = false;
    setExportBusy(false);
    refreshExportControls();
    return;
  }
  exportPreparing = false;
  const controller = new AbortController();
  const running = { kind: "integrated", controller, session: null, rafId: 0, stopTimer: 0 };
  activeExport = running;
  let result = null;
  let sequenceImages = null;
  let sequenceRuntime = null;
  try {
    const verified = getVerifiedIntegratedCapabilities();
    if (!verified.length) throw new Error("افحص دعم الصيغة والدقة المحددتين أولًا.");
    clearIntegratedResult();
    stopPlayback();
    captureCurrentScene();
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    const prepared = prepareStudioSequenceExport(sequenceEditor.sequence, {
      audioAssetInfo: integratedAudio.value === "mix"
        ? await prepareSequenceAudioInfo(sequenceEditor.sequence, controller.signal) : [], audioMasterVolume
    });
    const snapshot = prepared.snapshot;
    // Older V1 projects migrate to V2 with zero-duration Cut transitions.
    // Transition editing remains a later UI stage; playback/export share this runtime.
    sequenceRuntime = createStudioSequenceRuntime(sequenceEditor.sequence, {
      createSurface: (width, height) => Object.assign(document.createElement("canvas"), { width, height })
    });
    const range = { startMs: readRequiredMilliseconds(integratedFrom, "البداية"),
      endMs: readRequiredMilliseconds(integratedTo, "النهاية") };
    if (range.endMs <= range.startMs || range.endMs > sequenceRuntime.durationMs) throw new RangeError("نطاق التصدير يجب أن يقع داخل مدة المشروع الكاملة.");
    const plan = planExport(snapshot, { range, quality: integratedQuality.value, fps: project.viewport.fps,
      format: integratedFormat.value, audio: integratedAudio.value, missingAudio: integratedMissingAudio.value }, verified);
    sequenceImages = await prepareSequenceExportImages(prepared.compiledSequence.sequence, plan.viewport, controller.signal);
    const sceneAudio = new Map(sequenceRuntime.compiled.scenes.map(scene => [scene.id,
      compileAudioTracks(scene.audioTracks, scene.project.durationMs)]));
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const host = {
      document, window, MediaRecorderClass: typeof MediaRecorder === "function" ? MediaRecorder : null,
      MediaStreamClass: window.MediaStream ?? globalThis.MediaStream,
      createCanvas: (width, height) => Object.assign(document.createElement("canvas"), { width, height }),
      createAudioContext: () => {
        if (!AudioContextClass) throw new Error("Web Audio غير متاح على هذا الجهاز.");
        return new AudioContextClass();
      },
      resolveAudio: async assetId => audioFiles.get(assetId)?.file ?? null,
      createAudioMix: async ({ audioContext, signal, onProgress }) => {
        const destination = audioContext.createMediaStreamDestination();
        // Keep the recorder's audio track fed even during empty or delayed clips.
        // A zero-valued constant source produces silence, not an audible tone.
        let silence;
        let decoded;
        let engine;
        try {
          silence = audioContext.createConstantSource();
          silence.offset.value = 0;
          silence.connect(destination);
          silence.start();
          decoded = await decodeStudioSequenceAudio(sequenceRuntime.compiled, { audioContext,
            resolveAudio: async assetId => audioFiles.get(assetId)?.file ?? null,
            audioInfo: snapshot.audioAssetInfo, signal, onProgress });
          engine = sequenceRuntime.createAudio({ audioContext, audioBuffers: decoded.buffers,
            destination, masterVolume: audioMasterVolume, signal });
          return { stream: destination.stream,
            schedule: epoch => {
              const session = engine.schedule({ epoch, fromMs: range.startMs, toMs: range.endMs });
              $("audioTimelineMessage").textContent = session.scheduled.length
                ? `تمت جدولة ${session.scheduled.length} مقاطع صوتية للتصدير.`
                : "تنبيه: لا توجد مقاطع صوتية مسموعة مجدولة ضمن نطاق التصدير.";
              return session;
            },
            stop: () => {
              try { silence?.stop(); } catch {}
              try { silence?.disconnect(); } catch {}
              engine.dispose(); decoded.release();
              for (const track of destination.stream.getTracks()) { try { track.stop(); } catch {} }
            } };
        } catch (error) {
          try { silence?.stop(); } catch {}
          try { silence?.disconnect(); } catch {}
          engine?.dispose(); decoded?.release();
          for (const track of destination.stream.getTracks()) { try { track.stop(); } catch {} }
          throw error;
        }
      },
      renderFrame: (ctx, timeMs, viewport, frameContext) => {
        return sequenceRuntime.draw(ctx, timeMs, (sceneContext, scene, sceneTimeMs) => {
          const sceneRenderer = sequenceImages.sceneRenderers.find(item => item.sceneId === scene.id);
          return drawStudioScene({ ctx: sceneContext, compiledProject: sceneRenderer.compiledProject, timeMs: sceneTimeMs,
            characterTracks: sceneRenderer.characters, audioSample: sceneAudio.get(scene.id)?.sample(sceneTimeMs),
            visualEffectsCompiled: sceneRenderer.effects, viewport, frameContext });
        }, { signal: controller.signal });
      }
    };
    integratedStatus.textContent = `جارٍ تحضير ${plan.format.toUpperCase()} ${plan.viewport.width}×${plan.viewport.height} · ${sequenceEditor.scenes.length} مشاهد · ${(plan.durationMs / 1000).toFixed(2)} ث…`;
    result = await startExport(plan, host, { signal: controller.signal, onProgress: setIntegratedProgress });
    if (activeExport !== running || controller.signal.aborted) return;
    integratedVideoUrl = URL.createObjectURL(result.blob);
    integratedVideo.src = integratedVideoUrl;
    integratedVideo.hidden = false;
    integratedDownload.href = integratedVideoUrl;
    integratedDownload.download = `qarton-cinematic-${Date.now()}.${result.extension}`;
    integratedDownload.textContent = `حفظ ${result.extension.toUpperCase()} على الهاتف`;
    integratedDownload.hidden = false;
    integratedProgress.value = 1;
    integratedMetadata.textContent = `${result.mimeType} · ${result.width}×${result.height} · ${(result.bytes / 1024 / 1024).toFixed(2)} MiB · ${result.measuredDurationMs === null ? "مدة الملف غير مقاسة" : `${(result.measuredDurationMs / 1000).toFixed(2)} ث`} · ${result.renderedFrames} إطارًا · ${result.droppedFrames} إطارًا فائتًا${result.warnings.some(value => /file duration could not be measured/u.test(value)) ? " · تعذر قياس مدة الحاوية أو البحث قرب النهاية في هذا المتصفح." : ""}`;
    integratedStatus.textContent = "اكتمل التصدير المتكامل؛ عاين الملف ثم احفظه على الهاتف.";
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") integratedStatus.textContent = "أُلغي التصدير ونُظّفت موارده.";
    else {
      setExportErrorMessage(integratedError, error);
      integratedError.hidden = false;
      integratedStatus.textContent = "فشل التصدير؛ راجع الملفات والصيغة وحدود الذاكرة.";
    }
  } finally {
    sequenceImages?.release();
    sequenceRuntime?.release();
    const restorePreview = activeExport === running;
    const completedStatus = integratedStatus.textContent;
    if (activeExport === running) activeExport = null;
    if (restorePreview) {
      exportPreparing = true;
      try {
        await loadStudioScene(activeSceneId, { globalTimeMs: sequenceTimeMs, localTimeMs: currentMs });
        integratedStatus.textContent = completedStatus;
      } catch (error) {
        try { renderAt(currentMs); } catch {}
        status.textContent = `تعذرت استعادة معاينة المشهد: ${errorText(error)}`;
      } finally { exportPreparing = false; }
    }
    setExportBusy(false);
    refreshExportControls();
    if (integratedVideoUrl && !integratedDownload.hidden) {
      integratedDownload.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    try { renderAt(currentMs); } catch (error) { status.textContent = `تعذرت استعادة المعاينة: ${errorText(error)}`; }
  }
}
function audioAdapterPlay(assetId, options) {
  const asset = audioFiles.get(assetId);
  if (!asset?.url) throw new Error("ملف صوت محلي غير مرتبط. أعد اختياره من الهاتف قبل التشغيل.");
  const voice = new Audio(asset.url);
  voice.preload = "auto";
  voice.loop = options.loop;
  voice.volume = Math.max(0, Math.min(1, options.volume));
  if (options.offsetMs > 0) voice.currentTime = options.offsetMs / 1000;
  const owner = audioPlayer;
  const started = voice.play();
  started?.catch((error) => {
    if (voice.hasAttribute("src") && audioPlayer === owner && owner?.state === "playing") {
      try { audioPlayer.pause(); } catch { try { audioPlayer.recover(); } catch { /* Failure is surfaced in the editor status below. */ } }
      isPlaying = false; cancelAnimationFrame(rafId); playPauseButton.textContent = "متابعة";
      $("audioTimelineMessage").textContent = `تعذر تشغيل الصوت على هذا الجهاز: ${errorText(error)}`;
    }
  });
  return voice;
}
function audioAdapterStop(voice) { voice.pause(); voice.removeAttribute("src"); voice.load(); }
function audioAdapterSetVolume(voice, value) { voice.volume = Math.max(0, Math.min(1, value)); }
function rebuildAudioPlayer({ resume = false } = {}) {
  const wasPlaying = resume && isPlaying;
  if (audioPlayer) { try { audioPlayer.destroy(); } catch (error) { $("audioTimelineMessage").textContent = `تنظيف مورد صوت: ${errorText(error)}`; } }
  audioCompiled = compileAudioTracks(audioTracks, project.durationMs);
  audioPlayer = createCinematicAudioPlayer(audioCompiled, {
    play: audioAdapterPlay, stop: audioAdapterStop, setVolume: audioAdapterSetVolume,
    masterVolume: audioMasterVolume, now: () => performance.now()
  });
  if (currentMs > 0) audioPlayer.seek(currentMs);
  if (wasPlaying) audioPlayer.play();
}
function commitAudioTracks(nextTracks, { resume = true } = {}) {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل مسارات الصوت.");
  const nextCompiled = compileAudioTracks(nextTracks, project.durationMs);
  audioTracks = nextTracks;
  audioCompiled = nextCompiled;
  rebuildAudioPlayer({ resume });
  audioTimeline?.render();
  renderAudioInspector();
  renderAt(currentMs);
  scheduleSequenceAutosave();
}
function selectedAudioClip() {
  if (!audioClipSelection) return null;
  const track = audioTracks.find(({ id }) => id === audioClipSelection.trackId);
  const clip = track?.clips.find(({ id }) => id === audioClipSelection.clipId);
  return track && clip ? { track, clip } : null;
}
function renderAudioInspector() {
  const selected = selectedAudioClip();
  $("audioSelection").textContent = selected ? `${selected.track.type === "dialogue" ? "حوار" : selected.track.type === "music" ? "موسيقى" : "مؤثر"} · ${selected.clip.name || selected.clip.id}` : "لا يوجد مقطع محدد";
  for (const [id, value] of [["audioClipStart", selected?.clip.startMs], ["audioClipDuration", selected?.clip.durationMs], ["audioClipVolume", selected?.clip.volume ?? 1]]) {
    $(id).disabled = !selected || Boolean(activeExport);
    $(id).value = selected ? String(value) : "";
  }
  $("deleteAudioClip").disabled = !selected || Boolean(activeExport);
  $("addViseme").disabled = !selected || selected.track.type !== "dialogue" || Boolean(activeExport);
  const markerRoot = $("visemeMarkers"); markerRoot.replaceChildren();
  for (const cue of selected?.clip.visemes ?? []) {
    const marker = document.createElement("button"); marker.type = "button"; marker.className = "viseme-marker";
    marker.textContent = `${formatTime(selected.clip.startMs + cue.atMs)} · ${cue.viseme}${cue.phoneme ? ` · ${cue.phoneme}` : ""}`;
    marker.setAttribute("aria-label", `Viseme ${cue.viseme} عند ${cue.atMs} ملي ثانية`);
    marker.addEventListener("click", () => { seekTo(selected.clip.startMs + cue.atMs); }); markerRoot.append(marker);
  }
  $("addAudioClip").disabled = !activeAudioAssetId || pendingAudioRequest !== null || Boolean(activeExport);
}
function selectedVisualEffect() {
  return visualEffectsTrack.clips.find(({ id }) => id === visualEffectSelection) ?? null;
}
function commitVisualEffectsTrack(nextTrack, message = "تم تحديث المؤثر المرئي.", { refreshTimeline = true, refreshInspector = true } = {}) {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل المؤثرات المرئية.");
  const nextCompiled = compilePreviewEffects(nextTrack, project, previewViewport);
  visualEffectsTrack = nextTrack;
  visualEffectsCompiled = nextCompiled;
  if (refreshTimeline) visualEffectsTimeline?.render();
  if (refreshInspector) renderVisualEffectInspector();
  renderAt(currentMs);
  scheduleSequenceAutosave();
  $("visualEffectsMessage").textContent = message;
}
function commitVisualEffectPatch(patch, options) {
  const selected = selectedVisualEffect();
  if (!selected) return;
  commitVisualEffectsTrack(editVisualEffect(visualEffectsTrack, project, selected.id, patch), undefined, options);
  if (options?.refreshTimeline !== false) visualEffectsTimeline?.select(selected.id);
}

function readEffectNumber(input) {
  const valueText = input.value.trim();
  if (!valueText) throw new TypeError("أدخل قيمة رقمية قبل حفظ التعديل.");
  if (input.validity?.badInput) throw new TypeError("القيمة الرقمية غير صالحة.");
  const value = Number(valueText);
  if (!Number.isFinite(value)) throw new TypeError("القيمة الرقمية غير صالحة.");
  return value;
}
function renderVisualEffectInspector() {
  const selected = selectedVisualEffect();
  $("visualEffectSelection").textContent = selected ? `${selected.type} · ${selected.id}` : "لا يوجد مؤثر محدد";
  for (const [id, value] of [["visualEffectStart", selected?.atMs], ["visualEffectDuration", selected?.durationMs]]) {
    $(id).disabled = !selected || Boolean(activeExport);
    $(id).value = selected ? String(value) : "";
  }
  $("visualEffectEasing").disabled = !selected || Boolean(activeExport);
  $("visualEffectEasing").value = selected?.easing ?? "easeInOutCubic";
  $("deleteVisualEffect").disabled = !selected || Boolean(activeExport);
  const buildFields = (containerId, fieldName, values) => {
    const container = $(containerId);
    container.replaceChildren();
    if (!selected) return;
    for (const channel of VISUAL_EFFECT_CHANNELS[selected.type]) {
      const label = document.createElement("label");
      label.textContent = channel.label;
      const input = document.createElement("input");
      input.type = channel.kind === "color" ? "color" : "number";
      input.dataset.effectSource = fieldName;
      input.dataset.effectField = channel.key;
      if (channel.kind !== "color") {
        input.min = String(channel.min); input.max = String(channel.max); input.step = String(channel.step);
        input.inputMode = channel.integer ? "numeric" : "decimal";
      }
      input.value = String(values[channel.key]);
      input.disabled = Boolean(activeExport);
      label.append(input); container.append(label);
    }
  };
  buildFields("visualEffectFrom", "from", selected?.from);
  buildFields("visualEffectTo", "to", selected?.to);
  $("visualEffectType").disabled = Boolean(activeExport);
  $("addVisualEffect").disabled = Boolean(activeExport);
}
function renderAt(timeMs, preparedAudioSample = null) {
  currentMs = Math.max(0, Math.min(project.durationMs, timeMs));
  const audioSample = preparedAudioSample ?? audioPlayer?.sample(currentMs);
  drawStudioScene({ ctx: context, compiledProject: compiled, timeMs: currentMs,
    characterAnimation, characterTrack, audioSample, visualEffectsCompiled, viewport: previewViewport });
  seek.value = String(currentMs);
  timeReadout.textContent = formatTime(currentMs);
  timelineEditor?.renderPlayhead();
  characterTimeline?.render();
  audioTimeline?.renderPlayhead();
  visualEffectsTimeline?.renderPlayhead();
  if (sequenceEditor) {
    if (!isPlaying) sequenceTimeMs = sequenceEditor.timeFor(activeSceneId, currentMs);
    renderSequencePlayhead();
  }
}
function renderSequencePlayhead() {
  const total = sequenceEditor?.durationMs ?? 1;
  const time = Math.max(0, Math.min(total, sequenceTimeMs));
  $("sequenceSeek").max = String(total);
  $("sequenceSeek").value = String(time);
  $("sequenceDuration").textContent = `${formatTime(time)} / ${formatTime(total)}`;
  for (const button of $("sequenceBlocks").querySelectorAll(".sequence-block")) {
    const current = button.dataset.sceneId === activeSceneId;
    button.setAttribute("aria-current", String(current));
  }
  for (const button of $("sceneThumbnails").querySelectorAll("[data-scene-id] .scene-select")) {
    button.setAttribute("aria-current", String(button.closest("[data-scene-id]").dataset.sceneId === activeSceneId));
  }
}
function renderSequenceOverview({ rebuildCards = true, rebuildAssets = true } = {}) {
  if (!sequenceEditor) return;
  const cards = $("sceneThumbnails");
  const scenes = sequenceEditor.scenes;
  if (rebuildCards) cards.replaceChildren();
  for (const scene of rebuildCards ? scenes : []) {
    const card = document.createElement("article");
    card.className = "scene-card";
    card.dataset.sceneId = scene.id;
    const select = document.createElement("button");
    select.type = "button"; select.className = "scene-select"; select.dataset.sceneSelect = scene.id;
    select.setAttribute("aria-current", String(scene.id === activeSceneId));
    const thumb = document.createElement("span"); thumb.className = "scene-thumb";
    const image = sceneThumbnails.get(scene.id);
    if (image) { const preview = document.createElement("img"); preview.src = image; preview.alt = ""; thumb.append(preview); }
    else { thumb.textContent = `${scene.index + 1}`; }
    const title = document.createElement("span"); title.className = "scene-card-title"; title.textContent = `${scene.index + 1}. ${scene.name}`;
    select.append(thumb, title);
    select.addEventListener("click", () => { void activateStudioScene(scene.id); });
    card.append(select); cards.append(card);
  }
  const blocks = $("sequenceBlocks"); blocks.replaceChildren();
  const total = Math.max(1, sequenceEditor.durationMs);
  for (const scene of scenes) {
    const block = document.createElement("button"); block.type = "button"; block.className = "sequence-block";
    block.dataset.sceneId = scene.id; block.style.flexGrow = String(scene.project.durationMs);
    block.style.flexBasis = "0"; block.style.flexShrink = "1";
    block.title = `${scene.name} · ${formatTime(scene.project.durationMs)}`;
    block.setAttribute("aria-label", `${scene.name}, ${formatTime(scene.startMs)} إلى ${formatTime(scene.endMs)}`);
    const label = document.createElement("span"); label.textContent = scene.name; block.append(label);
    block.addEventListener("click", event => {
      const rect = block.getBoundingClientRect();
      const fraction = rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
      seekSequenceTo(scene.startMs + fraction * scene.project.durationMs);
    });
    blocks.append(block);
  }
  const current = getCurrentScene();
  $("sceneName").value = current?.name ?? "";
  $("sceneDuration").value = current ? String(current.project.durationMs / 1000) : "";
  $("deleteSceneButton").disabled = scenes.length <= 1 || Boolean(activeExport);
  $("duplicateSceneButton").disabled = Boolean(activeExport) || scenes.length >= 32;
  $("addSceneButton").disabled = Boolean(activeExport) || scenes.length >= 32;
  $("moveSceneLeftButton").disabled = Boolean(activeExport) || (current?.index ?? 0) <= 0;
  $("moveSceneRightButton").disabled = Boolean(activeExport) || (current?.index ?? 0) >= scenes.length - 1;
  renderSequencePlayhead();
  if (rebuildAssets) renderAssetLibrary();
}
function currentAssetReferences(assetId) {
  return sequenceEditor.sequence.scenes.filter(scene => scene.project.layers.some(layer => layer.assetId === assetId) ||
    scene.audioTracks.some(track => track.clips.some(clip => clip.asset === assetId)) ||
    scene.characterTracks.some(track => Object.values(track.character.animation?.clips ?? {}).some(clip =>
      clip.spriteSheet ? clip.spriteSheet.asset.trim() === assetId : [...clip.frames, ...(clip.blinkFrames ?? [])].includes(assetId))))
    .map(scene => scene.id);
}
function renderAssetLibrary() {
  const root = $("assetLibraryList");
  if (!root) return;
  $("assetBudgetLabel").textContent = assetStorageStatus;
  root.replaceChildren();
  for (const asset of sequenceEditor.sequence.assets) {
    const uses = [...new Set([...(persistentAssets?.references(asset.id) ?? []), ...currentAssetReferences(asset.id)])];
    const row = document.createElement("div"); row.className = "asset-entry"; row.dataset.assetId = asset.id;
    const name = document.createElement("span"); name.className = "asset-entry-name"; name.textContent = asset.name;
    const meta = document.createElement("span"); meta.className = "asset-entry-meta";
    meta.textContent = `${asset.kind === "image" ? "صورة" : asset.kind === "audio" ? "صوت" : asset.kind} · ${(asset.size / 1024 / 1024).toFixed(2)} MiB · ${uses.length ? `مستخدم في ${uses.length} مشهد` : "غير مستخدم"}`;
    const use = document.createElement("button"); use.type = "button"; use.textContent = "استخدم"; use.setAttribute("aria-label", `استخدم الأصل ${asset.name}`);
    use.disabled = !getAssetBlob(asset.id) || Boolean(activeExport);
    use.addEventListener("click", () => { void useLibraryAsset(asset.id); });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "حذف"; remove.setAttribute("aria-label", `حذف الأصل ${asset.name}`);
    remove.disabled = uses.length > 0 || Boolean(activeExport) || !persistentAssets;
    remove.addEventListener("click", () => { void removeLibraryAsset(asset.id); });
    row.append(name, meta, use, remove); root.append(row);
  }
}
function makeThumbnail() {
  try {
    const thumb = document.createElement("canvas"); thumb.width = 120; thumb.height = 68;
    thumb.getContext("2d").drawImage(canvas, 0, 0, thumb.width, thumb.height);
    sceneThumbnails.set(activeSceneId, thumb.toDataURL("image/jpeg", 0.55));
  } catch { /* A missing or tainted preview leaves the accessible scene label visible. */ }
}
function createSequenceSceneFromCurrent(id, { freshTracks = false } = {}) {
  return { id,
    project: structuredClone(project),
    audioTracks: freshTracks ? makeAudioTracks() : structuredClone(audioTracks),
    characterTracks: freshTracks ? [makeCharacterTrack()] : structuredClone([characterTrack, ...(sceneExtraCharacterTracks.get(activeSceneId) ?? [])]),
    visualEffectsTrack: freshTracks ? makeVisualEffectsTrack() : structuredClone(visualEffectsTrack) };
}
function replaceCurrentSceneAndAssets(nextAssets = sequenceEditor.sequence.assets) {
  const old = sequenceEditor.sequence;
  const current = currentScenePayload();
  const scenes = old.scenes.map(scene => scene.id === activeSceneId ? current : scene);
  const next = createStudioSequenceV1({ viewport: project.viewport, scenes, assets: nextAssets });
  sequenceEditor.replaceSequence(next);
  persistSequenceMetadata();
  void persistentAssets?.replaceSequence(next).catch(error => {
    $("assetLibraryMessage").textContent = `تعذر حفظ مراجع الأصول: ${errorText(error)}`;
  });
  audioAssets = next.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
  renderAssetLibrary();
  return next;
}
async function useLibraryAsset(id) {
  try {
    await assetReady;
    const asset = sequenceEditor.sequence.assets.find(item => item.id === id);
    const blob = getAssetBlob(id);
    if (!asset || !blob) throw new Error("الأصل غير مرتبط؛ أعد اختياره من الهاتف.");
    if (asset.kind === "audio") {
      let audio = audioFiles.get(id);
      if (!audio) {
        const file = new File([blob], asset.name, { type: asset.mimeType });
        const url = URL.createObjectURL(file);
        let durationMs = 0; try { durationMs = await readAudioDuration(file); } catch { /* Timeline clips retain their authored duration. */ }
        audio = { file, url, durationMs }; audioFiles.set(id, audio);
      }
      activeAudioAssetId = id;
      $("audioFileName").textContent = `${asset.name} · ${(asset.size / 1024 / 1024).toFixed(2)} MiB`;
      $("audioTimelineMessage").textContent = `الأصل ${asset.name} جاهز للمسار الحالي.`;
      renderAudioInspector();
      return;
    }
    if (asset.kind !== "image") throw new TypeError("هذا النوع من الأصول لا يمكن وضعه في المشهد بعد.");
    const file = new File([blob], asset.name, { type: asset.mimeType });
    const imageRequestToken = imageRequest.begin();
    pendingImageRequest = imageRequestToken; refreshExportControls();
    const bitmap = await decodeImageBitmap(file, { isCurrent: () => imageRequest.isCurrent(imageRequestToken) });
    try {
      selectedImageDimensions = { width: bitmap.width, height: bitmap.height };
      const surface = drawBitmap(bitmap);
      const nextProject = structuredClone(project);
      nextProject.layers[0].assetId = id;
      project = nextProject; selectedImageFile = file; currentFileInfo = { name: asset.name, type: asset.mimeType, size: asset.size };
      imageSource = surface; sceneImageSources.set(id, surface);
      compiled = compileProject(projectForRaster(project, previewViewport), imageProvider);
      replaceCurrentSceneAndAssets();
      sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
      imageName.textContent = `${asset.name} · ${bitmap.width}×${bitmap.height}`;
      renderAt(currentMs); status.textContent = "تم ربط الصورة بالمشهد";
    } finally { bitmap.close?.(); }
  } catch (error) { $("assetLibraryMessage").textContent = errorText(error); }
  finally { if (pendingImageRequest !== null) pendingImageRequest = null; refreshExportControls(); }
}
async function removeLibraryAsset(id) {
  try {
    captureCurrentScene();
    await assetReady;
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    if (persistentAssets) {
      await persistentAssets.remove(id);
      sequenceEditor.replaceSequence(persistentAssets.sequence);
    } else {
      if (currentAssetReferences(id).length) throw new Error("لا يمكن حذف أصل تستخدمه المشاهد.");
      const sequence = sequenceEditor.sequence;
      const next = createStudioSequenceV1({ viewport: sequence.viewport, scenes: sequence.scenes,
        assets: sequence.assets.filter(asset => asset.id !== id) });
      sequenceEditor.replaceSequence(next); localAssetFiles.delete(id);
    }
    persistSequenceMetadata();
    audioAssets = sequenceEditor.sequence.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
    const audio = audioFiles.get(id); if (audio?.url) URL.revokeObjectURL(audio.url); audioFiles.delete(id);
    renderAssetLibrary();
    $("assetLibraryMessage").textContent = "حُذف الأصل غير المستخدم من هذا الجهاز.";
  } catch (error) { $("assetLibraryMessage").textContent = errorText(error); }
}
function inputNumber(id) { return Number($(id).value); }
function syncMotionTimeBounds() {
  const durationSeconds = project.durationMs / 1000;
  const from = $("motionFromSeconds"); const to = $("motionToSeconds");
  from.max = String(durationSeconds); to.max = String(durationSeconds);
  const fromValue = from.value.trim() ? Number(from.value) : NaN;
  const toValue = to.value.trim() ? Number(to.value) : NaN;
  if (Number.isFinite(fromValue) && fromValue > durationSeconds) from.value = String(Math.max(0, durationSeconds - 0.1));
  if (Number.isFinite(toValue) && toValue > durationSeconds) to.value = String(durationSeconds);
}
function setEditorSection(section) {
  if (!["scenes", "motion", "audio", "effects", "more"].includes(section)) return;
  activeEditorSection = section;
  for (const panel of document.querySelectorAll("[data-tool-panel]")) panel.hidden = panel.dataset.toolPanel !== section;
  for (const button of document.querySelectorAll("[data-editor-section]")) {
    button.setAttribute("aria-pressed", String(button.dataset.editorSection === section));
  }
  studioRoot.dataset.editorSection = section;
}
function setEditorMode(mode) {
  if (!["automatic", "simple", "professional"].includes(mode)) return;
  studioRoot.dataset.editorMode = mode;
  for (const button of document.querySelectorAll("[data-editor-mode-button]")) {
    button.setAttribute("aria-pressed", String(button.dataset.editorModeButton === mode));
  }
  for (const panel of document.querySelectorAll("[data-mode-panel]")) panel.hidden = panel.dataset.modePanel !== mode;
}
function readMotionSeconds(id, label) {
  const input = $(id); const text = input.value.trim();
  if (!text || input.validity.badInput) throw new TypeError(`${label}: أدخل وقتًا بالثواني.`);
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > project.durationMs / 1000) throw new RangeError(`${label}: الوقت خارج مدة المشهد.`);
  return value;
}
function refreshMotionUndoButtons() {
  const disabled = !quickMotionUndo || Boolean(activeExport);
  for (const button of [$("undoMotionButton"), $("undoMotionAutomatic")]) button.disabled = disabled;
  const headerUndo = $("headerUndoButton");
  if (headerUndo) headerUndo.disabled = disabled;
}
function applyQuickMotion(preset, automatic = false) {
  const fromField = $("motionFromSeconds"); const toField = $("motionToSeconds");
  fromField.removeAttribute("aria-invalid"); toField.removeAttribute("aria-invalid");
  try {
    const fromSeconds = automatic ? 0 : readMotionSeconds("motionFromSeconds", "بداية الحركة");
    const toSeconds = automatic ? project.durationMs / 1000 : readMotionSeconds("motionToSeconds", "نهاية الحركة");
    if (fromSeconds >= toSeconds) throw new RangeError("يجب أن تكون نهاية الحركة بعد بدايتها.");
    const settings = automatic ? { speed: 0.75, strength: 36, focusX: 50, focusY: 50 }
      : { speed: Number($("motionSpeed").value), strength: Number($("motionStrength").value),
        focusX: Number($("motionFocusX").value), focusY: Number($("motionFocusY").value) };
    const nextProject = createCameraMotionProject(project, { preset, fromSeconds, toSeconds, ...settings });
    const previousProject = structuredClone(project);
    committingQuickMotion = true;
    try {
      commitKeyframeProject(nextProject);
      timelineEditor?.render();
      timelineEditor?.selectTime(Math.round(fromSeconds * 1000));
    } finally { committingQuickMotion = false; }
    quickMotionUndo = previousProject;
    refreshMotionUndoButtons();
    const label = CAMERA_MOTION_PRESETS.find((item) => item.id === preset)?.label ?? "الحركة";
    $("motionPresetMessage").textContent = automatic
      ? `طُبّق اقتراح «${label}» على كامل المشهد. يمكنك متابعة التعديل في الوضع الاحترافي.`
      : `طُبّقت «${label}» من ${fromSeconds} إلى ${toSeconds} ثانية.`;
  } catch (error) {
    if (!fromField.value.trim() || fromField.validity.badInput) fromField.setAttribute("aria-invalid", "true");
    if (!toField.value.trim() || toField.validity.badInput) toField.setAttribute("aria-invalid", "true");
    $("motionPresetMessage").textContent = errorText(error);
  }
}
function undoQuickMotion() {
  if (!quickMotionUndo || activeExport) return;
  const previous = quickMotionUndo;
  committingQuickMotion = true;
  try {
    commitKeyframeProject(previous);
    timelineEditor?.render();
    quickMotionUndo = null;
    $("motionPresetMessage").textContent = "تم التراجع عن آخر حركة جاهزة.";
  } catch (error) { $("motionPresetMessage").textContent = errorText(error); }
  finally { committingQuickMotion = false; refreshMotionUndoButtons(); }
}
for (const button of document.querySelectorAll("[data-editor-mode-button]")) {
  button.addEventListener("click", () => setEditorMode(button.dataset.editorModeButton));
}
for (const button of document.querySelectorAll("[data-editor-section]")) {
  button.addEventListener("click", () => {
    const section = button.dataset.editorSection;
    if (["audio", "effects", "more"].includes(section)) setEditorMode("professional");
    setEditorSection(section);
  });
}
$("headerSaveButton").addEventListener("click", () => $("saveProjectButton").click());
$("headerUndoButton").addEventListener("click", undoQuickMotion);
$("headerExportButton").addEventListener("click", () => {
  setEditorMode("professional");
  setEditorSection("more");
  $("integratedExportButton").focus({ preventScroll: true });
});
$("fullscreenPreviewButton").addEventListener("click", async () => {
  const target = $("studioPreview");
  try {
    if (document.fullscreenElement === target) await document.exitFullscreen();
    else if (target.requestFullscreen) await target.requestFullscreen();
    else target.classList.toggle("preview-fullscreen");
  } catch { target.classList.toggle("preview-fullscreen"); }
});
for (const button of document.querySelectorAll("[data-motion-preset]")) {
  button.addEventListener("click", () => applyQuickMotion(button.dataset.motionPreset, button.dataset.automaticMotion === "true"));
}
for (const button of [$("undoMotionButton"), $("undoMotionAutomatic")]) button.addEventListener("click", undoQuickMotion);
$("motionStrength").addEventListener("input", () => { $("motionStrengthValue").textContent = `${$("motionStrength").value}%`; });
$("motionFocusX").addEventListener("input", () => { $("motionFocusXValue").textContent = `${$("motionFocusX").value}%`; });
$("motionFocusY").addEventListener("input", () => { $("motionFocusYValue").textContent = `${$("motionFocusY").value}%`; });
for (const id of ["motionFromSeconds", "motionToSeconds"]) $(id).addEventListener("input", () => $(id).removeAttribute("aria-invalid"));

function syncOutputs() {
  for (const [id, suffix, digits] of [
    ["startZoom", "×", 2], ["endZoom", "×", 2], ["startX", " px", 0],
    ["endX", " px", 0], ["startY", " px", 0], ["endY", " px", 0]
  ]) $(`${id}Value`).textContent = `${inputNumber(id).toFixed(digits)}${suffix}`;
  $("durationValue").textContent = `${inputNumber("duration")} ثانية`;
  $("viewportValue").textContent = `${project.viewport.width} × ${project.viewport.height} · معاينة ${previewViewport.width} × ${previewViewport.height}`;
}
function syncLegacyCameraInputs() {
  const start = project.camera?.[0]?.value;
  const end = project.camera?.at(-1)?.value;
  if (start && end) {
    for (const [id, value] of [["startZoom", start.zoom], ["endZoom", end.zoom], ["startX", start.x], ["endX", end.x], ["startY", start.y], ["endY", end.y]]) {
      $(id).value = String(value);
    }
    syncOutputs();
  }
}
function commitKeyframeProject(nextProject) {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل Keyframes.");
  const nextCompiled = compileProject(projectForRaster(nextProject, previewViewport), {
    get: (assetId) => nextProject.layers.some((layer) => layer.assetId === assetId) ? imageSource : null
  });
  const nextEffectsCompiled = compilePreviewEffects(visualEffectsTrack, nextProject, previewViewport);
  project = nextProject;
  if (!committingQuickMotion) { quickMotionUndo = null; refreshMotionUndoButtons(); }
  compiled = nextCompiled;
  visualEffectsCompiled = nextEffectsCompiled;
  syncLegacyCameraInputs();
  renderAt(currentMs);
  scheduleSequenceAutosave();
  status.textContent = currentFileInfo ? "تم تحديث حركة الكاميرا" : "الحركة جاهزة؛ اختر صورة للمعاينة";
}
function commitCharacterTrack(nextTrack) {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل مسار الشخصية.");
  const nextAnimation = compileCharacterTrack(nextTrack, project.durationMs);
  characterTrack = nextTrack;
  characterAnimation = nextAnimation;
  renderAt(currentMs);
  scheduleSequenceAutosave();
  status.textContent = "تم تحديث حركة الشخصية";
}
function applyCanvasDimensions(size) {
  previewViewport = size;
  if (canvas.width !== previewViewport.width) canvas.width = previewViewport.width;
  if (canvas.height !== previewViewport.height) canvas.height = previewViewport.height;
  canvas.style.aspectRatio = `${previewViewport.width} / ${previewViewport.height}`;
  canvas.setAttribute("aria-label", `معاينة الصورة المتحركة ${project.viewport.width} في ${project.viewport.height}`);
}
function setCanvasDimensions() {
  applyCanvasDimensions(safePreviewSize(project.viewport.width, project.viewport.height));
  if (!currentFileInfo) {
    placeholder = makePlaceholder(previewViewport);
    imageSource = placeholder;
  }
}
function updateProject({ resetPlayback = false, viewport = project.viewport, editedControl = null } = {}) {
  quickMotionUndo = null;
  refreshMotionUndoButtons();
  invalidateExport("تغيّر المشروع؛ أُلغي التصدير السابق أو الجاري.");
  clearFailure();
  try {
    const previousDurationMs = project.durationMs;
    const durationMs = inputNumber("duration") * 1000;
    compileAudioTracks(audioTracks, durationMs);
    const nextViewport = { width: viewport.width, height: viewport.height, fps: VIEWPORT.fps };
    const nextPreview = safePreviewSize(nextViewport.width, nextViewport.height);
    const nextImageSource = currentFileInfo ? imageSource : makePlaceholder(nextPreview);
    const fallbackPose = { x: 0, y: 0, zoom: 1, rotation: 0 };
    const startPose = { ...(project.camera?.[0]?.value ?? fallbackPose) };
    const endPose = { ...(project.camera?.at(-1)?.value ?? fallbackPose) };
    const controlEdit = {
      startZoom: [startPose, "zoom"], endZoom: [endPose, "zoom"],
      startX: [startPose, "x"], endX: [endPose, "x"],
      startY: [startPose, "y"], endY: [endPose, "y"]
    }[editedControl];
    if (controlEdit) controlEdit[0][controlEdit[1]] = inputNumber(editedControl);
    const selectedWasLast = timelineEditor?.getSelectedTime() !== null &&
      timelineEditor?.getSelectedTime() === project.camera?.at(-1)?.atMs;
    const { project: nextProject, prepared: nextCompiled } = prepareProjectUpdate(project, {
      durationMs,
      viewport: nextViewport,
      start: startPose,
      end: endPose,
      editedControl,
      prepare: (candidate) => compileProject(projectForRaster(candidate, nextPreview), {
        get: (assetId) => candidate.layers.some((layer) => layer.assetId === assetId) ? nextImageSource : null
      })
    });
    const nextCharacterAnimation = compileCharacterTrack(characterTrack, durationMs);
    const nextVisualEffectsCompiled = compilePreviewEffects(visualEffectsTrack,nextProject,nextPreview);
    const viewportChanged = nextViewport.width !== project.viewport.width || nextViewport.height !== project.viewport.height;
    if (durationMs !== previousDurationMs || viewportChanged) {
      const sequence = sequenceEditor.sequence;
      const scenes = sequence.scenes.map(scene => {
        if (scene.id === activeSceneId) return { ...currentScenePayload(), project: nextProject };
        return viewportChanged ? { ...scene, project: { ...scene.project, viewport: { ...nextViewport } } } : scene;
      });
      const nextSequence = createStudioSequenceV1({ viewport: nextViewport, scenes, assets: sequence.assets });
      sequenceEditor.replaceSequence(nextSequence);
      persistSequenceMetadata();
      void persistentAssets?.replaceSequence(nextSequence).catch(error => {
        $("assetLibraryMessage").textContent = `تعذر تحديث أبعاد التسلسل: ${errorText(error)}`;
      });
    }
    project = nextProject;
    compiled = nextCompiled;
    visualEffectsCompiled = nextVisualEffectsCompiled;
    characterAnimation = nextCharacterAnimation;
    if (resetPlayback) stopPlayback();
    rebuildAudioPlayer({ resume: !resetPlayback });
    if (selectedWasLast && project.camera?.length) timelineEditor.selectTime(project.camera.at(-1).atMs);
    if (!currentFileInfo) placeholder = imageSource = nextImageSource;
    applyCanvasDimensions(nextPreview);
    seek.max = String(durationMs);
    syncMotionTimeBounds();
    syncIntegratedRange();
    syncLegacyCameraInputs();
    timelineEditor?.render();
    refreshCharacterTimeline();
    audioTimeline?.render(); renderAudioInspector();
    visualEffectsTimeline?.render(); renderVisualEffectInspector();
    renderAt(Math.min(currentMs, durationMs));
    status.textContent = currentFileInfo ? "المعاينة جاهزة" : "اختر صورة للبدء";
    syncOutputs();
    refreshIntegratedControls();
    scheduleSequenceAutosave();
    if (durationMs !== previousDurationMs || viewportChanged) renderSequenceOverview({ rebuildCards: false, rebuildAssets: false });
  } catch (error) { fail(error); }
}
function stopPlayback() {
  if (isPlaying) sequenceTimeMs = currentSequenceTime();
  if (audioPlayer?.state === "playing") {
    try { const sampled = audioPlayer.pause(); currentMs = sampled.timeMs; }
    catch (error) { try { audioPlayer.recover(); } catch { /* Keep the last stable preview time after adapter failure. */ } $("audioTimelineMessage").textContent = `توقفت المعاينة بعد خطأ صوتي: ${errorText(error)}`; }
  }
  isPlaying = false;
  pausedAt = null;
  cancelAnimationFrame(rafId);
  sequenceEpochMs = 0;
  playPauseButton.textContent = "تشغيل";
}
async function playbackTick(now = performance.now()) {
  if (!isPlaying) return;
  const globalMs = Math.min(sequenceEditor.durationMs, sequenceBaseMs + Math.max(0, now - sequenceEpochMs));
  const sequenceSample = sequenceEditor.sample(globalMs);
  sequenceTimeMs = globalMs;
  if (sequenceSample.sceneId !== activeSceneId) {
    await activateStudioScene(sequenceSample.sceneId, { globalTimeMs: globalMs, localTimeMs: sequenceSample.sceneTimeMs, keepPlaying: true });
    if (isPlaying) rafId = requestAnimationFrame(playbackTick);
    return;
  }
  let audioSample;
  try { audioSample = audioPlayer.tick(); }
  catch (error) {
    try { audioPlayer.recover(); } catch { /* Adapter cleanup failure is reported to the user below. */ }
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "متابعة"; cancelAnimationFrame(rafId);
    $("audioTimelineMessage").textContent = `تعذر تحديث مسار الصوت: ${errorText(error)}`; return;
  }
  renderAt(sequenceSample.sceneTimeMs, audioSample);
  if (globalMs >= sequenceEditor.durationMs) {
    stopPlayback();
    sequenceTimeMs = sequenceEditor.durationMs;
    renderSequencePlayhead();
    return;
  }
  rafId = requestAnimationFrame(playbackTick);
}
async function play() {
  if (sequenceTimeMs >= sequenceEditor.durationMs) {
    const first = sequenceEditor.scenes[0];
    await activateStudioScene(first.id, { globalTimeMs: 0, localTimeMs: 0 });
  }
  try {
    const sample = audioPlayer.play();
    pausedAt = null; currentMs = sample.timeMs; isPlaying = true;
    sequenceBaseMs = sequenceTimeMs; sequenceEpochMs = performance.now();
    playPauseButton.textContent = "إيقاف مؤقت";
    renderAt(currentMs, sample); rafId = requestAnimationFrame(playbackTick);
  } catch (error) {
    try { audioPlayer.recover(); } catch { /* Keep player in the recoverable paused state. */ }
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "متابعة";
    $("audioTimelineMessage").textContent = `تعذر تشغيل الصوت: ${errorText(error)}`;
  }
}
async function replay() {
  stopPlayback();
  try {
    captureCurrentScene();
    const first = sequenceEditor.scenes[0];
    await activateStudioScene(first.id, { globalTimeMs: 0, localTimeMs: 0 });
    sequenceTimeMs = 0;
    await play();
  } catch (error) { try { audioPlayer?.recover(); } catch { /* Retry remains possible after resource cleanup. */ } $("audioTimelineMessage").textContent = `تعذرت إعادة التشغيل: ${errorText(error)}`; }
}
function seekTo(timeMs) {
  if (sequenceEditor) { seekSequenceTo(sequenceEditor.timeFor(activeSceneId, timeMs)); return; }
  const wasPlaying = isPlaying;
  try {
    const sampled = audioPlayer.seek(timeMs);
    if (!wasPlaying && sampled.timeMs < project.durationMs) playPauseButton.textContent = pausedAt === null ? "تشغيل" : "متابعة";
    renderAt(sampled.timeMs, sampled);
  } catch (error) {
    try { audioPlayer.recover(); } catch { /* Preserve the last committed preview and expose the adapter failure. */ }
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "متابعة";
    $("audioTimelineMessage").textContent = `تعذر الانتقال إلى الزمن المطلوب: ${errorText(error)}`;
  }
}
function pauseSequencePlayback() {
  if (!isPlaying) return;
  const target = currentSequenceTime();
  isPlaying = false; sequenceTimeMs = target; sequenceEpochMs = 0;
  cancelAnimationFrame(rafId);
  try { audioPlayer?.pause(); } catch { try { audioPlayer?.recover(); } catch { /* Continue with deterministic visual time. */ } }
  const sample = sequenceEditor.sample(target);
  if (sample.sceneId !== activeSceneId) {
    void activateStudioScene(sample.sceneId, { globalTimeMs: target, localTimeMs: sample.sceneTimeMs });
  } else {
    renderAt(sample.sceneTimeMs, audioPlayer?.sample(sample.sceneTimeMs));
  }
  pausedAt = sample.sceneTimeMs;
  playPauseButton.textContent = "متابعة";
}
function dimensionsForCurrentPreset() {
  const size = projectSizeForPreset(aspectPreset, selectedImageDimensions?.width, selectedImageDimensions?.height);
  return { ...size, fps: VIEWPORT.fps };
}
async function restoreSceneAssets(scene) {
  sceneImageSources.clear();
  imageSource = makePlaceholder(previewViewport);
  let firstImage = null;
  for (const layer of scene.project.layers) {
    const asset = sequenceEditor.sequence.assets.find(item => item.id === layer.assetId && item.kind === "image");
    const blob = getAssetBlob(layer.assetId);
    if (!asset || !blob) continue;
    try {
      const file = new File([blob], asset.name, { type: asset.mimeType });
      const bitmap = await decodeImageBitmap(file);
      try {
        const surface = drawBitmap(bitmap);
        sceneImageSources.set(asset.id, surface);
        if (!firstImage) firstImage = { file, surface, asset, width: bitmap.width, height: bitmap.height };
      } finally { bitmap.close?.(); }
    } catch (error) { $("assetLibraryMessage").textContent = `تعذر فك الصورة ${asset.name}: ${errorText(error)}`; }
  }
  for (const track of scene.audioTracks) for (const clip of track.clips) {
    const cached = audioFiles.get(clip.asset);
    if (cached?.durationMs > 0) continue;
    const asset = sequenceEditor.sequence.assets.find(item => item.id === clip.asset && item.kind === "audio");
    const blob = getAssetBlob(clip.asset);
    if (!asset || !blob) continue;
    const file = new File([blob], asset.name, { type: asset.mimeType });
    const url = URL.createObjectURL(file);
    let durationMs = 0;
    try { durationMs = await readAudioDuration(file); }
    catch (error) { $("audioTimelineMessage").textContent = `تعذر قراءة الصوت ${asset.name}: ${errorText(error)}`; }
    if (cached?.url) URL.revokeObjectURL(cached.url);
    audioFiles.set(asset.id, { file, url, durationMs });
  }
  imageSource = firstImage?.surface ?? imageSource;
  currentFileInfo = firstImage ? { name: firstImage.asset.name, type: firstImage.asset.mimeType, size: firstImage.asset.size } : null;
  selectedImageFile = firstImage?.file ?? null;
  selectedImageDimensions = firstImage ? { width: firstImage.width, height: firstImage.height } : null;
  if (currentFileInfo) sceneSettings.set(scene.id, { aspectPreset, fitMode, image: currentFileInfo });
  return firstImage;
}
function activateStudioScene(sceneId, options = {}) {
  if (activeExport || exportPreparing) return;
  const loading = loadStudioScene(sceneId, options);
  pendingSceneActivation = loading;
  void loading.finally(() => {
    if (pendingSceneActivation === loading) pendingSceneActivation = null;
  }).catch(() => {});
  return loading;
}
async function loadStudioScene(sceneId, { globalTimeMs = null, localTimeMs = 0, keepPlaying = false } = {}) {
  if (activeExport) return;
  if (!keepPlaying && isPlaying) stopPlayback();
  const wasPlaying = keepPlaying && isPlaying;
  const target = sequenceEditor.sequence.scenes.find(scene => scene.id === sceneId);
  if (!target) return;
  if (sceneId !== activeSceneId) {
    sceneSettings.set(activeSceneId, { aspectPreset, fitMode, image: currentFileInfo });
    makeThumbnail();
    captureCurrentScene();
    try { await persistentAssets?.replaceSequence(sequenceEditor.sequence); }
    catch (error) { $("assetLibraryMessage").textContent = `تعذر حفظ المشهد الحالي: ${errorText(error)}`; return; }
    sequenceEditor.activate(sceneId);
  }
  const token = ++sceneLoadToken;
  activeSceneId = sceneId;
  quickMotionUndo = null;
  const imageSettings = sceneImageSettings(sceneId);
  aspectPreset = imageSettings.aspectPreset;
  fitMode = imageSettings.fitMode;
  project = structuredClone(target.project);
  audioTracks = structuredClone(target.audioTracks);
  characterTrack = structuredClone(target.characterTracks[0] ?? makeCharacterTrack());
  sceneExtraCharacterTracks.set(sceneId, structuredClone(target.characterTracks.slice(1)));
  visualEffectsTrack = structuredClone(target.visualEffectsTrack);
  visualEffectSelection = null; audioClipSelection = null;
  aspectSelect.value = aspectPreset; fitSelect.value = fitMode;
  previewViewport = safePreviewSize(project.viewport.width, project.viewport.height);
  applyCanvasDimensions(previewViewport);
  status.textContent = "جارٍ تحميل أصول المشهد…";
  const loadingSurface = makePlaceholder(previewViewport);
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(loadingSurface, 0, 0);
  } finally { context.restore(); }
  await restoreSceneAssets(target);
  if (token !== sceneLoadToken || activeExport) return;
  audioAssets = sequenceEditor.sequence.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
  if (activeAudioAssetId && !audioAssets.some(asset => asset.id === activeAudioAssetId)) activeAudioAssetId = null;
  const audioAsset = audioAssets.find(item => audioFiles.has(item.id));
  if (!activeAudioAssetId) activeAudioAssetId = audioAsset?.id ?? null;
  characterAnimation = compileCharacterTrack(characterTrack, project.durationMs);
  compiled = compileProject(projectForRaster(project, previewViewport), imageProvider);
  visualEffectsCompiled = compilePreviewEffects(visualEffectsTrack, project, previewViewport);
  if (audioPlayer) { try { audioPlayer.destroy(); } catch { /* Rebuilt immediately below. */ } }
  audioPlayer = null;
  audioCompiled = compileAudioTracks(audioTracks, project.durationMs);
  audioPlayer = createCinematicAudioPlayer(audioCompiled, { play: audioAdapterPlay, stop: audioAdapterStop,
    setVolume: audioAdapterSetVolume, masterVolume: audioMasterVolume, now: () => performance.now() });
  currentMs = Math.max(0, Math.min(project.durationMs, localTimeMs));
  if (currentMs > 0) audioPlayer.seek(currentMs);
  if (wasPlaying) audioPlayer.play();
  seek.max = String(project.durationMs);
  syncMotionTimeBounds();
  $("duration").value = String(project.durationMs / 1000);
  syncIntegratedRange();
  if (currentFileInfo) imageName.textContent = `${currentFileInfo.name} · ${selectedImageDimensions?.width ?? "?"}×${selectedImageDimensions?.height ?? "?"}`;
  else imageName.textContent = "أعد ربط صورة المشهد من مكتبة الأصول";
  timelineEditor?.clearSelection(); timelineEditor?.render();
  refreshCharacterTimeline(); audioTimeline?.clearSelection(); audioTimeline?.render();
  visualEffectsTimeline?.clearSelection(); visualEffectsTimeline?.render();
  renderAudioInspector(); renderVisualEffectInspector(); syncLegacyCameraInputs(); syncOutputs();
  sequenceTimeMs = globalTimeMs ?? sequenceEditor.timeFor(sceneId, currentMs);
  renderAt(currentMs);
  if (wasPlaying) { sequenceBaseMs = sequenceTimeMs; sequenceEpochMs = performance.now(); }
  makeThumbnail();
  renderSequenceOverview(); refreshExportControls();
  status.textContent = currentFileInfo ? `المشهد جاهز: ${sequenceEditor.nameOf(sceneId)}` : `صورة المشهد غير متاحة؛ أعد ربطها: ${sequenceEditor.nameOf(sceneId)}`;
}
async function addScene() {
  if (activeExport || sequenceEditor.scenes.length >= 32) return;
  try {
    stopPlayback(); captureCurrentScene(); makeThumbnail();
    const id = makeLocalId("scene");
    const scene = createSequenceSceneFromCurrent(id, { freshTracks: true });
    const result = sequenceEditor.add(scene, sequenceEditor.scenes.length, `المشهد ${sequenceEditor.scenes.length + 1}`);
    sceneSettings.set(id, { aspectPreset, fitMode, image: currentFileInfo });
    persistSequenceMetadata();
    await persistentAssets?.replaceSequence(result.sequence);
    activeSceneId = id;
    await activateStudioScene(id, { localTimeMs: 0 });
    $("assetLibraryMessage").textContent = "أُضيف المشهد. الأصول المشتركة تبقى مرتبطة بمعرّفاتها.";
  } catch (error) { fail(error); }
}
async function duplicateActiveScene(sceneId = activeSceneId) {
  if (activeExport || sequenceEditor.scenes.length >= 32) return;
  try {
    stopPlayback(); captureCurrentScene(); makeThumbnail();
    const id = makeLocalId("scene-copy");
    const sourceThumb = sceneThumbnails.get(sceneId);
    const sourceSettings = sceneImageSettings(sceneId);
    sequenceEditor.duplicate(sceneId, id);
    sceneSettings.set(id, { aspectPreset: sourceSettings.aspectPreset, fitMode: sourceSettings.fitMode, image: currentFileInfo });
    persistSequenceMetadata();
    if (sourceThumb) sceneThumbnails.set(id, sourceThumb);
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    activeSceneId = id;
    await activateStudioScene(id, { localTimeMs: 0 });
  } catch (error) { fail(error); }
}
async function deleteActiveScene() {
  if (activeExport || sequenceEditor.scenes.length <= 1) return;
  try {
    stopPlayback(); captureCurrentScene(); makeThumbnail();
    const removed = activeSceneId;
    const result = sequenceEditor.remove(removed);
    persistSequenceMetadata();
    sceneThumbnails.delete(removed); sceneSettings.delete(removed); sceneExtraCharacterTracks.delete(removed);
    activeSceneId = result.activeSceneId;
    await persistentAssets?.replaceSequence(result.sequence);
    await activateStudioScene(activeSceneId, { localTimeMs: 0 });
  } catch (error) { fail(error); }
}
async function reorderScene(sceneId, toIndex) {
  if (activeExport || toIndex < 0 || toIndex >= sequenceEditor.scenes.length) return;
  try {
    captureCurrentScene();
    sequenceEditor.reorder(sceneId, toIndex);
    persistSequenceMetadata();
    await persistentAssets?.replaceSequence(sequenceEditor.sequence);
    renderSequenceOverview();
  } catch (error) { fail(error); }
}
function seekSequenceTo(timeMs) {
  if (!Number.isFinite(timeMs)) return;
  const wasPlaying = isPlaying;
  const target = Math.max(0, Math.min(sequenceEditor.durationMs, timeMs));
  sequenceTimeMs = target;
  if (wasPlaying) { sequenceBaseMs = target; sequenceEpochMs = performance.now(); }
  const sample = sequenceEditor.sample(target);
  if (sample.sceneId !== activeSceneId) {
    void activateStudioScene(sample.sceneId, { globalTimeMs: target, localTimeMs: sample.sceneTimeMs, keepPlaying: wasPlaying });
    return;
  }
  let audioSample;
  try { audioSample = audioPlayer?.seek(sample.sceneTimeMs); } catch { audioSample = null; }
  if (wasPlaying && audioPlayer?.state !== "playing") { try { audioPlayer?.play(); } catch { /* The timeline continues silently if an audio adapter rejects playback. */ } }
  renderAt(sample.sceneTimeMs, audioSample);
  if (!wasPlaying && target >= sequenceEditor.durationMs) {
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "إعادة التشغيل";
  } else if (!wasPlaying) playPauseButton.textContent = pausedAt === null ? "تشغيل" : "متابعة";
}
function currentSequenceTime(now = performance.now()) {
  return isPlaying ? Math.min(sequenceEditor.durationMs, sequenceBaseMs + Math.max(0, now - sequenceEpochMs)) : sequenceTimeMs;
}
function drawBitmap(bitmap) {
  const surface = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(previewViewport.width, previewViewport.height)
    : Object.assign(document.createElement("canvas"), { width: previewViewport.width, height: previewViewport.height });
  const surfaceContext = surface.getContext("2d", { alpha: false });
  if (!surfaceContext) throw new Error("لم تتوفر ذاكرة كافية لإنشاء معاينة الصورة.");
  surfaceContext.fillStyle = "#101118";
  surfaceContext.fillRect(0, 0, previewViewport.width, previewViewport.height);
  const rect = imageRect(bitmap.width, bitmap.height, previewViewport.width, previewViewport.height, fitMode);
  surfaceContext.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
  return surface;
}
async function loadImageSurface(file, requestToken) {
  const bitmap = await decodeImageBitmap(file, { isCurrent: () => imageRequest.isCurrent(requestToken) });
  try {
    if (!imageRequest.isCurrent(requestToken)) return null;
    selectedImageDimensions = { width: bitmap.width, height: bitmap.height };
    if (aspectPreset === "original") updateProject({ viewport: dimensionsForCurrentPreset() });
    const surface = drawBitmap(bitmap);
    return { surface, dimensions: selectedImageDimensions };
  } finally { bitmap.close?.(); }
}
async function refreshSelectedImage() {
  if (!selectedImageFile) return;
  const requestToken = imageRequest.begin();
  pendingImageRequest = requestToken;
  refreshExportControls();
  clearFailure();
  status.textContent = "جارٍ تجهيز الصورة للأبعاد الجديدة…";
  try {
    const prepared = await loadImageSurface(selectedImageFile, requestToken);
    if (!prepared || !imageRequest.isCurrent(requestToken)) return;
    imageSource = prepared.surface;
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

$("audioInput").addEventListener("change", async () => {
  const file = $("audioInput").files?.[0];
  if (!file) return;
  const requestToken = audioRequest.begin();
  pendingAudioRequest = requestToken;
  // Do not let an Add tap during metadata/storage work attach the previous file.
  activeAudioAssetId = null;
  $("audioFileName").textContent = file.name || "جارٍ تجهيز الملف الصوتي…";
  $("audioTimelineMessage").textContent = "جارٍ تجهيز الملف الصوتي؛ سيُفعّل زر الإضافة بعد اكتمال التحقق.";
  renderAudioInspector(); refreshExportControls();
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
    audioAssets = sequenceEditor.sequence.assets.filter(asset => asset.kind === "audio").map(assetMetadataToAudio);
    activeAudioAssetId = id;
    rebuildAudioPlayer({ resume: isPlaying });
    $("audioFileName").textContent = `${metadata.name} · ${(metadata.size / 1024 / 1024).toFixed(2)} MiB · ${(durationMs / 1000).toFixed(2)} ث`;
    $("audioTimelineMessage").textContent = `تم التحقق من الملف. مدته ${(durationMs / 1000).toFixed(2)} ثانية؛ أضفه إلى مسار عند المؤشر.`;
    renderAudioInspector();
  } catch (error) { if (audioRequest.isCurrent(requestToken)) $("audioTimelineMessage").textContent = errorText(error); }
  finally { if (pendingAudioRequest === requestToken) pendingAudioRequest = null; if (audioRequest.isCurrent(requestToken)) $("audioInput").value = ""; refreshExportControls(); }
});
$("addAudioClip").addEventListener("click", () => {
  if (activeExport) return;
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
  if (activeExport || !audioClipSelection) return;
  try {
    audioTracks = deleteAudioClip(audioTracks, project.durationMs, audioClipSelection.trackId, audioClipSelection.clipId);
    audioClipSelection = null; rebuildAudioPlayer({ resume: true }); audioTimeline.clearSelection(); renderAudioInspector(); renderAt(currentMs);
  } catch (error) { $("audioTimelineMessage").textContent = errorText(error); }
});
for (const [id, field] of [["audioClipStart", "startMs"], ["audioClipDuration", "durationMs"], ["audioClipVolume", "volume"]]) {
  $(id).addEventListener("change", () => {
    const selected = selectedAudioClip(); if (!selected || activeExport) return;
    try {
      const value = Number($(id).value);
      const next = editAudioClip(audioTracks, project.durationMs, selected.track.id, selected.clip.id, { [field]: value });
      commitAudioTracks(next); audioTimeline.select(audioClipSelection);
      $("audioTimelineMessage").textContent = "تم تحديث المقطع الصوتي.";
    } catch (error) { $("audioTimelineMessage").textContent = errorText(error); renderAudioInspector(); }
  });
}
$("dialogueLanguage").addEventListener("change", () => {
  const selected = selectedAudioClip(); if (!selected || selected.track.type !== "dialogue" || activeExport) return;
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
