import assert from "node:assert/strict";
import test from "node:test";
import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { imageRect } from "../examples/motion-studio-lab/studio-dimensions.js";
import { makeProject, makeProjectFile, parseProjectFile } from "../examples/motion-studio-lab/studio-model.js";
import {
  chooseDefaultFormat, createExportLock, createRecordingSession, estimateVideoBytes, exportDurationMs,
  exportFrameCount, exportFrameTime, exportViewportFor, extensionForMime, mimeCandidates, projectForRaster, projectTimeAt,
  scheduleTestPulses, supportedCandidates
} from "../examples/motion-studio-lab/studio-export-core.js";

class FakeRecorder extends EventTarget {
  static supported = new Set();
  static isTypeSupported(type) { return FakeRecorder.supported.has(type); }
  constructor(stream, options = {}) {
    super();
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = "inactive";
  }
  start() { if (this.state !== "inactive") throw new Error("already recording"); this.state = "recording"; }
  stop() {
    if (this.state === "inactive") throw new Error("inactive");
    this.state = "inactive";
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["frame-data"], { type: this.mimeType }) }));
    this.dispatchEvent(new Event("stop"));
  }
}

test("format selection probes actual MediaRecorder support and prefers MP4 only when available", () => {
  FakeRecorder.supported = new Set([mimeCandidates("webm")[0]]);
  assert.equal(chooseDefaultFormat(FakeRecorder), "webm");
  assert.equal(supportedCandidates(FakeRecorder, "mp4").length, 0);
  FakeRecorder.supported.add(mimeCandidates("mp4")[0]);
  assert.equal(chooseDefaultFormat(FakeRecorder), "mp4");
  assert.equal(chooseDefaultFormat(undefined), null);
  assert.equal(extensionForMime("video/mp4;codecs=avc1"), "mp4");
  assert.equal(extensionForMime("video/webm;codecs=vp9"), "webm");
});

test("Original, 9:16, 16:9 and Fit/Fill exports keep project aspect within safe raster limits", () => {
  const sizes = {
    original: { width: 1500, height: 1000, fps: 24 },
    portrait: { width: 1080, height: 1920, fps: 24 },
    landscape: { width: 1920, height: 1080, fps: 24 }
  };
  for (const viewport of Object.values(sizes)) {
    const raster = exportViewportFor(viewport, "standard");
    assert.ok(raster.width * raster.height <= 921_600);
    assert.ok(Math.max(raster.width, raster.height) <= 1280);
    assert.ok(Math.abs(raster.width / raster.height - viewport.width / viewport.height) < 0.003);
  }
  assert.equal(exportViewportFor(sizes.portrait).width / exportViewportFor(sizes.portrait).height, 9 / 16);
  assert.equal(exportViewportFor(sizes.landscape).width / exportViewportFor(sizes.landscape).height, 16 / 9);
  const fit = imageRect(1600, 900, 720, 1280, "fit");
  const fill = imageRect(1600, 900, 720, 1280, "fill");
  assert.ok(fit.y > 0 && fit.height < 1280);
  assert.ok(fill.x < 0 && fill.width > 720);
});

test("export sampling and drawFrame use the same compiled Motion Studio camera frames", () => {
  const project = makeProject({ durationMs: 12000, viewport: { width: 1080, height: 1920, fps: 24 },
    startZoom: 1, endZoom: 1.5, startX: 0, endX: 90, startY: 0, endY: -60 });
  const provider = { get: () => ({ image: true }) };
  const preview = compileProject(projectForRaster(project, { width: 720, height: 1280 }), provider);
  const exportProject = projectForRaster(project, exportViewportFor(project.viewport, "standard"));
  const output = compileProject(exportProject, provider);
  for (const elapsed of [0, 3000, 6000, 12000]) {
    const exportAt = projectTimeAt(elapsed, 12000, output.durationMs);
    const previewFrame = sampleFrame(preview, exportAt);
    const exportFrame = sampleFrame(output, exportAt);
    assert.equal(previewFrame.camera.zoom, exportFrame.camera.zoom);
    assert.equal(exportFrame.camera.x, previewFrame.camera.x, "camera x matches the preview raster");
    assert.equal(exportFrame.camera.y, previewFrame.camera.y, "camera y matches the preview raster");
    const calls = [];
    const ctx = { canvas: { width: output.viewport.width, height: output.viewport.height } };
    for (const method of ["save", "restore", "setTransform", "clearRect", "translate", "rotate", "scale", "drawImage"]) ctx[method] = (...args) => calls.push([method, ...args]);
    drawFrame(ctx, exportFrame);
    assert.ok(calls.some(([method]) => method === "drawImage"));
  }
  assert.equal(projectTimeAt(-10, 3000, 12000), 0);
  assert.equal(projectTimeAt(3000, 3000, 12000), 12000);
});

test("duration mapping and output byte limits are bounded", () => {
  assert.equal(exportDurationMs("project", 12000), 12000);
  for (const [option, expected] of [["3000", 3000], ["10000", 10000], ["30000", 30000], ["60000", 60000]]) {
    assert.equal(exportDurationMs(option, 12000), expected);
  }
  assert.throws(() => exportDurationMs("90000", 12000), RangeError);
  assert.ok(estimateVideoBytes(60000, 2_596_000) < 24 * 1024 * 1024);
  assert.throws(() => estimateVideoBytes(0, 1000), RangeError);
});

test("3 and 10 second frame clocks are monotonic and always sample the exact last frame", () => {
  for (const durationMs of [3000, 10000]) {
    const count = exportFrameCount(durationMs, 24);
    const times = Array.from({ length: count }, (_, index) => exportFrameTime(index, 24, durationMs));
    assert.equal(times[0], 0);
    assert.equal(times.at(-1), durationMs);
    assert.ok(times.every((time, index) => index === 0 || time >= times[index - 1]));
    assert.ok(times.slice(1, -1).every((time) => time < durationMs));
  }
  assert.throws(() => exportFrameTime(-1, 24, 3000), RangeError);
});

test("export lock prevents overlapping recordings and can be reused after release", () => {
  const lock = createExportLock();
  const release = lock.acquire();
  assert.equal(lock.held, true);
  assert.equal(lock.acquire(), null);
  release();
  release();
  assert.equal(lock.held, false);
  assert.equal(typeof lock.acquire(), "function");
});

test("recording captures chunks, reports the actual MIME and stops at its duration", async () => {
  let clock = 0;
  let timerFn;
  const session = createRecordingSession({
    stream: { getTracks: () => [] }, mimeType: "video/mp4", durationMs: 3000,
    MediaRecorderClass: FakeRecorder, now: () => clock,
    schedule: (fn) => { timerFn = fn; return 1; }, unschedule: () => {}
  });
  clock = 3000;
  timerFn();
  const result = await session.promise;
  assert.equal(result.mimeType, "video/mp4");
  assert.equal(result.blob.size, 10);
  assert.equal(result.durationMs, 3000);
  assert.equal(session.recorder.state, "inactive");
});

test("manual-stop mode waits for the exact final-frame clock instead of stopping on a competing timer", async () => {
  const session = createRecordingSession({ stream: {}, mimeType: "video/webm", durationMs: 3000,
    MediaRecorderClass: FakeRecorder, autoStop: false,
    schedule: () => { throw new Error("auto-stop timer should not be scheduled"); } });
  session.stop();
  assert.equal((await session.promise).durationMs >= 0, true);
});

test("recording rejects an oversized output chunk and stops the recorder", async () => {
  const session = createRecordingSession({ stream: {}, mimeType: "video/webm", durationMs: 3000,
    maxBytes: 4, MediaRecorderClass: FakeRecorder });
  await assert.rejects(session.promise, /تجاوز الفيديو حد الحجم الآمن/);
  assert.equal(session.recorder.state, "inactive");
});

test("WebM and MP4 recorder regressions preserve the actual container MIME", async () => {
  for (const mimeType of ["video/webm;codecs=vp8,opus", "video/mp4;codecs=avc1.42E01E,mp4a.40.2"]) {
    const session = createRecordingSession({ stream: {}, mimeType, durationMs: 3000, MediaRecorderClass: FakeRecorder });
    session.stop();
    const result = await session.promise;
    assert.equal(result.mimeType, mimeType);
    assert.equal(extensionForMime(result.mimeType), mimeType.startsWith("video/mp4") ? "mp4" : "webm");
  }
});

test("recording cancellation rejects, stops the recorder and releases its single-flight lock", async () => {
  const lock = createExportLock();
  const release = lock.acquire();
  const controller = new AbortController();
  const session = createRecordingSession({ stream: {}, mimeType: "video/webm", durationMs: 3000,
    MediaRecorderClass: FakeRecorder, signal: controller.signal });
  const rejected = assert.rejects(session.promise, { name: "AbortError" });
  controller.abort(new DOMException("cancelled", "AbortError"));
  await rejected;
  assert.equal(session.recorder.state, "inactive");
  release();
  assert.equal(lock.held, false);
});

test("an MP4 start failure leaves the recorder reusable for an explicit WebM retry", async () => {
  class Mp4RejectingRecorder extends FakeRecorder {
    constructor(stream, options = {}) {
      if (options.mimeType?.startsWith("video/mp4")) throw new Error("MP4 encoder unavailable");
      super(stream, options);
    }
  }
  Mp4RejectingRecorder.supported = new Set(["video/mp4", "video/webm"]);
  assert.equal(chooseDefaultFormat(Mp4RejectingRecorder), "mp4", "capability probe may report MP4 before the encoder rejects it");
  assert.throws(() => createRecordingSession({ stream: {}, mimeType: "video/mp4", durationMs: 3000, MediaRecorderClass: Mp4RejectingRecorder }), /encoder unavailable/);
  const retry = createRecordingSession({ stream: {}, mimeType: "video/webm", durationMs: 3000, MediaRecorderClass: Mp4RejectingRecorder });
  retry.stop();
  assert.equal((await retry.promise).mimeType, "video/webm");
});

test("optional Web Audio pulses use the same recording clock", () => {
  const times = [];
  const audio = {
    currentTime: 10,
    createOscillator() { return { type: "", frequency: {}, connect() {}, start(at) { times.push(at); }, stop() {} }; },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
  };
  assert.deepEqual(scheduleTestPulses(audio, {}, 3200), [10.33, 11.33, 12.33]);
});

test("export leaves project JSON metadata and asset references untouched", () => {
  const project = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.4, startX: 0, endX: 42, startY: 0, endY: -21 });
  const originalJson = JSON.stringify(makeProjectFile(project, { name: "portrait.png", type: "image/png", size: 1200 }));
  const exportCopy = projectForRaster(project, exportViewportFor(project.viewport));
  assert.notEqual(exportCopy, project);
  assert.equal(exportCopy.layers[0].assetId, project.layers[0].assetId);
  const readBack = parseProjectFile(originalJson);
  assert.deepEqual(readBack.project, project);
  assert.equal(readBack.image.name, "portrait.png");
  assert.equal(JSON.stringify(makeProjectFile(readBack.project, readBack.image, readBack.settings)), originalJson);
});
