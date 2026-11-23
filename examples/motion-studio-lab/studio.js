import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { createRequestToken, makeProject, makeProjectFile, parseProjectFile, playbackTimeMs, VIEWPORT } from "./studio-model.js";
import { decodeImageBitmap } from "./studio-image.js";

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
const imageRequest = createRequestToken();
const placeholder = document.createElement("canvas");
placeholder.width = VIEWPORT.width;
placeholder.height = VIEWPORT.height;
const placeholderContext = placeholder.getContext("2d");
placeholderContext.fillStyle = "#171820";
placeholderContext.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);
placeholderContext.fillStyle = "#e7bd69";
placeholderContext.textAlign = "center";
placeholderContext.font = "bold 38px system-ui, sans-serif";
placeholderContext.fillText("اختر صورة للبدء", VIEWPORT.width / 2, VIEWPORT.height / 2);

let imageSource = placeholder;
let currentFileInfo = null;
let project = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.25, startX: 0, endX: 0, startY: 0, endY: 0 });
const imageProvider = { get: (assetId) => project.layers.some((layer) => layer.assetId === assetId) ? imageSource : null };
let compiled = compileProject(project, imageProvider);
let currentMs = 0;
let isPlaying = false;
let playbackStartAt = 0;
let pausedAt = null;
let rafId = 0;

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
}
function updateProject({ resetPlayback = false } = {}) {
  clearFailure();
  try {
    const durationMs = inputNumber("duration") * 1000;
    project = makeProject({
      durationMs,
      layers: project.layers,
      startZoom: inputNumber("startZoom"), endZoom: inputNumber("endZoom"),
      startX: inputNumber("startX"), endX: inputNumber("endX"),
      startY: inputNumber("startY"), endY: inputNumber("endY")
    });
    compiled = compileProject(project, imageProvider);
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

async function decodeFile(file, requestToken) {
  const bitmap = await decodeImageBitmap(file, {
    isCurrent: () => imageRequest.isCurrent(requestToken)
  });
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const surface = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(VIEWPORT.width, VIEWPORT.height)
      : Object.assign(document.createElement("canvas"), { width: VIEWPORT.width, height: VIEWPORT.height });
    const surfaceContext = surface.getContext("2d", { alpha: false });
    if (!surfaceContext) throw new Error("لم تتوفر ذاكرة كافية لإنشاء صورة المعاينة.");
    const scale = Math.max(VIEWPORT.width / width, VIEWPORT.height / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    surfaceContext.fillStyle = "#101118";
    surfaceContext.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);
    surfaceContext.drawImage(bitmap, (VIEWPORT.width - drawWidth) / 2, (VIEWPORT.height - drawHeight) / 2, drawWidth, drawHeight);
    return surface;
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new Error("تعذر تجهيز المعاينة؛ قد لا تكفي ذاكرة الجهاز لهذه الصورة.");
  } finally { bitmap.close?.(); }
}

imageInput.addEventListener("change", async () => {
  const requestToken = imageRequest.begin();
  clearFailure();
  const file = imageInput.files?.[0];
  if (!file) return;
  status.textContent = "جارٍ تحميل الصورة…";
  try {
    const prepared = await decodeFile(file, requestToken);
    if (!imageRequest.isCurrent(requestToken)) {
      prepared.width = 0;
      prepared.height = 0;
      return;
    }
    imageSource = prepared;
    currentFileInfo = { name: file.name.slice(0, 180), type: file.type, size: file.size };
    compiled = compileProject(project, imageProvider);
    imageName.textContent = `${currentFileInfo.name} · ${prepared.width}×${prepared.height}`;
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
    const data = JSON.stringify(makeProjectFile(project, currentFileInfo), null, 2);
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
    const importedImageProvider = {
      get: (assetId) => parsed.project.layers.some((layer) => layer.assetId === assetId) ? placeholder : null
    };
    compileProject(parsed.project, importedImageProvider);
    project = parsed.project;
    currentFileInfo = null;
    imageSource = placeholder;
    compiled = compileProject(project, imageProvider);
    const start = project.camera?.[0]?.value;
    const end = project.camera?.at(-1)?.value;
    $("duration").value = String(project.durationMs / 1000);
    if (start && end) {
      for (const [id, value] of [["startZoom", start.zoom], ["endZoom", end.zoom], ["startX", start.x], ["endX", end.x], ["startY", start.y], ["endY", end.y]]) $(id).value = String(value);
    }
    imageName.textContent = parsed.image?.name ? `أعد اختيار الصورة: ${parsed.image.name}` : "اختر الصورة من جديد لعرض المعاينة";
    stopPlayback();
    seek.max = String(project.durationMs);
    renderAt(0);
    syncOutputs();
    status.textContent = "فُتح المشروع؛ اختر الصورة المرتبطة به";
  } catch (error) { fail(error); }
  finally { projectInput.value = ""; }
});

syncOutputs();
renderAt(0);
