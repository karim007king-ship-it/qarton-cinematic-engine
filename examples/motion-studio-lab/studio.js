import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { createRequestToken, makeProject, makeProjectFile, parseProjectFile, playbackTimeMs, prepareProjectUpdate, VIEWPORT } from "./studio-model.js?v=l6b-timeline-01";
import { decodeImageBitmap } from "./studio-image.js?v=l4-flex-01";
import { DEFAULT_OUTPUT_VIEWPORT, imageRect, inferAspectPreset, projectSizeForPreset, safePreviewSize } from "./studio-dimensions.js?v=l4-flex-01";
import {
  EXPORT_PROFILES, chooseDefaultFormat, createExportLock, createRecordingSession, estimateVideoBytes,
  exportDurationMs, exportFrameCount, exportFrameTime, exportViewportFor, extensionForMime, projectForRaster, projectTimeAt,
  scheduleTestPulses, supportedCandidates
} from "./studio-export-core.js?v=l5-export-01";
import { createStudioTimeline } from "./studio-timeline.js?v=l6b-cleanup-01";

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
let currentMs = 0;
let isPlaying = false;
let playbackStartAt = 0;
let pausedAt = null;
let rafId = 0;

canvas.width = previewViewport.width;
canvas.height = previewViewport.height;
canvas.style.aspectRatio = `${previewViewport.width} / ${previewViewport.height}`;

const imageProvider = { get: (assetId) => project.layers.some((layer) => layer.assetId === assetId) ? imageSource : null };
let compiled;
let timelineEditor = null;

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
  exportButton.disabled = !available || !currentFileInfo || Boolean(activeExport) || pendingImageRequest !== null;
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
  for (const id of ["imageInput", "projectInput", "aspectPreset", "fitMode", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "saveProjectButton", "loadProjectButton"]) {
    $(id).disabled = busy;
  }
  timelineEditor?.setBusy(busy);
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
function renderExportFrame(ctx, exportCompiled, elapsedMs, exportLengthMs) {
  const projectMs = projectTimeAt(elapsedMs, exportLengthMs, exportCompiled.durationMs);
  drawFrame(ctx, sampleFrame(exportCompiled, projectMs));
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
    renderExportFrame(exportContext, exportCompiled, 0, exportLengthMs);
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
      renderExportFrame(exportContext, exportCompiled, frameMs, exportLengthMs);
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
function renderAt(timeMs) {
  currentMs = Math.max(0, Math.min(project.durationMs, timeMs));
  drawFrame(context, sampleFrame(compiled, currentMs));
  seek.value = String(currentMs);
  timeReadout.textContent = formatTime(currentMs);
  timelineEditor?.renderPlayhead();
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
  project = nextProject;
  compiled = nextCompiled;
  syncLegacyCameraInputs();
  renderAt(currentMs);
  status.textContent = currentFileInfo ? "تم تحديث حركة الكاميرا" : "الحركة جاهزة؛ اختر صورة للمعاينة";
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
    project = nextProject;
    compiled = nextCompiled;
    if (selectedWasLast && project.camera?.length) timelineEditor.selectTime(project.camera.at(-1).atMs);
    if (!currentFileInfo) placeholder = imageSource = nextImageSource;
    applyCanvasDimensions(nextPreview);
    seek.max = String(durationMs);
    if (resetPlayback) stopPlayback();
    syncLegacyCameraInputs();
    timelineEditor?.render();
    renderAt(Math.min(currentMs, durationMs));
    status.textContent = currentFileInfo ? "المعاينة جاهزة" : "اختر صورة للبدء";
    syncOutputs();
  } catch (error) { fail(error); }
}
function stopPlayback() {
  isPlaying = false;
  pausedAt = null;
  cancelAnimationFrame(rafId);
  playPauseButton.textContent = "تشغيل";
}
function playbackTick(now) {
  if (!isPlaying) return;
  const elapsed = playbackTimeMs({ startAtMs: playbackStartAt, pausedAtMs: pausedAt, durationMs: project.durationMs }, now);
  renderAt(elapsed);
  if (elapsed >= project.durationMs) {
    stopPlayback();
    return;
  }
  rafId = requestAnimationFrame(playbackTick);
}
function play() {
  if (currentMs >= project.durationMs) renderAt(0);
  pausedAt = null;
  playbackStartAt = performance.now() - currentMs;
  isPlaying = true;
  playPauseButton.textContent = "إيقاف مؤقت";
  rafId = requestAnimationFrame(playbackTick);
}
function replay() {
  stopPlayback();
  renderAt(0);
  play();
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
    pausedAt = currentMs;
    isPlaying = false;
    cancelAnimationFrame(rafId);
    playPauseButton.textContent = "متابعة";
  } else play();
});
$("replayButton").addEventListener("click", replay);
seek.addEventListener("input", () => {
  renderAt(Number(seek.value));
  if (isPlaying) playbackStartAt = performance.now() - currentMs;
  if (currentMs < project.durationMs && !isPlaying) playPauseButton.textContent = pausedAt === null ? "تشغيل" : "متابعة";
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
  seek: (atMs) => renderAt(atMs),
  syncPlaybackSeek: () => {
    if (isPlaying) playbackStartAt = performance.now() - currentMs;
    if (currentMs < project.durationMs && !isPlaying) {
      playPauseButton.textContent = pausedAt === null ? "تشغيل" : "متابعة";
    }
  },
  commitProject: commitKeyframeProject
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
    const data = JSON.stringify(makeProjectFile(project, currentFileInfo, { aspectPreset, fitMode }), null, 2);
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
  clearFailure();
  const file = projectInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 128 * 1024) throw new RangeError("ملف المشروع أكبر من الحد المسموح (128 كيلوبايت).");
    const parsed = parseProjectFile(await file.text());
    const importedImageProvider = { get: (assetId) => parsed.project.layers.some((layer) => layer.assetId === assetId) ? placeholder : null };
    compileProject(parsed.project, importedImageProvider);
    aspectPreset = parsed.settings?.aspectPreset ?? inferAspectPreset(parsed.project.viewport.width, parsed.project.viewport.height);
    fitMode = parsed.settings?.fitMode ?? "fit";
    aspectSelect.value = aspectPreset;
    fitSelect.value = fitMode;
    timelineEditor.clearSelection();
    project = parsed.project;
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
  if (exportVideoUrl) URL.revokeObjectURL(exportVideoUrl);
  exportVideoUrl = null;
});
