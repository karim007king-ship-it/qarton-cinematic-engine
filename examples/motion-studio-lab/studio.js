import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { createRequestToken, makeProject, makeProjectFile, parseProjectFile, playbackTimeMs, VIEWPORT } from "./studio-model.js?v=l4-flex-01";
import { decodeImageBitmap } from "./studio-image.js?v=l4-flex-01";
import { DEFAULT_OUTPUT_VIEWPORT, imageRect, inferAspectPreset, projectSizeForPreset, safePreviewSize } from "./studio-dimensions.js?v=l4-flex-01";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const context = canvas.getContext("2d", { alpha: false });
const imageInput = $("imageInput");
const projectInput = $("projectInput");
const seek = $("seek");
const status = $("status");
const errorMessage = $("errorMessage");
const imageName = $("imageName");
const timeReadout = $("timeReadout");
const playPauseButton = $("playPauseButton");
const aspectSelect = $("aspectPreset");
const fitSelect = $("fitMode");
const imageRequest = createRequestToken();

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
function cameraKeys(keys, scaleX, scaleY) {
  return keys.map((key) => ({ ...key, value: { ...key.value, x: key.value.x * scaleX, y: key.value.y * scaleY } }));
}
function previewProject(sourceProject) {
  const preview = {
    ...sourceProject,
    viewport: { ...previewViewport, fps: sourceProject.viewport.fps },
    layers: sourceProject.layers.map((layer) => {
      if (!layer.track) return layer;
      return { ...layer, track: cameraKeys(layer.track, previewViewport.width / sourceProject.viewport.width, previewViewport.height / sourceProject.viewport.height) };
    })
  };
  if (sourceProject.camera) {
    preview.camera = cameraKeys(sourceProject.camera,
      previewViewport.width / sourceProject.viewport.width,
      previewViewport.height / sourceProject.viewport.height);
  }
  return preview;
}
let compiled;

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
function renderAt(timeMs) {
  currentMs = Math.max(0, Math.min(project.durationMs, timeMs));
  drawFrame(context, sampleFrame(compiled, currentMs));
  seek.value = String(currentMs);
  timeReadout.textContent = formatTime(currentMs);
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
function setCanvasDimensions() {
  previewViewport = safePreviewSize(project.viewport.width, project.viewport.height);
  canvas.width = previewViewport.width;
  canvas.height = previewViewport.height;
  canvas.style.aspectRatio = `${previewViewport.width} / ${previewViewport.height}`;
  canvas.setAttribute("aria-label", `معاينة الصورة المتحركة ${project.viewport.width} في ${project.viewport.height}`);
  if (!currentFileInfo) {
    placeholder = makePlaceholder(previewViewport);
    imageSource = placeholder;
  }
}
function updateProject({ resetPlayback = false, viewport = project.viewport } = {}) {
  clearFailure();
  try {
    const durationMs = inputNumber("duration") * 1000;
    project = makeProject({
      durationMs,
      viewport: { width: viewport.width, height: viewport.height, fps: VIEWPORT.fps },
      layers: project.layers,
      startZoom: inputNumber("startZoom"), endZoom: inputNumber("endZoom"),
      startX: inputNumber("startX"), endX: inputNumber("endX"),
      startY: inputNumber("startY"), endY: inputNumber("endY")
    });
    setCanvasDimensions();
    compiled = compileProject(previewProject(project), imageProvider);
    seek.max = String(durationMs);
    if (resetPlayback) stopPlayback();
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
  clearFailure();
  status.textContent = "جارٍ تجهيز الصورة للأبعاد الجديدة…";
  try {
    const prepared = await loadImageSurface(selectedImageFile, requestToken);
    if (!prepared || !imageRequest.isCurrent(requestToken)) return;
    imageSource = prepared.surface;
    compiled = compileProject(previewProject(project), imageProvider);
    renderAt(currentMs);
    status.textContent = "المعاينة جاهزة";
  } catch (error) {
    if (imageRequest.isCurrent(requestToken)) fail(error);
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
for (const id of ["duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY"]) {
  $(id).addEventListener("input", () => updateProject({ resetPlayback: id === "duration" }));
}

aspectSelect.addEventListener("change", () => {
  aspectPreset = aspectSelect.value;
  updateProject({ viewport: dimensionsForCurrentPreset() });
  refreshSelectedImage();
});
fitSelect.addEventListener("change", () => {
  fitMode = fitSelect.value;
  refreshSelectedImage();
});

imageInput.addEventListener("change", async () => {
  const requestToken = imageRequest.begin();
  clearFailure();
  const file = imageInput.files?.[0];
  if (!file) return;
  selectedImageFile = file;
  selectedImageDimensions = null;
  status.textContent = "جارٍ تحميل الصورة…";
  try {
    const prepared = await loadImageSurface(file, requestToken);
    if (!prepared || !imageRequest.isCurrent(requestToken)) return;
    imageSource = prepared.surface;
    currentFileInfo = { name: file.name.slice(0, 180), type: file.type, size: file.size };
    compiled = compileProject(previewProject(project), imageProvider);
    imageName.textContent = `${currentFileInfo.name} · ${prepared.dimensions.width}×${prepared.dimensions.height}`;
    renderAt(currentMs);
    status.textContent = "المعاينة جاهزة";
  } catch (error) {
    if (imageRequest.isCurrent(requestToken)) fail(error);
  }
  finally { imageInput.value = ""; }
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
  } catch (error) { fail(error); }
  finally { projectInput.value = ""; }
});

updateProject({ viewport: project.viewport });
renderAt(0);
