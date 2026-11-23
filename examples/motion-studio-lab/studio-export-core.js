import { extensionForMime, measuredDurationMs, mimeCandidates, supportedCandidates } from "../motion-studio-export-lab/export-lab-core.js";

export { extensionForMime, measuredDurationMs, mimeCandidates, supportedCandidates };

export const EXPORT_PROFILES = Object.freeze({
  economy: Object.freeze({ label: "اقتصادي · 700 kb/s", maxEdge: 640, maxPixels: 307_200, videoBitsPerSecond: 700_000 }),
  standard: Object.freeze({ label: "متوازن · 1.5 Mb/s", maxEdge: 1280, maxPixels: 921_600, videoBitsPerSecond: 1_500_000 }),
  high: Object.freeze({ label: "جودة أعلى · 2.5 Mb/s", maxEdge: 1280, maxPixels: 921_600, videoBitsPerSecond: 2_500_000 })
});

export function chooseDefaultFormat(MediaRecorderClass) {
  if (supportedCandidates(MediaRecorderClass, "mp4").length) return "mp4";
  if (supportedCandidates(MediaRecorderClass, "webm").length) return "webm";
  return null;
}

export function exportViewportFor(viewport, quality = "standard") {
  const profile = EXPORT_PROFILES[quality];
  if (!profile || !Number.isSafeInteger(viewport?.width) || !Number.isSafeInteger(viewport?.height) ||
      viewport.width < 1 || viewport.height < 1) throw new RangeError("إعداد جودة أو أبعاد التصدير غير صالح.");
  const scale = Math.min(1, profile.maxEdge / Math.max(viewport.width, viewport.height),
    Math.sqrt(profile.maxPixels / (viewport.width * viewport.height)));
  return { width: Math.max(1, Math.floor(viewport.width * scale)), height: Math.max(1, Math.floor(viewport.height * scale)), fps: viewport.fps };
}

function scaleKeys(keys, scaleX, scaleY) {
  return keys.map((key) => ({ ...key, value: { ...key.value, x: key.value.x * scaleX, y: key.value.y * scaleY } }));
}

/** Scale camera translations only; timeline sampling and rendering stay in the Motion Studio core. */
export function projectForRaster(project, rasterViewport) {
  if (!project?.viewport || !Number.isSafeInteger(rasterViewport?.width) || !Number.isSafeInteger(rasterViewport?.height) ||
      rasterViewport.width < 1 || rasterViewport.height < 1) throw new TypeError("Project raster viewport is invalid.");
  const scaleX = rasterViewport.width / project.viewport.width;
  const scaleY = rasterViewport.height / project.viewport.height;
  const rasterProject = {
    ...project,
    viewport: { ...rasterViewport, fps: project.viewport.fps },
    layers: project.layers.map((layer) => layer.track ? { ...layer, track: scaleKeys(layer.track, scaleX, scaleY) } : layer)
  };
  if (project.camera) rasterProject.camera = scaleKeys(project.camera, scaleX, scaleY);
  return rasterProject;
}

export function exportDurationMs(selection, projectDurationMs) {
  if (!Number.isInteger(projectDurationMs) || projectDurationMs < 1) throw new RangeError("مدة المشروع غير صالحة.");
  if (selection === "project") return projectDurationMs;
  const duration = Number(selection);
  if (![3000, 10000, 30000, 60000].includes(duration)) throw new RangeError("مدة التصدير غير مدعومة.");
  return duration;
}

export function projectTimeAt(exportElapsedMs, exportDuration, projectDuration) {
  if (![exportElapsedMs, exportDuration, projectDuration].every(Number.isFinite) || exportDuration <= 0 || projectDuration <= 0) {
    throw new RangeError("تعذر مطابقة توقيت التصدير بالمشروع.");
  }
  const fraction = Math.max(0, Math.min(1, exportElapsedMs / exportDuration));
  return Math.round(fraction * projectDuration);
}

export function estimateVideoBytes(durationMs, videoBitsPerSecond) {
  if (![durationMs, videoBitsPerSecond].every(Number.isFinite) || durationMs <= 0 || videoBitsPerSecond <= 0) {
    throw new RangeError("تعذر تقدير حجم الفيديو.");
  }
  return Math.ceil(durationMs * videoBitsPerSecond / 8000);
}

export function createExportLock() {
  let held = false;
  return Object.freeze({
    get held() { return held; },
    acquire() {
      if (held) return null;
      held = true;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          held = false;
        }
      };
    }
  });
}

export function createRecordingSession({
  stream,
  mimeType,
  videoBitsPerSecond,
  durationMs,
  maxBytes = 24 * 1024 * 1024,
  MediaRecorderClass = globalThis.MediaRecorder,
  signal,
  now = () => globalThis.performance.now(),
  schedule = globalThis.setTimeout,
  unschedule = globalThis.clearTimeout,
  BlobClass = globalThis.Blob
}) {
  if (!stream || !Number.isInteger(durationMs) || durationMs < 1 || typeof MediaRecorderClass !== "function") {
    throw new TypeError("Recorder session configuration is invalid.");
  }
  const recorderOptions = { mimeType };
  if (Number.isFinite(videoBitsPerSecond)) recorderOptions.videoBitsPerSecond = videoBitsPerSecond;
  const recorder = new MediaRecorderClass(stream, recorderOptions);
  const chunks = [];
  let chunkBytes = 0;
  let timer = null;
  let startedAt = NaN;
  let settled = false;
  let cancelError = null;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });

  const remove = (type, listener) => recorder.removeEventListener?.(type, listener);
  const cleanup = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
    signal?.removeEventListener("abort", onAbort);
    remove("dataavailable", onData);
    remove("error", onError);
    remove("stop", onStop);
  };
  const settleError = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };
  const onData = (event) => {
    if (!event.data?.size) return;
    chunkBytes += event.data.size;
    if (chunkBytes > maxBytes) {
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* report the size limit */ }
      settleError(new RangeError("تجاوز الفيديو حد الحجم الآمن 24 ميغابايت؛ قلل المدة أو الجودة."));
      return;
    }
    chunks.push(event.data);
  };
  const onError = (event) => {
    const error = event.error || new Error("MediaRecorder عطّل التسجيل.");
    try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* the original recording error is clearer */ }
    settleError(error);
  };
  const onStop = () => {
    if (settled) return;
    if (cancelError) return settleError(cancelError);
    const actualMimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || mimeType;
    const blob = new BlobClass(chunks, { type: actualMimeType });
    if (!blob.size) return settleError(new Error("انتهى التسجيل لكن ملف الفيديو فارغ."));
    settled = true;
    cleanup();
    resolvePromise({ blob, mimeType: actualMimeType, durationMs: measuredDurationMs(startedAt, now()), recorder });
  };
  const onAbort = () => cancel(signal.reason || new DOMException("تم إلغاء التسجيل.", "AbortError"));
  recorder.addEventListener("dataavailable", onData);
  recorder.addEventListener("error", onError, { once: true });
  recorder.addEventListener("stop", onStop, { once: true });
  signal?.addEventListener("abort", onAbort, { once: true });

  function stop() {
    if (settled) return;
    if (recorder.state === "inactive") return onStop();
    try { recorder.stop(); }
    catch (error) { settleError(error); }
  }
  function cancel(reason = "تم إلغاء التسجيل.") {
    if (settled) return;
    cancelError = reason instanceof Error ? reason : new DOMException(String(reason), "AbortError");
    try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* cancellation still settles and releases resources */ }
    settleError(cancelError);
  }

  if (signal?.aborted) {
    cancel(signal.reason);
  } else {
    try {
      recorder.start(250);
      startedAt = now();
      timer = schedule(stop, durationMs);
    } catch (error) { settleError(error); }
  }
  return Object.freeze({ recorder, promise, stop, cancel, get startedAt() { return startedAt; } });
}

export function scheduleTestPulses(audio, gain, durationMs, leadSeconds = 0.08) {
  if (!audio || !gain || !Number.isFinite(durationMs) || durationMs <= 0) throw new TypeError("Audio test pulse inputs are invalid.");
  const startAt = audio.currentTime + leadSeconds;
  const scheduledAt = [];
  for (let offset = 0.25; offset < durationMs / 1000; offset += 1) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const at = startAt + offset;
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.7, at + 0.012);
    envelope.gain.setValueAtTime(0.7, at + 0.06);
    envelope.gain.linearRampToValueAtTime(0, at + 0.11);
    oscillator.connect(envelope);
    envelope.connect(gain);
    oscillator.start(at);
    oscillator.stop(at + 0.12);
    scheduledAt.push(at);
  }
  return scheduledAt;
}
