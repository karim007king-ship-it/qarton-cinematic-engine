import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { createRequestToken, makeProject, makeProjectFile, parseProjectFile, prepareProjectUpdate, VIEWPORT } from "./studio-model.js?v=l7b-character-01";
import { decodeImageBitmap } from "./studio-image.js?v=l4-flex-01";
import { DEFAULT_OUTPUT_VIEWPORT, imageRect, inferAspectPreset, projectSizeForPreset, safePreviewSize } from "./studio-dimensions.js?v=l4-flex-01";
import {
  EXPORT_PROFILES, chooseDefaultFormat, createExportLock, createRecordingSession, estimateVideoBytes,
  exportDurationMs, exportFrameCount, exportFrameTime, exportViewportFor, extensionForMime, projectForRaster, projectTimeAt,
  scheduleTestPulses, supportedCandidates
} from "./studio-export-core.js?v=l5-export-01";
import { createStudioTimeline } from "./studio-timeline.js?v=l6b-cleanup-01";
import { compileCharacterTrack, drawCharacter, makeCharacterTrack } from "./studio-character-track.js?v=l7b-character-01";
import { createCharacterTimeline } from "./studio-character-timeline.js?v=l7b-character-01";
import { compileAudioTracks, makeAudioTracks, addAudioClip, editAudioClip, deleteAudioClip, setAudioTrackVolume, setAudioViseme, makeAudioAssetMetadata, validateAudioFile, readAudioDuration } from "./studio-audio-model.js?v=l8b-audio-timeline-01";
import { createStudioAudioTimeline } from "./studio-audio-timeline.js?v=l8b-audio-timeline-01";
import { createCinematicAudioPlayer } from "../../src/audio/cinematic-audio-core.js";
import { addVisualEffect, deleteVisualEffect, editVisualEffect, makeVisualEffectsTrack, compileVisualEffectsTrack, sampleVisualEffects, VISUAL_EFFECT_CHANNELS, VISUAL_EFFECT_TYPES } from "./studio-visual-effects-model.js?v=l9b-effects-01";
import { createStudioVisualEffectsTimeline } from "./studio-visual-effects-timeline.js?v=l9b-effects-01";
import { drawCinematicEffects } from "../../src/effects/cinematic-effects.js";

const $ = (id) => document.getElementById(id);
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
let activeExport = null;
let exportVideoUrl = null;
let exportCapability = { mp4: [], webm: [] };
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

canvas.width = previewViewport.width;
canvas.height = previewViewport.height;
canvas.style.aspectRatio = `${previewViewport.width} / ${previewViewport.height}`;

const imageProvider = { get: (assetId) => project.layers.some((layer) => layer.assetId === assetId) ? imageSource : null };
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

function compilePreviewEffects(track, sourceProject = project, viewport = previewViewport) {
  return compileVisualEffectsTrack(track, projectForRaster(sourceProject, viewport));
}

function drawCharacterWithCamera(ctx, pose, width, height, camera) {
  ctx.save();
  try {
    ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
    ctx.rotate(camera.rotation * Math.PI / 180);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-width / 2, -height / 2);
    drawCharacter(ctx, pose, width, height);
  } finally { ctx.restore(); }
}

function drawEffectOverlays(ctx, sample) {
  drawCinematicEffects(ctx, { ...sample, camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, layers: [] });
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

const errorText = (error) => error?.message || String(error);
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
function clearExportResult() {
  exportStatusHasResult = false;
  exportError.hidden = true;
  exportError.textContent = "";
  tryWebmButton.hidden = true;
  exportVideo.pause();
  exportVideo.removeAttribute("src");
  exportVideo.load();
  exportVideo.hidden = true;
  exportDownload.hidden = true;
  exportDownload.removeAttribute("href");
  exportMetadata.textContent = "لم يُنشأ فيديو بعد.";
  exportProgress.value = 0;
  if (exportVideoUrl) URL.revokeObjectURL(exportVideoUrl);
  exportVideoUrl = null;
}
function cancelActiveExport(reason = "تغير المشروع أثناء التصدير.") {
  const running = activeExport;
  if (!running) return;
  const abortError = new DOMException(reason, "AbortError");
  running.controller.abort(abortError);
  running.session?.cancel(abortError);
  if (running.rafId) cancelAnimationFrame(running.rafId);
  if (running.stopTimer) clearTimeout(running.stopTimer);
  exportStatus.textContent = "جارٍ إيقاف التسجيل وتنظيف الموارد…";
}
function invalidateExport(reason) {
  cancelActiveExport(reason);
  clearExportResult();
  refreshExportControls();
}
function refreshExportControls() {
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
}
function setExportBusy(busy) {
  for (const id of ["imageInput", "projectInput", "audioInput", "audioTrackType", "addAudioClip", "deleteAudioClip", "audioClipStart", "audioClipDuration", "audioClipVolume", "dialogueLanguage", "visemeType", "phonemeLabel", "addViseme", "audioMasterVolume", "visualEffectType", "addVisualEffect", "deleteVisualEffect", "visualEffectStart", "visualEffectDuration", "visualEffectEasing", "aspectPreset", "fitMode", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "saveProjectButton", "loadProjectButton"]) {
    $(id).disabled = busy;
  }
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
function renderExportFrame(ctx, exportCompiled, exportCharacter, exportEffects, elapsedMs, exportLengthMs) {
  const projectMs = projectTimeAt(elapsedMs, exportLengthMs, exportCompiled.durationMs);
  const effectSample = sampleVisualEffects(exportEffects, projectMs);
  drawFrame(ctx, { ...sampleFrame(exportCompiled, projectMs), camera: effectSample.camera });
  if (characterTrack.keyframes.length) drawCharacterWithCamera(ctx, exportCharacter.sample(projectMs), exportCompiled.viewport.width, exportCompiled.viewport.height, effectSample.camera);
  drawEffectOverlays(ctx, effectSample);
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
  const running = { controller, session: null, rafId: 0, stopTimer: 0 };
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
    const exportEffects = compilePreviewEffects(visualEffectsTrack, project, rasterViewport);
    renderExportFrame(exportContext, exportCompiled, exportCharacter, exportEffects, 0, exportLengthMs);
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
      renderExportFrame(exportContext, exportCompiled, exportCharacter, exportEffects, frameMs, exportLengthMs);
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
      const detail = error?.message || String(error);
      const canTryWebm = exportFormat.value === "mp4" && exportCapability.webm.length > 0;
      exportError.textContent = canTryWebm
        ? `${detail} قد يعلن الجهاز دعم MP4 ثم يرفض بدء التسجيل؛ يمكنك تجربة WebM من الزر أدناه.`
        : detail;
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
function audioAdapterPlay(assetId, options) {
  const asset = audioFiles.get(assetId);
  if (!asset?.url) throw new Error("ملف صوت محلي غير مرتبط. أعد اختياره من الهاتف قبل التشغيل.");
  const voice = new Audio(asset.url);
  voice.preload = "auto";
  voice.loop = options.loop;
  voice.volume = Math.max(0, Math.min(1, options.volume));
  if (options.offsetMs > 0) voice.currentTime = options.offsetMs / 1000;
  const started = voice.play();
  started?.catch((error) => {
    if (audioPlayer && audioPlayer.state === "playing") {
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
  $("addAudioClip").disabled = !activeAudioAssetId || Boolean(activeExport);
}
function selectedVisualEffect() {
  return visualEffectsTrack.clips.find(({ id }) => id === visualEffectSelection) ?? null;
}
function commitVisualEffectsTrack(nextTrack, message = "تم تحديث المؤثر المرئي.") {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل المؤثرات المرئية.");
  const nextCompiled = compilePreviewEffects(nextTrack, project, previewViewport);
  visualEffectsTrack = nextTrack;
  visualEffectsCompiled = nextCompiled;
  visualEffectsTimeline?.render();
  renderVisualEffectInspector();
  renderAt(currentMs);
  $("visualEffectsMessage").textContent = message;
}
function commitVisualEffectPatch(patch) {
  const selected = selectedVisualEffect();
  if (!selected) return;
  commitVisualEffectsTrack(editVisualEffect(visualEffectsTrack, project, selected.id, patch));
  visualEffectsTimeline?.select(selected.id);
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
  const effectSample = sampleVisualEffects(visualEffectsCompiled, currentMs);
  drawFrame(context, { ...sampleFrame(compiled, currentMs), camera: effectSample.camera });
  const audioSample = preparedAudioSample ?? audioPlayer?.sample(currentMs);
  if (characterTrack.keyframes.length || audioSample?.dialogue?.length) {
    const pose = { ...characterAnimation.sample(currentMs) };
    if (audioSample?.dialogue?.length) pose.mouthOpen = Math.max(...audioSample.dialogue.map(({ mouthOpen }) => mouthOpen));
    drawCharacterWithCamera(context, pose, previewViewport.width, previewViewport.height, effectSample.camera);
  }
  drawEffectOverlays(context, effectSample);
  seek.value = String(currentMs);
  timeReadout.textContent = formatTime(currentMs);
  timelineEditor?.renderPlayhead();
  characterTimeline?.render();
  audioTimeline?.renderPlayhead();
  visualEffectsTimeline?.renderPlayhead();
}
function inputNumber(id) { return Number($(id).value); }
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
  compiled = nextCompiled;
  visualEffectsCompiled = nextEffectsCompiled;
  syncLegacyCameraInputs();
  renderAt(currentMs);
  status.textContent = currentFileInfo ? "تم تحديث حركة الكاميرا" : "الحركة جاهزة؛ اختر صورة للمعاينة";
}
function commitCharacterTrack(nextTrack) {
  if (activeExport) throw new Error("أوقف تصدير الفيديو قبل تعديل مسار الشخصية.");
  const nextAnimation = compileCharacterTrack(nextTrack, project.durationMs);
  characterTrack = nextTrack;
  characterAnimation = nextAnimation;
  renderAt(currentMs);
  status.textContent = "تم تحديث حركة الشخصية";
}
function applyCanvasDimensions(size) {
  previewViewport = size;
  canvas.width = previewViewport.width;
  canvas.height = previewViewport.height;
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
  invalidateExport("تغيّر المشروع؛ أُلغي التصدير السابق أو الجاري.");
  clearFailure();
  try {
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
    syncLegacyCameraInputs();
    timelineEditor?.render();
    refreshCharacterTimeline();
    audioTimeline?.render(); renderAudioInspector();
    visualEffectsTimeline?.render(); renderVisualEffectInspector();
    renderAt(Math.min(currentMs, durationMs));
    status.textContent = currentFileInfo ? "المعاينة جاهزة" : "اختر صورة للبدء";
    syncOutputs();
  } catch (error) { fail(error); }
}
function stopPlayback() {
  if (audioPlayer?.state === "playing") {
    try { const sampled = audioPlayer.pause(); currentMs = sampled.timeMs; }
    catch (error) { try { audioPlayer.recover(); } catch { /* Keep the last stable preview time after adapter failure. */ } $("audioTimelineMessage").textContent = `توقفت المعاينة بعد خطأ صوتي: ${errorText(error)}`; }
  }
  isPlaying = false;
  pausedAt = null;
  cancelAnimationFrame(rafId);
  playPauseButton.textContent = "تشغيل";
}
function playbackTick() {
  if (!isPlaying) return;
  let audioSample;
  try { audioSample = audioPlayer.tick(); }
  catch (error) {
    try { audioPlayer.recover(); } catch { /* Adapter cleanup failure is reported to the user below. */ }
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "متابعة"; cancelAnimationFrame(rafId);
    $("audioTimelineMessage").textContent = `تعذر تحديث مسار الصوت: ${errorText(error)}`; return;
  }
  const elapsed = audioSample.timeMs;
  renderAt(elapsed, audioSample);
  if (elapsed >= project.durationMs) {
    stopPlayback();
    return;
  }
  rafId = requestAnimationFrame(playbackTick);
}
function play() {
  if (currentMs >= project.durationMs) renderAt(0);
  try {
    const sample = audioPlayer.play();
    pausedAt = null; currentMs = sample.timeMs; isPlaying = true;
    playPauseButton.textContent = "إيقاف مؤقت";
    renderAt(currentMs, sample); rafId = requestAnimationFrame(playbackTick);
  } catch (error) {
    try { audioPlayer.recover(); } catch { /* Keep player in the recoverable paused state. */ }
    isPlaying = false; pausedAt = currentMs; playPauseButton.textContent = "متابعة";
    $("audioTimelineMessage").textContent = `تعذر تشغيل الصوت: ${errorText(error)}`;
  }
}
function replay() {
  stopPlayback();
  try { const sample = audioPlayer.replay(); renderAt(sample.timeMs, sample); isPlaying = true; pausedAt = null; playPauseButton.textContent = "إيقاف مؤقت"; rafId = requestAnimationFrame(playbackTick); }
  catch (error) { try { audioPlayer.recover(); } catch { /* Retry remains possible after resource cleanup. */ } $("audioTimelineMessage").textContent = `تعذرت إعادة التشغيل: ${errorText(error)}`; }
}
function seekTo(timeMs) {
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
function dimensionsForCurrentPreset() {
  const size = projectSizeForPreset(aspectPreset, selectedImageDimensions?.width, selectedImageDimensions?.height);
  return { ...size, fps: VIEWPORT.fps };
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
  if (isPlaying) {
    try { const sampled = audioPlayer.pause(); pausedAt = sampled.timeMs; renderAt(sampled.timeMs, sampled); }
    catch (error) { try { audioPlayer.recover(); } catch { /* Keep audio resources in the paused recovery state. */ } pausedAt = currentMs; $("audioTimelineMessage").textContent = `تعذر إيقاف الصوت بأمان: ${errorText(error)}`; }
    isPlaying = false;
    cancelAnimationFrame(rafId);
    playPauseButton.textContent = "متابعة";
  } else play();
});
$("replayButton").addEventListener("click", replay);
seek.addEventListener("input", () => {
  seekTo(Number(seek.value));
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
  onMove: (id, atMs) => commitVisualEffectsTrack(moveVisualEffect(visualEffectsTrack, project, id, atMs), "تم نقل المؤثر على المسار."),
  onSeek: (atMs) => seekTo(atMs),
  onDragEnd: ({ cancelled }) => { if (cancelled) $("visualEffectsMessage").textContent = "أُلغي السحب؛ حُفظ آخر توقيت صالح للمؤثر."; }
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
    try { commitVisualEffectPatch({ [field]: field === "easing" ? $(id).value : Number($(id).value) }); }
    catch (error) { $("visualEffectsMessage").textContent = errorText(error); renderVisualEffectInspector(); }
  });
}
for (const source of ["visualEffectFrom", "visualEffectTo"]) {
  $(source).addEventListener("change", event => {
    const input = event.target.closest?.("[data-effect-field]");
    if (!input || !selectedVisualEffect() || activeExport) return;
    try {
      const channel = VISUAL_EFFECT_CHANNELS[selectedVisualEffect().type].find(({ key }) => key === input.dataset.effectField);
      if (!channel) throw new TypeError("قناة المؤثر غير معروفة.");
      commitVisualEffectPatch({ [input.dataset.effectSource]: { [channel.key]: channel.kind === "color" ? input.value : Number(input.value) } });
    } catch (error) { $("visualEffectsMessage").textContent = errorText(error); renderVisualEffectInspector(); }
  });
}
function renderCharacterRuler() {
  const ruler = $("characterTimelineRuler"); ruler.replaceChildren();
  for (let i = 0; i <= 4; i++) { const label = document.createElement("span"); label.textContent = formatTime(Math.round(project.durationMs * i / 4)); ruler.append(label); }
}
const renderCharacterTimeline = characterTimeline.render.bind(characterTimeline);
function refreshCharacterTimeline() { renderCharacterRuler(); renderCharacterTimeline(); }
$("audioInput").addEventListener("change", async () => {
  const file = $("audioInput").files?.[0];
  if (!file) return;
  const requestToken = audioRequest.begin();
  pendingAudioRequest = requestToken; refreshExportControls();
  try {
    const metadata = validateAudioFile(file);
    $("audioTimelineMessage").textContent = "جارٍ التحقق من فك ترميز الصوت وقراءة مدته…";
    const durationMs = await readAudioDuration(file);
    if (!audioRequest.isCurrent(requestToken)) return;
    const known = audioAssets.find((asset) => asset.name === metadata.name && asset.type === metadata.mime && asset.size === metadata.size);
    const id = known?.id ?? `audio-asset-${Date.now()}-${++audioAssetSerial}`;
    const url = URL.createObjectURL(file);
    const previous = audioFiles.get(id);
    if (previous?.url) URL.revokeObjectURL(previous.url);
    audioFiles.set(id, { file, url, durationMs });
    if (!known) audioAssets = [...audioAssets, makeAudioAssetMetadata(id, file)];
    activeAudioAssetId = id;
    rebuildAudioPlayer({ resume: isPlaying });
    $("audioFileName").textContent = `${metadata.name} · ${(metadata.size / 1024 / 1024).toFixed(2)} MiB · ${(durationMs / 1000).toFixed(2)} ث`;
    $("audioTimelineMessage").textContent = `تم التحقق من الملف. مدته ${(durationMs / 1000).toFixed(2)} ثانية؛ أضفه إلى مسار عند المؤشر.`;
    renderAudioInspector();
  } catch (error) { if (audioRequest.isCurrent(requestToken)) $("audioTimelineMessage").textContent = errorText(error); }
  finally { if (pendingAudioRequest === requestToken) pendingAudioRequest = null; if (audioRequest.isCurrent(requestToken)) $("audioInput").value = ""; refreshExportControls(); }
});
$("addAudioClip").addEventListener("click", () => {
  if (activeExport || !activeAudioAssetId) return;
  try {
    const trackType = $("audioTrackType").value;
    const track = audioTracks.find((item) => item.type === trackType);
    if (!track) throw new Error("المسار الصوتي المحدد غير موجود.");
    const startMs = Math.min(currentMs, project.durationMs - 1);
    const metadata = audioAssets.find(({ id }) => id === activeAudioAssetId);
    const source = audioFiles.get(activeAudioAssetId);
    const durationMs = Math.min(source?.durationMs ?? 1000, project.durationMs - startMs);
    const clip = { id: `audio-clip-${Date.now()}-${++audioAssetSerial}`, asset: activeAudioAssetId, name: metadata?.name, startMs, durationMs, volume: 1,
      ...(trackType === "dialogue" ? { language: $("dialogueLanguage").value, visemes: [] } : {}) };
    const next = addAudioClip(audioTracks, project.durationMs, track.id, clip);
    audioClipSelection = { trackId: track.id, clipId: clip.id };
    commitAudioTracks(next);
    audioTimeline.select(audioClipSelection);
    $("audioTimelineMessage").textContent = `أُضيف المقطع عند ${formatTime(startMs)}.`;
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
  updateProject({ viewport: dimensionsForCurrentPreset() });
  refreshSelectedImage();
});
fitSelect.addEventListener("change", () => {
  invalidateExport("تغيّرت طريقة عرض الصورة.");
  fitMode = fitSelect.value;
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
    const prepared = await loadImageSurface(file, requestToken);
    if (!prepared || !imageRequest.isCurrent(requestToken)) return;
    imageSource = prepared.surface;
    currentFileInfo = { name: file.name.slice(0, 180), type: file.type, size: file.size };
    compiled = compileProject(projectForRaster(project, previewViewport), imageProvider);
    imageName.textContent = `${currentFileInfo.name} · ${prepared.dimensions.width}×${prepared.dimensions.height}`;
    renderAt(currentMs);
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

$("saveProjectButton").addEventListener("click", () => {
  clearFailure();
  try {
    const data = JSON.stringify(makeProjectFile(project, currentFileInfo, { aspectPreset, fitMode }, characterTrack, audioTracks, audioAssets, audioMasterVolume, visualEffectsTrack), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "qarton-motion-project.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "تم تجهيز ملف المشروع JSON";
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
    if (file.size > 128 * 1024) throw new RangeError("ملف المشروع أكبر من الحد المسموح (128 كيلوبايت).");
    const parsed = parseProjectFile(await file.text());
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
    refreshExportControls();
  } catch (error) { fail(error); }
  finally { projectInput.value = ""; }
});

updateProject({ viewport: project.viewport });
timelineEditor.render();
refreshCharacterTimeline();
renderAt(0);
refreshExportControls();
exportButton.addEventListener("click", () => { void exportVideoFile(); });
cancelExportButton.addEventListener("click", () => cancelActiveExport("ألغى المستخدم التسجيل."));
tryWebmButton.addEventListener("click", () => {
  exportFormat.value = "webm";
  exportFormat.dispatchEvent(new Event("change", { bubbles: true }));
});
for (const control of [exportFormat, exportDuration, exportQuality, exportAudioEnabled]) {
  control.addEventListener("change", () => {
    clearExportResult();
    refreshExportControls();
  });
}
window.addEventListener("pagehide", () => {
  cancelActiveExport("غادرت الصفحة أثناء التصدير.");
  audioRequest.begin();
  try { audioPlayer?.destroy(); } catch { /* Browser is unloading; all local playback handles are being discarded. */ }
  for (const { url } of audioFiles.values()) if (url) URL.revokeObjectURL(url);
  audioFiles.clear();
  if (exportVideoUrl) URL.revokeObjectURL(exportVideoUrl);
  exportVideoUrl = null;
});
