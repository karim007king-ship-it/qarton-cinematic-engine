import assert from "node:assert/strict";
import test from "node:test";
import { planExport } from "../packages/motion-studio/export/export-plan.js";
import { probeExport, startExport } from "../packages/motion-studio/export/recording-session.js";
import * as publicMotionStudio from "../packages/motion-studio/index.js";

function makePlan({ durationMs = 180, fps = 24, format = "webm", audio = "none" } = {}) {
  const project = { version: 1, durationMs, viewport: { width: 360, height: 640, fps }, layers: [] };
  const raster = { width: 360, height: 640 };
  const capability = { verification: "verified", mimeType: "video/webm;codecs=vp8", ...raster, fps, audioMode: audio };
  return planExport({ project, audioTracks: [], audioAssets: [] }, { quality: "480p", fps, format, audio }, [capability]);
}

class FakeTrack {
  constructor(kind) { this.kind = kind; this.stopped = false; this.requests = 0; }
  requestFrame() { this.requests++; }
  stop() { this.stopped = true; }
}
class FakeStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
}
class FakeCanvas {
  constructor() { this.width = 0; this.height = 0; this.paintCount = 0; this.track = new FakeTrack("video"); this.track.owner = this; this.context = { canvas: this, fillRect: () => { this.paintCount++; } }; }
  getContext() { return this.context; }
  captureStream(fps) { this.captureFps = fps; return new FakeStream([this.track]); }
}
class FakeRecorder extends EventTarget {
  static isTypeSupported(type) { return type === "video/webm;codecs=vp8,opus"; }
  constructor(stream, options) { super(); this.stream = stream; this.mimeType = options.mimeType; this.state = "inactive"; }
  start() {
    this.state = "recording";
    const track = this.stream.getVideoTracks()[0];
    FakeRecorder.paintCountAtStart = track?.owner?.paintCount ?? 0;
    FakeRecorder.requestCountAtStart = track?.requests ?? 0;
    queueMicrotask(() => this.dispatchEvent(new Event("start")));
  }
  stop() {
    if (this.state !== "recording") return;
    this.state = "inactive";
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["fake-video"], { type: this.mimeType }) }));
    this.dispatchEvent(new Event("stop"));
  }
}
class DelayedStartRecorder extends FakeRecorder {
  start() {
    if (this.state !== "inactive") throw new Error("already recording");
    this.state = "recording";
    const track = this.stream.getVideoTracks()[0];
    DelayedStartRecorder.paintCountAtStart = track?.owner?.paintCount ?? 0;
    DelayedStartRecorder.requestCountAtStart = track?.requests ?? 0;
    DelayedStartRecorder.startedAt = performance.now();
    setTimeout(() => this.dispatchEvent(new Event("start")), 250);
  }
  stop() {
    if (this.state !== "recording") return;
    DelayedStartRecorder.stoppedAt = performance.now();
    super.stop();
  }
}
class FakeMediaStream extends FakeStream {}

class InfiniteDurationVideo extends EventTarget {
  constructor(width, height) {
    super();
    this.videoWidth = width;
    this.videoHeight = height;
    this.duration = Infinity;
    this.currentTime = 0;
    this._src = "";
  }
  set src(value) { this._src = value; queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
  get src() { return this._src; }
  removeAttribute(name) { if (name === "src") this._src = ""; }
  load() {}
}

class FakeAudioContext extends EventTarget {
  constructor(log) { super(); this.state = "running"; this.clockOrigin = null; this.log = log; this.nodes = []; this.destination = null; }
  get currentTime() { return 3 + (this.clockOrigin === null ? 0 : (performance.now() - this.clockOrigin) / 1000); }
  resume() { this.log.push("resume"); return Promise.resolve(); }
  async decodeAudioData(bytes) { this.log.push("decode"); return { length: 48_000, numberOfChannels: 1, sampleRate: 48_000, duration: 1 }; }
  createGain() { const node = { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; this.nodes.push(node); return node; }
  createBufferSource() { const source = { connect() {}, disconnect() {}, start: (...args) => this.log.push(["audio-start", ...args]), stop() {} }; return source; }
  createMediaStreamDestination() { this.clockOrigin = performance.now(); const destination = { connect() {}, disconnect() {}, stream: new FakeStream([new FakeTrack("audio")]) }; this.destination = destination; return destination; }
}
class HangingResumeAudioContext extends FakeAudioContext {
  constructor() { super([]); }
  resume() { return new Promise(() => {}); }
  close() { return new Promise(() => {}); }
}

function makeHost(rendered, overrides = {}) {
  const canvas = new FakeCanvas();
  const host = {
    MediaRecorderClass: FakeRecorder,
    MediaStreamClass: FakeMediaStream,
    createCanvas: () => canvas,
    renderFrame: (_ctx, timeMs, viewport, frame) => rendered.push({ timeMs, width: viewport.width, height: viewport.height, ...frame }),
    ...overrides
  };
  return { host, canvas };
}

test("public Motion Studio entry exposes the L10 export API without touching browser globals at import", () => {
  for (const name of ["planExport", "prepareAudioMix", "probeExport", "startExport"]) assert.equal(typeof publicMotionStudio[name], "function");
});

test("recording uses exact absolute project samples, reports progress, validates Blob MIME, and releases capture tracks", async () => {
  const plan = makePlan();
  const rendered = [];
  const progress = [];
  const { host, canvas } = makeHost(rendered);
  const result = await startExport(plan, host, { onProgress: value => progress.push(value) });
  assert.ok(result.blob.size > 0);
  assert.equal(result.mimeType, plan.mimeType);
  assert.equal(result.targetDurationMs, 180);
  assert.equal(result.measuredDurationMs, null);
  assert.ok(result.warnings.some(value => /metadata/u.test(value)));
  assert.ok(rendered.length >= 3);
  assert.equal(rendered[0].timeMs, 0);
  assert.equal(rendered.at(-1).timeMs, 180);
  assert.ok(rendered.every((frame, index) => index === 0 || frame.timeMs >= rendered[index - 1].timeMs));
  assert.ok(progress.some(({ phase }) => phase === "recording"));
  assert.ok(progress.some(({ phase }) => phase === "validating"));
  assert.equal(canvas.track.stopped, true);
  assert.ok(canvas.track.requests > 0);
  assert.ok(FakeRecorder.requestCountAtStart > 0, "manual Canvas track is requested before waiting for MediaRecorder.start");
});

test("delayed MediaRecorder start event does not extend the requested recording duration", async () => {
  const plan = makePlan({ durationMs: 500 });
  const { host } = makeHost([], { MediaRecorderClass: DelayedStartRecorder });
  host.startLeadMs = 40;
  const result = await startExport(plan, host);
  const capturedMs = DelayedStartRecorder.stoppedAt - DelayedStartRecorder.startedAt;
  assert.ok(result.blob.size > 0);
  assert.ok(capturedMs >= plan.durationMs + 25, `expected the recorder lead frame to be retained: ${capturedMs}`);
  assert.ok(capturedMs <= plan.durationMs + 180, `start-event latency leaked into output duration: ${capturedMs}`);
});

test("WebM without finite container duration metadata uses the shared recording clock and reports the limitation", async () => {
  const plan = makePlan();
  const video = new InfiniteDurationVideo(plan.viewport.width, plan.viewport.height);
  const { host } = makeHost([], {
    document: { createElement: name => name === "video" ? video : null },
    URL: { createObjectURL: () => "blob:verified-webm", revokeObjectURL() {} }
  });
  const result = await startExport(plan, host);
  assert.equal(result.measuredDurationMs, null);
  assert.ok(result.warnings.some(value => /file duration could not be measured/u.test(value)));
});

test("AbortSignal cancels recording, discards partial output, and releases the export lock", async () => {
  const controller = new AbortController();
  const rendered = [];
  const { host, canvas } = makeHost(rendered);
  let calls = 0;
  const pending = startExport(makePlan({ durationMs: 500 }), host, { signal: controller.signal,
    onProgress: value => { if (value.phase === "recording" && ++calls === 1) controller.abort(); } });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canvas.track.stopped, true);
  const reused = await startExport(makePlan({ durationMs: 100 }), host);
  assert.ok(reused.blob.size > 0, "cleanup released the host lock after cancellation");
});

test("mixed recording resumes audio before async preparation and starts audio on the shared recorder epoch", async () => {
  const log = [];
  const context = new FakeAudioContext(log);
  const project = { version: 1, durationMs: 300, viewport: { width: 360, height: 640, fps: 24 }, layers: [] };
  const audioTracks = [{ id: "dialogue", type: "dialogue", clips: [
    { id: "line", asset: "voice", startMs: 0, durationMs: 300, language: "ar", visemes: [] }
  ] }];
  const capability = { verification: "verified", mimeType: "video/webm;codecs=vp8", width: 360, height: 640, fps: 24, audioMode: "mix" };
  const plan = planExport({ project, audioTracks, audioAssets: [{ id: "voice", name: "voice.wav", type: "audio/wav", size: 64 }],
    audioAssetInfo: [{ id: "voice", durationMs: 1000, channels: 1, sampleRate: 48_000 }] }, { quality: "480p" }, [capability]);
  const rendered = [];
  const { host } = makeHost(rendered, { audioContext: context, resolveAudio: async () => { log.push("resolve"); return new Blob(["wav"]); } });
  const result = await startExport(plan, host);
  assert.ok(result.blob.size > 0);
  assert.ok(log.indexOf("resume") < log.indexOf("resolve"));
  assert.equal(log.filter(item => item === "decode").length, 1, "only the source audio asset is decoded; the multiplexed WebM is validated through its tracks");
  const scheduled = log.find(item => Array.isArray(item) && item[0] === "audio-start");
  assert.ok(scheduled, "audio source was scheduled on the recorder clock");
  assert.ok(scheduled[1] >= 3.03 && scheduled[1] <= context.currentTime);
  assert.equal(rendered.at(-1).timeMs, 300);
});

test("only one export runs per host and recorder constructor failures surface typed errors", async () => {
  const rendered = [];
  const { host } = makeHost(rendered);
  const controller = new AbortController();
  const running = startExport(makePlan({ durationMs: 500 }), host, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(startExport(makePlan(), host), { code: "CAPTURE_FAILED" });
  controller.abort();
  await assert.rejects(running, { name: "AbortError" });
  const invalid = { ...host, MediaRecorderClass: class { constructor() { throw new Error("codec"); } } };
  await assert.rejects(startExport(makePlan(), invalid), { code: "UNSUPPORTED_FORMAT" });
});

test("capability probe validates the exact profile and records failure instead of claiming unsupported verification", async () => {
  await assert.rejects(probeExport({ width: 0, height: 640 }), RangeError);
  const canvas = new FakeCanvas();
  const result = await probeExport({ width: 360, height: 640, fps: 24, audioMode: "none", durationMs: 200,
    MediaRecorderClass: FakeRecorder, formats: ["webm"], createCanvas: () => canvas, document: {} });
  assert.ok(FakeRecorder.paintCountAtStart > 0, "the probe paints a frame before recorder start");
  assert.ok(result.every(capability => capability.verification === "failed" || capability.verification === "verified"));
  assert.equal(result.length, 1, "unverified advertised formats continue through fallback candidates, then report the result");
  assert.equal(result[0].verification, "failed", "the fake probe has no output decoder, so it cannot claim verified support");
  assert.ok(result.every(capability => capability.width === 360 && capability.height === 640 && capability.fps === 24));
});

test("capability probe bounds Web Audio resume and cleanup when their promises never settle", async () => {
  const result = await probeExport({ width: 360, height: 640, fps: 24, audioMode: "mix", durationMs: 200,
    timeoutMs: 1000, MediaRecorderClass: FakeRecorder, AudioContextClass: HangingResumeAudioContext,
    MediaStreamClass: FakeMediaStream, formats: ["webm"], createCanvas: () => new FakeCanvas(), document: {} });
  assert.equal(result.length, 1);
  assert.equal(result[0].verification, "failed");
  assert.match(result[0].reason, /did not resume in time/u);
});


test("mixed export rejects a stalled AudioContext clock and releases capture tracks", async () => {
  class StalledAudioContext extends FakeAudioContext {
    get currentTime() { return 3; }
  }
  const context = new StalledAudioContext([]);
  const { host, canvas } = makeHost([], { audioContext: context, resolveAudio: async () => null });
  await assert.rejects(startExport(makePlan({ audio: "mix" }), host), { code: "CLOCK_STALLED" });
  assert.equal(canvas.track.stopped, true);
  assert.equal(context.destination.stream.getAudioTracks()[0].stopped, true);
});

function makeSafetyMixedPlan(durationMs = 300) {
  const project = { version: 1, durationMs, viewport: { width: 360, height: 640, fps: 24 }, layers: [] };
  const audioTracks = [{ id: "dialogue", type: "dialogue", clips: [
    { id: "voice", asset: "voice", startMs: 0, durationMs, language: "ar", visemes: [] }
  ] }];
  const capability = { verification: "verified", mimeType: "video/webm;codecs=vp8", width: 360, height: 640, fps: 24, audioMode: "mix" };
  return planExport({ project, audioTracks, audioAssets: [{ id: "voice", name: "voice.wav", type: "audio/wav", size: 16 }],
    audioAssetInfo: [{ id: "voice", durationMs: 1000, channels: 1, sampleRate: 48_000 }] }, { quality: "480p" }, [capability]);
}

class ResourceTrackingAudioContext extends FakeAudioContext {
  constructor(log = []) { super(log); this.closeCount = 0; }
  close() { this.closeCount++; this.state = "closed"; return Promise.resolve(); }
}

test("MediaRecorder initialization failure releases mixed capture resources", async () => {
  const context = new ResourceTrackingAudioContext();
  const { host, canvas } = makeHost([], { audioContext: context, resolveAudio: async () => new Blob(["voice"]),
    MediaRecorderClass: class { constructor() { throw new Error("recorder init failed"); } } });
  await assert.rejects(startExport(makeSafetyMixedPlan(), host), { code: "UNSUPPORTED_FORMAT" });
  assert.equal(canvas.track.stopped, true);
  assert.equal(context.destination.stream.getAudioTracks()[0].stopped, true);
  assert.equal(context.closeCount, 1);
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
});

test("repeated mixed-export cancellations release audio, video, and recorder-owned buffers", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const context = new ResourceTrackingAudioContext();
    context.sources = [];
    const createBufferSource = context.createBufferSource.bind(context);
    context.createBufferSource = () => { const source = createBufferSource(); context.sources.push(source); return source; };
    const { host, canvas } = makeHost([], { audioContext: context, resolveAudio: async () => new Blob(["voice"]) });
    const controller = new AbortController();
    const pending = startExport(makeSafetyMixedPlan(500), host, { signal: controller.signal,
      onProgress: value => { if (value.phase === "recording") controller.abort(); } });
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(canvas.track.stopped, true, `video track released on cancellation ${attempt + 1}`);
    assert.equal(context.destination.stream.getAudioTracks()[0].stopped, true, `audio track released on cancellation ${attempt + 1}`);
    assert.equal(context.closeCount, 1, `AudioContext closed once on cancellation ${attempt + 1}`);
    assert.ok(context.sources.length > 0, "a source was allocated before cancellation");
    assert.ok(context.sources.every(source => source.buffer === null), `decoded AudioBuffers released on cancellation ${attempt + 1}`);
  }
});

function makeManualRafHost() {
  const rendered = [];
  const frames = [];
  const { host } = makeHost(rendered);
  host.performance = { now: () => 1000 };
  host.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  host.cancelAnimationFrame = () => {};
  host.startLeadMs = 40;
  return { host, frames, rendered };
}

test("isolated frame loss is counted and export completes without slowing the timeline", async () => {
  const { host, frames } = makeManualRafHost();
  const pending = startExport(makePlan({ durationMs: 180 }), host);
  await new Promise(resolve => setImmediate(resolve));
  const frameIntervalMs = 1000 / 24;
  const first = frames.shift();
  assert.equal(typeof first, "function");
  first(1040);
  frames.shift()(1040 + frameIntervalMs * 2);
  frames.shift()(1040 + frameIntervalMs * 3);
  frames.shift()(1040 + frameIntervalMs * 4);
  frames.shift()(1040 + frameIntervalMs * 6);
  const result = await pending;
  assert.equal(result.droppedFrames, 1);
  assert.equal(result.targetDurationMs, 180);
});

test("severe frame loss stops export with a retryable clock error", async () => {
  const { host, frames } = makeManualRafHost();
  const pending = startExport(makePlan({ durationMs: 500 }), host);
  await new Promise(resolve => setImmediate(resolve));
  frames.shift()(1040);
  const delayed = frames.shift();
  assert.equal(typeof delayed, "function");
  delayed(1040 + 350);
  await assert.rejects(pending, { code: "CLOCK_STALLED" });
});
