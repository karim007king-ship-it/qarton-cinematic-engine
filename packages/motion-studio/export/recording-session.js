import { ExportError } from "./export-plan.js";
import { prepareAudioMix } from "./audio-mix.js";

const MIME_CANDIDATES = Object.freeze({
  mp4: Object.freeze(["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4"]),
  webm: Object.freeze(["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8", "video/webm"])
});
const activeHosts = new WeakSet();

function error(code, message, cause) {
  const result = new ExportError(code, message);
  if (cause !== undefined) result.cause = cause;
  return result;
}
function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The export was cancelled", "AbortError");
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(signal); }
function awaitWork(work, timeoutMs, message, { signal, code = "CAPTURE_FAILED" } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    const settle = callback => value => { cleanup(); callback(value); };
    const aborted = () => settle(reject)(abortError(signal));
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    timer = globalThis.setTimeout(() => settle(reject)(error(code, message)), timeoutMs);
    Promise.resolve(work).then(settle(resolve), settle(reject));
  });
}
function recorderCtor(host) { return host.MediaRecorderClass ?? globalThis.MediaRecorder; }
function mediaStreamCtor(host) { return host.MediaStreamClass ?? globalThis.MediaStream; }
function dom(host) { return host.document ?? globalThis.document; }
function mimeMatches(actual, expected) {
  return typeof actual === "string" && actual.toLowerCase().split(";")[0] === expected.toLowerCase().split(";")[0];
}
function finiteMediaDuration(video) {
  return Number.isFinite(video?.duration) && video.duration > 0 ? video.duration * 1000 : null;
}
function seekableMediaDuration(video) {
  try {
    const ranges = video?.seekable;
    if (!ranges?.length) return null;
    const end = ranges.end(ranges.length - 1);
    return Number.isFinite(end) && end > 0 ? end * 1000 : null;
  } catch { return null; }
}
function durationToleranceMs(fps) {
  // Allow at most 150 ms or one output frame for Android encoder/container
  // timestamp quantization. The check remains strict enough to reject drift
  // such as a delayed MediaRecorder start being added to the requested length.
  return Math.max(150, 1000 / fps);
}
function waitForEvent(target, name, { signal, timeoutMs = 5000, errorNames = [] } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      target.removeEventListener(name, done);
      for (const eventName of errorNames) target.removeEventListener(eventName, failed);
      signal?.removeEventListener("abort", aborted);
      if (timer !== undefined) (globalThis.clearTimeout)(timer);
    };
    const done = event => { cleanup(); resolve(event); };
    const failed = event => { cleanup(); reject(event.error ?? error("CAPTURE_FAILED", `${event.type} during recording`)); };
    const aborted = () => { cleanup(); reject(abortError(signal)); };
    target.addEventListener(name, done, { once: true });
    for (const eventName of errorNames) target.addEventListener(eventName, failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    timer = globalThis.setTimeout(() => { cleanup(); reject(error("CLOCK_STALLED", `Timed out waiting for recorder ${name}`)); }, timeoutMs);
  });
}

function createCanvas(host, width, height) {
  const canvas = host.createCanvas?.(width, height) ?? dom(host)?.createElement?.("canvas");
  if (!canvas || typeof canvas.captureStream !== "function") throw error("CAPTURE_FAILED", "Host could not create a Canvas capture source");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext?.("2d", { alpha: false, desynchronized: true });
  if (!context) throw error("CAPTURE_FAILED", "Export Canvas has no 2D rendering context");
  return { canvas, context };
}

function composeStream(host, videoStream, audioStream) {
  if (!audioStream) return videoStream;
  const Stream = mediaStreamCtor(host);
  if (typeof Stream !== "function") throw error("CAPTURE_FAILED", "MediaStream is unavailable for audio/video composition");
  return new Stream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
}

function requestFrame(videoStream) {
  const track = videoStream.getVideoTracks?.()[0];
  try { track?.requestFrame?.(); } catch {}
}

async function inspectOutput(blob, plan, host, stream) {
  if (!(blob instanceof Blob) || blob.size === 0) throw error("INVALID_OUTPUT", "Recorder returned an empty export");
  if (blob.size > plan.outputBudgetBytes) throw error("BUDGET_EXCEEDED", "Recorded file exceeded the output memory budget");
  const actualMime = blob.type || plan.mimeType;
  if (!mimeMatches(actualMime, plan.mimeType)) throw error("INVALID_OUTPUT", `Recorder output MIME ${actualMime} does not match the selected ${plan.mimeType}`);
  const audioTracks = stream?.getAudioTracks?.() ?? [];
  if (plan.audio === "mix" && (!audioTracks.length || audioTracks.some(track => track.readyState === "ended"))) {
    throw error("INVALID_OUTPUT", "The mixed audio track was not active in the recorder stream");
  }
  const document = dom(host);
  const URLApi = host.URL ?? globalThis.URL;
  if (!document?.createElement || !URLApi?.createObjectURL) return { actualMime, measuredDurationMs: null, warnings: ["Output metadata could not be measured in this host"] };
  const url = URLApi.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    const metadata = new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(error("INVALID_OUTPUT", "Timed out reading recorded video metadata")), 5000);
      video.addEventListener("loadedmetadata", () => { globalThis.clearTimeout(timeout); resolve(); }, { once: true });
      video.addEventListener("error", () => { globalThis.clearTimeout(timeout); reject(error("INVALID_OUTPUT", "Recorded video metadata could not be decoded")); }, { once: true });
    });
    video.src = url;
    await metadata;
    if ((video.duration !== Infinity && finiteMediaDuration(video) === null) || video.videoWidth < 1 || video.videoHeight < 1) {
      throw error("INVALID_OUTPUT", "Recorded video has invalid dimensions or duration");
    }
    const durationMs = finiteMediaDuration(video) ?? seekableMediaDuration(video);
    const warnings = [];
    if (plan.audio === "mix" && video.audioTracks === undefined) {
      warnings.push("This browser does not expose encoded audio-track inspection; the active mixed track was sent to the recorder.");
    } else if (plan.audio === "mix" && video.audioTracks.length === 0) {
      throw error("INVALID_OUTPUT", "Recorded media has no encoded audio track");
    }
    if (durationMs === null) {
      if (video.duration !== Infinity) throw error("INVALID_OUTPUT", "Recorded video has no usable duration metadata");
      warnings.push("Container duration and end seek are unavailable in this browser; file duration could not be measured.");
    } else if (Math.abs(durationMs - plan.durationMs) > durationToleranceMs(plan.fps)) {
      throw error("INVALID_OUTPUT", `Recorded duration ${durationMs.toFixed(0)}ms differs from the ${plan.durationMs}ms target`);
    }
    const seekTarget = durationMs === null ? 0 : Math.max(0, durationMs / 1000 - 0.05);
    if (seekTarget > 0) {
      const seek = new Promise((resolve, reject) => {
        const timeout = globalThis.setTimeout(() => reject(error("INVALID_OUTPUT", "Recorded video is not seekable near its end")), 2000);
        video.addEventListener("seeked", () => { globalThis.clearTimeout(timeout); resolve(); }, { once: true });
        video.addEventListener("error", () => { globalThis.clearTimeout(timeout); reject(error("INVALID_OUTPUT", "Recorded video seek failed")); }, { once: true });
      });
      video.currentTime = seekTarget;
      await seek;
    }
    return { actualMime, measuredDurationMs: durationMs, warnings };
  } finally {
    video.removeAttribute?.("src");
    video.load?.();
    URLApi.revokeObjectURL(url);
  }
}

async function probeOne({ canvas, width, height, fps, audioMode, mimeType, MediaRecorderClass, AudioContextClass, MediaStreamClass, document, durationMs, timeoutMs }) {
  let videoStream;
  let stream;
  let audioContext;
  let oscillator;
  let recorder;
  let interval;
  const chunks = [];
  try {
    if (typeof MediaRecorderClass !== "function" || !MediaRecorderClass.isTypeSupported?.(mimeType)) throw error("UNSUPPORTED_FORMAT", "MIME is not advertised by MediaRecorder");
    const context = canvas.getContext("2d");
    if (!context) throw error("CAPTURE_FAILED", "Probe Canvas has no 2D context");
    videoStream = canvas.captureStream(fps);
    context.fillStyle = "#213";
    context.fillRect(0, 0, width, height);
    try { videoStream.getVideoTracks()[0]?.requestFrame?.(); } catch {}
    let audioStream = null;
    if (audioMode === "mix") {
      if (typeof AudioContextClass !== "function") throw error("UNSUPPORTED_FORMAT", "Web Audio is unavailable");
      audioContext = new AudioContextClass();
      await awaitWork(audioContext.resume?.(), timeoutMs, "Probe AudioContext did not resume in time");
      if (audioContext.state !== "running") throw error("CAPTURE_FAILED", "Probe AudioContext did not start");
      const destination = audioContext.createMediaStreamDestination();
      oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 440;
      const gain = audioContext.createGain();
      gain.gain.value = 0.02;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      audioStream = destination.stream;
    }
    const Stream = MediaStreamClass ?? globalThis.MediaStream;
    if (audioStream && typeof Stream !== "function") throw error("CAPTURE_FAILED", "MediaStream is unavailable for the probe");
    stream = audioStream ? new Stream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]) : videoStream;
    recorder = new MediaRecorderClass(stream, { mimeType });
    recorder.addEventListener("dataavailable", event => { if (event.data?.size) chunks.push(event.data); });
    // Some Chromium builds do not dispatch MediaRecorder's start event until
    // the composed stream has produced its first video frame. Keep the probe
    // source live before start so capability detection tests the actual stream
    // rather than timing out on a static Canvas.
    let frame = 0;
    interval = globalThis.setInterval(() => {
      frame++;
      context.fillStyle = frame % 2 ? "#213" : "#c42";
      context.fillRect(0, 0, width, height);
      try { videoStream.getVideoTracks()[0]?.requestFrame?.(); } catch {}
    }, Math.max(16, 1000 / fps));
    const started = waitForEvent(recorder, "start", { timeoutMs, errorNames: ["error"] });
    recorder.start(100);
    await started;
    await new Promise(resolve => globalThis.setTimeout(resolve, durationMs));
    const stoppedPromise = waitForEvent(recorder, "stop", { timeoutMs, errorNames: ["error"] });
    recorder.stop();
    await stoppedPromise;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    if (blob.size === 0 || !mimeMatches(blob.type, mimeType)) throw error("INVALID_OUTPUT", "Probe recorder produced no valid output");
    const URLApi = globalThis.URL;
    if (!document?.createElement || !URLApi?.createObjectURL) throw error("UNSUPPORTED_FORMAT", "Probe host cannot decode recorded output");
    const url = URLApi.createObjectURL(blob);
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      const decoded = new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => reject(error("INVALID_OUTPUT", "Probe video decode timed out")), timeoutMs);
        video.addEventListener("loadedmetadata", () => { globalThis.clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener("error", () => { globalThis.clearTimeout(timer); reject(error("INVALID_OUTPUT", "Probe video decode failed")); }, { once: true });
      });
      video.src = url;
      await decoded;
      const measuredDurationMs = finiteMediaDuration(video) ?? seekableMediaDuration(video);
      if (video.videoWidth !== width || video.videoHeight !== height ||
          (video.duration !== Infinity && measuredDurationMs === null)) {
        const measuredDuration = Number.isFinite(video.duration) ? `${video.duration.toFixed(3)}s` : String(video.duration);
        throw error("INVALID_OUTPUT", `Probe output measured ${video.videoWidth}×${video.videoHeight}, ${measuredDuration}; expected ${width}×${height} and valid duration metadata`);
      }
      if (measuredDurationMs !== null && Math.abs(measuredDurationMs - durationMs) > durationToleranceMs(fps)) {
        throw error("INVALID_OUTPUT", `Probe output duration ${measuredDurationMs.toFixed(0)}ms differs from the ${durationMs}ms probe window`);
      }
      if (measuredDurationMs !== null && measuredDurationMs > 50) {
        const seek = new Promise((resolve, reject) => {
          const timer = globalThis.setTimeout(() => reject(error("INVALID_OUTPUT", "Probe output cannot seek near its end")), timeoutMs);
          video.addEventListener("seeked", () => { globalThis.clearTimeout(timer); resolve(); }, { once: true });
          video.addEventListener("error", () => { globalThis.clearTimeout(timer); reject(error("INVALID_OUTPUT", "Probe output seek failed")); }, { once: true });
        });
        video.currentTime = Math.max(0, measuredDurationMs / 1000 - 0.02);
        await seek;
      }
      const routedAudioTracks = stream?.getAudioTracks?.() ?? [];
      if (audioMode === "mix" && (!routedAudioTracks.length || routedAudioTracks.some(track => track.readyState === "ended"))) {
        throw error("INVALID_OUTPUT", "Probe mixed audio track was not active in the recorder stream");
      }
      if (audioMode === "mix" && Array.isArray(video.audioTracks) && video.audioTracks.length === 0) {
        throw error("INVALID_OUTPUT", "Probe output has no encoded audio track");
      }
      return Object.freeze({ verification: "verified", mimeType: recorder.mimeType || mimeType, width, height, fps, audioMode,
        audioTrackRoute: audioMode === "mix" ? "verified" : "none",
        durationMetadata: measuredDurationMs === null ? "unavailable" : "verified" });
    } finally { URLApi.revokeObjectURL(url); }
  } finally {
    if (interval !== undefined) globalThis.clearInterval(interval);
    try { if (recorder?.state === "recording") recorder.stop(); } catch {}
    try { oscillator?.stop(); } catch {}
    for (const track of new Set([...(stream?.getTracks?.() ?? []), ...(videoStream?.getTracks?.() ?? [])])) { try { track.stop(); } catch {} }
    try { await awaitWork(audioContext?.close?.(), Math.min(timeoutMs, 1000), "Probe AudioContext cleanup timed out"); } catch {}
  }
}

/** Exercise real Canvas, MediaRecorder, and (when requested) Web Audio capture for one exact profile. */
export async function probeExport(options = {}) {
  const { width, height, fps = 24, audioMode = "mix", formats = ["mp4", "webm"], durationMs = 800,
    timeoutMs = 5000 } = options;
  for (const [label, value, min, max] of [["width", width, 2, 4096], ["height", height, 2, 4096], ["fps", fps, 1, 60], ["durationMs", durationMs, 200, 2000]]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  if (width * height > 8_388_608) throw new RangeError("Probe dimensions exceed the Canvas pixel budget");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) throw new RangeError("timeoutMs must be in [1000, 30000]");
  if (!Array.isArray(formats) || formats.some(format => !Object.hasOwn(MIME_CANDIDATES, format))) throw new TypeError("formats must contain mp4 and/or webm");
  if (audioMode !== "mix" && audioMode !== "none") throw new TypeError("audioMode must be mix or none");
  const MediaRecorderClass = options.MediaRecorderClass ?? globalThis.MediaRecorder;
  const AudioContextClass = options.AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const MediaStreamClass = options.MediaStreamClass ?? globalThis.MediaStream;
  const document = options.document ?? globalThis.document;
  const capabilities = [];
  for (const format of formats) {
    let formatVerified = false;
    for (const mimeType of MIME_CANDIDATES[format]) {
      let advertised = false;
      try { advertised = Boolean(MediaRecorderClass?.isTypeSupported?.(mimeType)); } catch { advertised = false; }
      if (!advertised) continue;
      const canvas = options.createCanvas?.(width, height) ?? document?.createElement?.("canvas");
      if (!canvas) throw error("CAPTURE_FAILED", "Probe host could not create a Canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const capability = await probeOne({ canvas, width, height, fps, audioMode, mimeType, MediaRecorderClass,
          AudioContextClass, MediaStreamClass, document, durationMs, timeoutMs });
        capabilities.push(capability);
        formatVerified = true;
      } catch (cause) {
        capabilities.push(Object.freeze({ verification: "failed", mimeType, width, height, fps, audioMode,
          reason: cause?.message ?? String(cause) }));
      }
      if (formatVerified) break;
    }
  }
  return Object.freeze(capabilities);
}

/** Record a precomputed plan from immutable host inputs; all sampled times use the recorder start epoch. */
export async function startExport(plan, host = {}, { signal, onProgress } = {}) {
  if (!plan || !host || typeof host !== "object") throw new TypeError("An export plan and host are required");
  if (activeHosts.has(host)) throw error("CAPTURE_FAILED", "This Motion Studio host already has an active export");
  if (typeof host.renderFrame !== "function") throw new TypeError("Export host requires renderFrame(ctx, sceneMs, viewport, frameContext)");
  const MediaRecorderClass = recorderCtor(host);
  if (typeof MediaRecorderClass !== "function") throw error("UNSUPPORTED_FORMAT", "MediaRecorder is unavailable");
  checkAbort(signal);
  activeHosts.add(host);
  let audioContext = null;
  let mixer = null;
  let videoStream = null;
  let stream = null;
  let recorder = null;
  let canvas = null;
  let rafId = null;
  let watchdog = null;
  let startFrameInterval = null;
  let chunks = [];
  let released = false;
  let stopReason = null;
  let renderedFrames = 0;
  let droppedFrames = 0;
  let bytes = 0;
  const document = dom(host);
  const raf = host.requestAnimationFrame ?? globalThis.requestAnimationFrame;
  const caf = host.cancelAnimationFrame ?? globalThis.cancelAnimationFrame;
  const now = () => (host.performance ?? globalThis.performance)?.now?.() ?? Date.now();
  const window = host.window ?? globalThis.window;
  const boundTracks = [];
  const cleanup = async () => {
    if (released) return;
    released = true;
    if (rafId !== null) (caf ?? clearTimeout)(rafId);
    if (watchdog !== null) clearInterval(watchdog);
    if (startFrameInterval !== null) clearInterval(startFrameInterval);
    signal?.removeEventListener("abort", onAbort);
    document?.removeEventListener?.("visibilitychange", onVisibility);
    window?.removeEventListener?.("pagehide", onPageHide);
    audioContext?.removeEventListener?.("statechange", onAudioStateChange);
    for (const [track, listener] of boundTracks) track.removeEventListener?.("ended", listener);
    try { mixer?.stop(); } catch {}
    for (const track of new Set([...(stream?.getTracks?.() ?? []), ...(videoStream?.getTracks?.() ?? [])])) { try { track.stop(); } catch {} }
    try { await awaitWork(audioContext?.close?.(), host.audioContextCloseTimeoutMs ?? 1000, "AudioContext cleanup timed out"); } catch {}
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    chunks = [];
    activeHosts.delete(host);
  };
  const onAbort = () => { stopReason ??= abortError(signal); try { if (recorder?.state === "recording") recorder.stop(); } catch {} };
  const onVisibility = () => { if (document?.visibilityState === "hidden") { stopReason ??= error("BACKGROUNDED", "Export cancelled because the page was hidden"); onAbort(); } };
  const onPageHide = () => { stopReason ??= error("BACKGROUNDED", "Export cancelled because the page was closed"); onAbort(); };
  const onAudioStateChange = () => {
    if (audioContext?.state !== "running" && recorder?.state === "recording") {
      stopReason ??= error("CAPTURE_FAILED", `AudioContext changed to ${audioContext.state} during export`);
      onAbort();
    }
  };
  const onTrackEnded = () => {
    if (recorder?.state === "recording") { stopReason ??= error("CAPTURE_FAILED", "A capture track ended unexpectedly"); onAbort(); }
  };

  try {
    const { context, canvas: outputCanvas } = createCanvas(host, plan.viewport.width, plan.viewport.height);
    canvas = outputCanvas;
    checkAbort(signal);
    if (plan.audio === "mix") {
      audioContext = host.audioContext ?? host.createAudioContext?.();
      if (!audioContext) throw error("CAPTURE_FAILED", "Host must provide a Web Audio context for mixed export");
      // Invoke resume synchronously from the initiating user gesture before awaiting preflight.
      await awaitWork(audioContext.resume?.(), host.audioContextTimeoutMs ?? 10_000,
        "AudioContext did not resume before its timeout", { signal });
      checkAbort(signal);
      if (audioContext.state !== "running") throw error("CAPTURE_FAILED", "AudioContext did not enter the running state");
      audioContext.addEventListener?.("statechange", onAudioStateChange);
      mixer = await prepareAudioMix(plan, { audioContext, resolveAudio: host.resolveAudio }, { signal,
        onProgress: progress => onProgress?.(progress) });
    }
    checkAbort(signal);
    const startSceneMs = plan.range.startMs;
    const initial = host.renderFrame(context, startSceneMs, plan.viewport, Object.freeze({ frameIndex: 0, elapsedMs: 0, exporting: true }));
    if (initial?.then) throw error("CAPTURE_FAILED", "renderFrame must be synchronous to preserve frame timestamps");
    try { videoStream = canvas.captureStream(0); } catch { videoStream = null; }
    const videoTrack = videoStream?.getVideoTracks?.()[0];
    const requestFrames = Boolean(videoStream && typeof videoTrack?.requestFrame === "function");
    if (!requestFrames) {
      for (const track of videoStream?.getTracks?.() ?? []) { try { track.stop(); } catch {} }
      videoStream = canvas.captureStream(plan.fps);
    }
    stream = composeStream(host, videoStream, mixer?.stream ?? null);
    if (!stream?.getTracks?.().length) throw error("CAPTURE_FAILED", "No capture tracks are available");
    try { recorder = new MediaRecorderClass(stream, { mimeType: plan.mimeType, videoBitsPerSecond: plan.videoBitsPerSecond,
      audioBitsPerSecond: plan.audioBitsPerSecond }); }
    catch (cause) { throw error("UNSUPPORTED_FORMAT", `MediaRecorder rejected ${plan.mimeType}`, cause); }
    const onData = event => {
      if (event.data?.size) {
        bytes += event.data.size;
        if (bytes > plan.outputBudgetBytes) {
          stopReason ??= error("BUDGET_EXCEEDED", "Recorded file exceeded the output memory budget");
          try { recorder.stop(); } catch {}
          return;
        }
        chunks.push(event.data);
      }
    };
    const onRecorderError = event => { stopReason ??= event.error ?? error("CAPTURE_FAILED", "MediaRecorder failed"); };
    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("error", onRecorderError);
    signal?.addEventListener("abort", onAbort, { once: true });
    document?.addEventListener?.("visibilitychange", onVisibility);
    window?.addEventListener?.("pagehide", onPageHide);
    for (const track of stream.getTracks?.() ?? []) {
      track.addEventListener?.("ended", onTrackEnded);
      boundTracks.push([track, onTrackEnded]);
    }
    checkAbort(signal);
    const fps = plan.fps;
    const frameContext = Object.freeze({ exporting: true, range: plan.range, quality: plan.quality, audio: plan.audio });
    const primeStartFrame = () => {
      if (released || stopReason) return;
      try {
        const result = host.renderFrame(context, startSceneMs, plan.viewport, Object.freeze({ ...frameContext,
          frameIndex: 0, elapsedMs: 0 }));
        if (result?.then) throw error("CAPTURE_FAILED", "renderFrame must remain synchronous while starting the recorder");
        if (requestFrames) requestFrame(videoStream);
      } catch (cause) {
        stopReason ??= cause;
        try { if (recorder?.state === "recording") recorder.stop(); } catch {}
      }
    };
    if (requestFrames) {
      // Chromium can wait for consecutive Canvas frames before it emits start.
      // Keep the fixed initial scene frame live until that event.
      primeStartFrame();
      startFrameInterval = globalThis.setInterval(primeStartFrame, Math.max(16, 1000 / fps));
    }
    // Android encoders may dispatch `start` several frames after recording has
    // begun. Anchor both clocks to the start() call so this event delay is not
    // added to the file duration or introduced as audio/video drift.
    const frameIntervalMs = 1000 / fps;
    const leadMs = Math.min(50, Math.max(30, host.startLeadMs ?? 40));
    const clockAudioEpoch = plan.audio === "mix" ? audioContext.currentTime + leadMs / 1000 : null;
    const clockPerfEpoch = now() + leadMs;
    if (mixer) mixer.schedule(clockAudioEpoch);
    const startedPromise = waitForEvent(recorder, "start", { signal, timeoutMs: host.startTimeoutMs ?? 5000, errorNames: ["error"] });
    const stoppedPromise = waitForEvent(recorder, "stop", { timeoutMs: plan.durationMs + (host.stopTimeoutMs ?? 10_000), errorNames: ["error"] });
    recorder.start(250);
    await startedPromise;
    if (startFrameInterval !== null) { clearInterval(startFrameInterval); startFrameInterval = null; }
    checkAbort(signal);
    if (stopReason) throw stopReason;
    const frameCount = Math.ceil(plan.durationMs * fps / 1000) + 1;
    let nextFrame = 0;
    let lastProgress = now();
    let finished = false;
    const paint = (index, elapsedMs) => {
      const sceneMs = index === frameCount - 1 ? plan.range.endMs : Math.min(plan.range.endMs,
        plan.range.startMs + Math.min(plan.durationMs, index * frameIntervalMs));
      const result = host.renderFrame(context, sceneMs, plan.viewport, Object.freeze({ ...frameContext,
        frameIndex: index, elapsedMs }));
      if (result?.then) throw error("CAPTURE_FAILED", "renderFrame must remain synchronous during recording");
      if (requestFrames) requestFrame(videoStream);
      renderedFrames++;
      lastProgress = now();
      onProgress?.(Object.freeze({ phase: "recording", elapsedMs: Math.min(plan.durationMs, elapsedMs), targetMs: plan.durationMs,
        renderedFrames, droppedFrames }));
    };
    const tick = timestamp => {
      if (released || finished || stopReason) return;
      try {
        const current = Number.isFinite(timestamp) ? timestamp : now();
        const elapsed = clockAudioEpoch === null ? current - clockPerfEpoch : (audioContext.currentTime - clockAudioEpoch) * 1000;
        if (elapsed >= 0) {
          const due = elapsed >= plan.durationMs
            ? frameCount - 1
            : Math.min(frameCount - 2, Math.floor(elapsed / frameIntervalMs));
          if (due >= nextFrame) {
            if (due > nextFrame) {
              const skipped = due - nextFrame;
              droppedFrames += skipped;
              if (skipped * frameIntervalMs >= 250) {
                throw error("CLOCK_STALLED", "Export skipped too many consecutive frames; retry at a lower quality");
              }
            }
            paint(due, elapsed);
            nextFrame = due + 1;
          }
          if (due === frameCount - 1 && elapsed >= plan.durationMs) {
            finished = true;
            onProgress?.(Object.freeze({ phase: "finalizing", elapsedMs: plan.durationMs, targetMs: plan.durationMs,
              renderedFrames, droppedFrames }));
            try { recorder.stop(); } catch (cause) { stopReason ??= error("CAPTURE_FAILED", "Unable to stop the recorder", cause); }
            return;
          }
        }
        if (typeof raf === "function") rafId = raf(tick);
        else rafId = setTimeout(() => tick(now()), 16);
      } catch (cause) { stopReason ??= cause; try { recorder.stop(); } catch {} }
    };
    paint(0, 0);
    if (typeof raf === "function") rafId = raf(tick);
    else rafId = setTimeout(() => tick(now()), 16);
    watchdog = setInterval(() => {
      if (stopReason || finished) return;
      if (now() - lastProgress > 1000) {
        stopReason = error("CLOCK_STALLED", "Export clock stopped advancing");
        try { recorder.stop(); } catch {}
      }
    }, 250);
    const stopEvent = await stoppedPromise;
    void stopEvent;
    checkAbort(signal);
    if (stopReason) throw stopReason;
    onProgress?.(Object.freeze({ phase: "validating", elapsedMs: plan.durationMs, targetMs: plan.durationMs,
      renderedFrames, droppedFrames }));
    const blob = new Blob(chunks, { type: recorder.mimeType || plan.mimeType });
    const metadata = await inspectOutput(blob, plan, host, stream);
    checkAbort(signal);
    return Object.freeze({ blob, mimeType: metadata.actualMime,
      extension: metadata.actualMime.toLowerCase().startsWith("video/mp4") ? "mp4" : "webm",
      width: plan.viewport.width, height: plan.viewport.height, targetDurationMs: plan.durationMs,
      measuredDurationMs: metadata.measuredDurationMs, warnings: Object.freeze(metadata.warnings), renderedFrames,
      droppedFrames, bytes: blob.size, clockMode: plan.audio === "mix" ? "audio-context" : "performance" });
  } catch (cause) {
    if (cause instanceof ExportError || cause?.name === "AbortError") throw cause;
    throw error("CAPTURE_FAILED", cause?.message ?? "Export failed", cause);
  } finally { await cleanup(); }
}

export { MIME_CANDIDATES };
