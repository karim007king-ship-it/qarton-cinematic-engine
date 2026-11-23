import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MAX_DURATION_MS, MIN_DURATION_MS, createRequestToken, makeProject, makeProjectFile, parseProjectFile,
  playbackTimeMs, VIEWPORT
} from "../examples/motion-studio-lab/studio-model.js";
import { decodeImageBitmap, IMAGE_DECODE_WIDTHS, MAX_PREVIEW_PIXELS } from "../examples/motion-studio-lab/studio-image.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("mobile interface exposes portrait preview, image input, camera controls and timeline", async () => {
  const html = await readFile(resolve(root, "examples/motion-studio-lab/index.html"), "utf8");
  for (const id of ["stage", "imageInput", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "seek", "playPauseButton", "replayButton", "saveProjectButton", "loadProjectButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing interface control ${id}`);
  }
  assert.match(html, /width="720" height="1280"/);
  assert.match(html, /viewport" content="width=device-width, initial-scale=1/);
});

test("project model keeps the 720x1280 engine schema and enforces the supported duration", () => {
  const project = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.4, startX: 0, endX: 28, startY: 0, endY: -18 });
  assert.deepEqual(project.viewport, VIEWPORT);
  assert.equal(project.durationMs, 12000);
  assert.deepEqual(project.camera.map((key) => key.atMs), [0, 12000]);
  assert.deepEqual(project.camera[1].value, { x: 28, y: -18, zoom: 1.4, rotation: 0 });
  assert.equal(MIN_DURATION_MS, 3000);
  assert.equal(MAX_DURATION_MS, 60000);
  assert.throws(() => makeProject({ durationMs: 2999 }), RangeError);
  assert.throws(() => makeProject({ durationMs: 60001 }), RangeError);
});

test("camera edits retain the imported layer and opaque asset identifier", () => {
  const layers = [{ id: "portrait-layer", assetId: "portrait_asset_42", z: 3 }];
  const updated = makeProject({
    durationMs: 9000, layers, startZoom: 1, endZoom: 1.3,
    startX: 0, endX: 18, startY: 0, endY: -9
  });
  assert.equal(updated.layers[0].assetId, "portrait_asset_42");
  assert.equal(updated.layers[0].z, 3);
});

test("new image selection invalidates an older asynchronous decode result", () => {
  const request = createRequestToken();
  const slowImageRequest = request.begin();
  const fastImageRequest = request.begin();
  assert.equal(request.isCurrent(fastImageRequest), true);
  assert.equal(request.isCurrent(slowImageRequest), false);
});

test("large images request a bounded decode and progressively reduce unusual dimensions", async () => {
  const file = { name: "camera-photo.jpg", type: "image/jpeg", size: 4_000_000 };
  const original = { ...file };
  const calls = [];
  const closed = [];
  const bitmap = await decodeImageBitmap(file, {
    createBitmap: async (source, options) => {
      calls.push(options.resizeWidth);
      const scale = Math.min(1, options.resizeWidth / 1000);
      const result = { width: Math.round(1000 * scale), height: Math.round(6000 * scale), close() { closed.push(this); } };
      return result;
    }
  });
  assert.deepEqual(calls, IMAGE_DECODE_WIDTHS);
  assert.ok(bitmap.width * bitmap.height <= MAX_PREVIEW_PIXELS);
  assert.ok(bitmap.width <= 2048 && bitmap.height <= 2048);
  assert.equal(closed.length, calls.length - 1);
  assert.deepEqual(file, original, "the selected source file metadata remains untouched");
  bitmap.close();
});

test("ordinary images are accepted on the first bounded decode", async () => {
  const file = { name: "small.png", type: "image/png", size: 1200 };
  const calls = [];
  const bitmap = await decodeImageBitmap(file, {
    createBitmap: async (_source, options) => {
      calls.push(options.resizeWidth);
      return { width: 96, height: 96, close() {} };
    }
  });
  assert.deepEqual(calls, [IMAGE_DECODE_WIDTHS[0]]);
  assert.deepEqual([bitmap.width, bitmap.height], [96, 96]);
});

test("decoding failures and ignored resize requests produce a clear safe error", async () => {
  const file = { name: "large.png", type: "image/png", size: 9000 };
  await assert.rejects(decodeImageBitmap(file, { createBitmap: async () => { throw new Error("decoder failed"); } }), /تعذر فك ترميز الصورة أو تصغيرها/);
  let attempts = 0;
  await assert.rejects(decodeImageBitmap(file, {
    createBitmap: async () => {
      attempts++;
      return { width: 6000, height: 4000, close() {} };
    }
  }), /تعذر فك ترميز الصورة أو تصغيرها/);
  assert.equal(attempts, 1, "a decoder that ignored resize is not asked to allocate another full bitmap");
});

test("a slow older image selection is aborted and its decoded bitmap is closed", async () => {
  const request = createRequestToken();
  let releaseSlow;
  let staleClosed = false;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const oldToken = request.begin();
  const oldLoad = decodeImageBitmap({ name: "slow.jpg", type: "image/jpeg", size: 2000 }, {
    isCurrent: () => request.isCurrent(oldToken),
    createBitmap: () => slow
  });
  const newToken = request.begin();
  const current = await decodeImageBitmap({ name: "fast.png", type: "image/png", size: 1000 }, {
    isCurrent: () => request.isCurrent(newToken),
    createBitmap: async () => ({ width: 96, height: 96, close() {} })
  });
  releaseSlow({ width: 1280, height: 853, close() { staleClosed = true; } });
  await assert.rejects(oldLoad, { name: "AbortError" });
  assert.equal(staleClosed, true);
  assert.deepEqual([current.width, current.height], [96, 96]);
  assert.equal(request.isCurrent(newToken), true);
});

test("opening a project invalidates any pending image decode", () => {
  const request = createRequestToken();
  const pendingImageRequest = request.begin();
  const projectImportRequest = request.begin();
  assert.equal(request.isCurrent(projectImportRequest), true);
  assert.equal(request.isCurrent(pendingImageRequest), false);
});

test("absolute preview seeking returns the same timestamp across backward and forward navigation", () => {
  const timeline = { startAtMs: 500, pausedAtMs: null, durationMs: 12000 };
  const first = playbackTimeMs(timeline, 4200);
  assert.equal(first, 3700);
  assert.equal(playbackTimeMs(timeline, 1300), 800);
  assert.equal(playbackTimeMs(timeline, 4200), first);
  assert.equal(playbackTimeMs({ ...timeline, pausedAtMs: 3700 }, 9000), 3700);
  assert.equal(playbackTimeMs(timeline, 90000), 12000);
});

test("replay starts at zero and playback can restart from an exact seek position", () => {
  const replay = { startAtMs: 9000, pausedAtMs: null, durationMs: 12000 };
  assert.equal(playbackTimeMs({ ...replay, startAtMs: 9000 }, 9000), 0);
  assert.equal(playbackTimeMs({ ...replay, startAtMs: 5300 }, 9000), 3700);
});

test("project JSON stores metadata only and requires relinking the source image", () => {
  const project = makeProject({ durationMs: 3000, startZoom: 1, endZoom: 1.1, startX: 0, endX: 0, startY: 0, endY: 0 });
  const encoded = JSON.stringify(makeProjectFile(project, { name: "portrait.png", type: "image/png", size: 3500 }));
  const decoded = parseProjectFile(encoded);
  assert.deepEqual(decoded.project, project);
  assert.deepEqual(decoded.image, { name: "portrait.png", type: "image/png", size: 3500 });
  assert.ok(encoded.length < 4000);
  assert.throws(() => parseProjectFile("not json"), /JSON/);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: "unknown", version: 1, project, image: null })), TypeError);
  assert.throws(() => parseProjectFile(" ".repeat(128 * 1024 + 1)), RangeError);
});

test("JSON import rejects extra or displaced camera keys before slider editing", () => {
  const project = makeProject({ durationMs: 6000, startZoom: 1, endZoom: 1.2, startX: 0, endX: 0, startY: 0, endY: 0 });
  const withMiddleKey = structuredClone(project);
  withMiddleKey.camera.splice(1, 0, { atMs: 3000, value: { x: 12, y: 0, zoom: 1.1, rotation: 0 } });
  const file = (value) => JSON.stringify(makeProjectFile(value));
  assert.throws(() => parseProjectFile(file(withMiddleKey)), /مفتاحي كاميرا/);
  const displaced = structuredClone(project);
  displaced.camera[1].atMs = 5000;
  assert.throws(() => parseProjectFile(file(displaced)), /مفتاحي كاميرا/);
});

test("browser module uses the engine sampling API and includes deterministic seek and replay paths", async () => {
  const source = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  assert.match(source, /import \{ compileProject, drawFrame, sampleFrame \} from "@qarton\/cinematic-engine\/motion-studio"/);
  assert.match(source, /sampleFrame\(compiled, currentMs\)/);
  assert.match(source, /seek\.addEventListener\("input"/);
  assert.match(source, /function replay\(\)/);
  assert.match(source, /renderAt\(0\);\s*play\(\);/);
  assert.match(source, /decodeImageBitmap\(file/);
  assert.match(source, /imageRequest\.isCurrent\(requestToken\)/);
  assert.match(source, /projectInput\.addEventListener\("change"[\s\S]*?imageRequest\.begin\(\)/);
  assert.match(source, /get: \(assetId\) => project\.layers\.some\(\(layer\) => layer\.assetId === assetId\) \? imageSource : null/);
  assert.doesNotMatch(source, /project\.layers\[0\]\.assetId\s*=\s*["']photo-1/);
  assert.match(source, /bitmap\.close/);
  assert.doesNotMatch(source, /createCameraTrack|sampleCameraTrack|createTimeline/);
});
