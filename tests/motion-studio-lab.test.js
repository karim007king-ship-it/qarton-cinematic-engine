import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MAX_DURATION_MS, MIN_DURATION_MS, createRequestToken, makeProject, makeProjectFile, parseProjectFile,
  playbackTimeMs, prepareProjectUpdate, setCameraEndpoints, VIEWPORT
} from "../examples/motion-studio-lab/studio-model.js";
import { decodeImageBitmap, IMAGE_DECODE_WIDTHS, MAX_PREVIEW_PIXELS } from "../examples/motion-studio-lab/studio-image.js";
import { ASPECT_PRESETS, imageRect, inferAspectPreset, projectSizeForPreset, safePreviewSize } from "../examples/motion-studio-lab/studio-dimensions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("mobile interface exposes portrait preview, image input, camera controls and timeline", async () => {
  const html = await readFile(resolve(root, "examples/motion-studio-lab/index.html"), "utf8");
  for (const id of ["stage", "imageInput", "aspectPreset", "fitMode", "viewportValue", "duration", "startZoom", "endZoom", "startX", "endX", "startY", "endY", "seek", "playPauseButton", "replayButton", "saveProjectButton", "loadProjectButton", "exportFormat", "exportDuration", "exportQuality", "exportAudioEnabled", "exportButton", "cancelExportButton", "tryWebmButton", "exportProgress", "exportVideo", "exportDownload", "exportMetadata", "integratedFrom", "integratedTo", "integratedQuality", "integratedFormat", "integratedAudio", "integratedMissingAudio", "integratedProbeButton", "integratedExportButton", "integratedProgress", "integratedVideo", "integratedDownload"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing interface control ${id}`);
  }
  for (const id of ["characterTimelineLane", "characterTimelineMarkers", "addCharacterKeyframe", "deleteCharacterKeyframe", "characterTimelinePlayhead"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing Character Track control ${id}`);
  }
  for (const channel of ["headRotation", "eyeX", "eyeY", "blink", "mouthOpen", "bodyRotation", "expression", "gesture"]) {
    assert.match(html, new RegExp(`data-character-channel=["']${channel}["']`));
  }
  assert.match(html, /width="720" height="1280"/);
  assert.match(html, /value="original" selected/);
  assert.match(html, /value="fit" selected/);
  assert.match(html, /<h2 id="exportHeading">تصدير الفيديو · L5<\/h2>/);
  assert.match(html, /<h2 id="integratedExportHeading">تصدير جميع المشاهد · L11-E<\/h2>/);
  assert.match(html, /value="mp4"/);
  assert.match(html, /value="webm"/);
  assert.match(html, /viewport" content="width=device-width, initial-scale=1/);
});

test("L11-F2 Android workspace expands the preview and keeps file and scene controls accessible", async () => {
  const html = await readFile(resolve(root, "examples/motion-studio-lab/index.html"), "utf8");
  const css = await readFile(resolve(root, "examples/motion-studio-lab/studio.css"), "utf8");
  const script = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0,\s*1\.1fr\) minmax\(0,\s*\.9fr\) auto/,
    "mobile preview receives 55 percent of the height shared with the tools");
  assert.match(css, /\.preview-canvas-host\s*\{[^}]*grid-template-rows:\s*44px minmax\(0,\s*1fr\)/,
    "the title row is compact and the Canvas gets the remaining preview height");
  assert.match(css, /\.stage-wrap\s*\{\s*padding-top:\s*0\s*;/,
    "the Canvas has no reserved blank strip below the preview title");
  assert.match(css, /\.sr-only\s*\{[^}]*clip-path:\s*inset\(50%\)/,
    "native file inputs use a real screen-reader-only treatment");
  assert.match(css, /\.studio\[data-image-ready="true"\]\s+#previewImagePicker\s*\{\s*display:\s*none/,
    "image picker is removed from the preview after media loads");
  assert.match(html, /id="moveSceneLeftButton"/);
  assert.match(html, /id="moveSceneRightButton"/);
  assert.match(html, /data-motion-preset="zoom-in"[^>]*>[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /data-motion-preset="zoom-out"[^>]*>[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(script, /studioRoot\.dataset\.imageReady = String\(Boolean\(currentFileInfo\)\)/);
  const errors = await readFile(resolve(root, "examples/motion-studio-lab/studio-errors.js"), "utf8");
  assert.match(script, /import\s*\{\s*errorText,\s*setExportErrorMessage\s*\}\s*from\s*"\.\/studio-errors\.js"/);
  assert.match(errors, /"عرض التفاصيل التقنية"/);
  assert.match(errors, /"توقفت ساعة التصدير أو تأخرت الإطارات\./);
  assert.doesNotMatch(script, /scene-card-controls/,
    "scene duplicate, delete and reorder actions are presented in the Scenes section, not on the preview strip");
});

test("project model defaults to the legacy portrait viewport, accepts supported sizes and enforces duration", () => {
  const project = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.4, startX: 0, endX: 28, startY: 0, endY: -18 });
  assert.deepEqual(project.viewport, VIEWPORT);
  assert.equal(project.durationMs, 12000);
  assert.deepEqual(project.camera.map((key) => key.atMs), [0, 12000]);
  assert.deepEqual(project.camera[1].value, { x: 28, y: -18, zoom: 1.4, rotation: 0 });
  assert.equal(MIN_DURATION_MS, 3000);
  assert.equal(MAX_DURATION_MS, 60000);
  assert.throws(() => makeProject({ durationMs: 2999 }), RangeError);
  assert.throws(() => makeProject({ durationMs: 60001 }), RangeError);
  const landscape = makeProject({ durationMs: 12000, viewport: { width: 1920, height: 1080, fps: 24 }, startZoom: 1, endZoom: 1.2, startX: 0, endX: 10, startY: 0, endY: 0 });
  assert.deepEqual(landscape.viewport, { width: 1920, height: 1080, fps: 24 });
  assert.throws(() => makeProject({ durationMs: 12000, viewport: { width: 4096, height: 4096, fps: 24 } }), RangeError);
});

test("aspect presets retain their ratios and phone previews stay within a pixel budget", () => {
  assert.deepEqual(ASPECT_PRESETS.map(({ value }) => value), ["original", "square", "portrait", "landscape", "post", "classic-landscape", "classic-portrait"]);
  const ratios = { square: 1, portrait: 9 / 16, landscape: 16 / 9, post: 4 / 5, "classic-landscape": 4 / 3, "classic-portrait": 3 / 4 };
  for (const [preset, ratio] of Object.entries(ratios)) {
    const size = projectSizeForPreset(preset);
    assert.ok(Math.abs(size.width / size.height - ratio) < 0.001, preset);
    const preview = safePreviewSize(size.width, size.height);
    assert.ok(preview.width * preview.height <= 921_600);
    assert.ok(Math.max(preview.width, preview.height) <= 1280);
  }
  assert.equal(inferAspectPreset(720, 1280), "portrait");
  assert.equal(projectSizeForPreset("original", 3000, 2000).width / projectSizeForPreset("original", 3000, 2000).height, 1.5);
});

test("Fit contains all image bounds while Fill covers the frame and crops as needed", () => {
  const fit = imageRect(1600, 900, 900, 1600, "fit");
  assert.equal(fit.width, 900);
  assert.equal(fit.height, 506.25);
  const fill = imageRect(1600, 900, 900, 1600, "fill");
  assert.equal(fill.width, 2844.4444444444443);
  assert.equal(fill.height, 1600);
  assert.ok(fill.x < 0);
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
  assert.deepEqual(decoded.settings, { aspectPreset: "original", fitMode: "fit" });
  assert.ok(encoded.length < 4000);
  assert.throws(() => parseProjectFile("not json"), /JSON/);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: "unknown", version: 1, project, image: null })), TypeError);
  assert.throws(() => parseProjectFile(" ".repeat(128 * 1024 + 1)), RangeError);
});

test("project JSON persists flexible dimensions and fit mode while loading legacy files", () => {
  const project = makeProject({ durationMs: 9000, viewport: { width: 1920, height: 1080, fps: 24 }, startZoom: 1, endZoom: 1.4, startX: 0, endX: 42, startY: 0, endY: -21 });
  const encoded = JSON.stringify(makeProjectFile(project, null, { aspectPreset: "landscape", fitMode: "fill" }));
  const loaded = parseProjectFile(encoded);
  assert.deepEqual(loaded.project.viewport, { width: 1920, height: 1080, fps: 24 });
  assert.deepEqual(loaded.settings, { aspectPreset: "landscape", fitMode: "fill" });

  const legacy = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.2, startX: 0, endX: 0, startY: 0, endY: 0 });
  const legacyFile = makeProjectFile(legacy);
  delete legacyFile.settings;
  const legacyLoaded = parseProjectFile(JSON.stringify(legacyFile));
  assert.deepEqual(legacyLoaded.project.viewport, VIEWPORT);
  assert.equal(legacyLoaded.settings, null);
});

test("JSON import preserves multiple camera keyframes and rejects displaced endpoints only by strict key validation", () => {
  const project = makeProject({ durationMs: 6000, startZoom: 1, endZoom: 1.2, startX: 0, endX: 0, startY: 0, endY: 0 });
  const withMiddleKey = structuredClone(project);
  withMiddleKey.camera.splice(1, 0, { atMs: 3000, value: { x: 12, y: 0, zoom: 1.1, rotation: 0 } });
  const file = (value) => JSON.stringify(makeProjectFile(value));
  assert.deepEqual(parseProjectFile(file(withMiddleKey)).project.camera, withMiddleKey.camera);
  const displaced = structuredClone(project);
  displaced.camera[1].atMs = 5000;
  assert.deepEqual(parseProjectFile(file(displaced)).project.camera, displaced.camera);
  const outOfRange = structuredClone(project);
  outOfRange.camera[1].atMs = 6001;
  assert.throws(() => parseProjectFile(file(outOfRange)), /غير صالحة/);
  const duplicate = structuredClone(project);
  duplicate.camera[1].atMs = 0;
  assert.throws(() => parseProjectFile(file(duplicate)), /غير صالحة/);
});

test("legacy start/end controls preserve intermediate imported keyframes and reject truncation that would lose one", () => {
  const project = makeProject({ durationMs: 9000, startZoom: 1, endZoom: 1.4, startX: 0, endX: 80, startY: 0, endY: 30 });
  project.camera.splice(1, 0, { atMs: 4200, value: { x: 25, y: 8, zoom: 1.2, rotation: 10 } });
  const updated = setCameraEndpoints(project, {
    durationMs: 9000,
    start: { x: -5, y: 2, zoom: 0.9 },
    end: { x: 90, y: -12, zoom: 1.6 }
  });
  assert.deepEqual(updated.camera.map(({ atMs }) => atMs), [0, 4200, 9000]);
  assert.deepEqual(updated.camera[1].value, project.camera[1].value);
  assert.deepEqual(updated.camera[0].value, { x: -5, y: 2, zoom: 0.9, rotation: 0 });
  assert.deepEqual(updated.camera[2].value, { x: 90, y: -12, zoom: 1.6, rotation: 0 });
  assert.deepEqual(project.camera.map(({ atMs }) => atMs), [0, 4200, 9000], "source JSON remains unchanged");
  assert.throws(() => setCameraEndpoints(project, {
    durationMs: 4000, start: { x: 0, y: 0, zoom: 1 }, end: { x: 0, y: 0, zoom: 1 }
  }), /Keyframe وسيطًا سيصل إلى نقطة النهاية/);
});

test("project control and duration updates preserve multi-key tracks and reject lossy truncation", () => {
  const source = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.5, startX: 0, endX: 90, startY: 0, endY: -60 });
  const project = structuredClone(source);
  project.camera.splice(1, 0,
    { atMs: 4000, value: { x: 20, y: 8, zoom: 1.2, rotation: 4 } },
    { atMs: 8000, value: { x: 55, y: -20, zoom: 1.35, rotation: -8 } });
  const prepare = (candidate) => structuredClone(candidate);
  const changed = prepareProjectUpdate(project, {
    durationMs: 12000, viewport: { ...project.viewport, width: 1000 },
    start: { x: 0, y: 0, zoom: 0.9 }, end: { x: 90, y: -60, zoom: 1.5 },
    editedControl: "startZoom", prepare
  });
  assert.deepEqual(changed.project.camera.map(({ atMs }) => atMs), [0, 4000, 8000, 12000]);
  assert.equal(changed.project.camera[0].value.zoom, 0.9);
  assert.deepEqual(changed.project.camera.slice(1).map(({ value }) => value), project.camera.slice(1).map(({ value }) => value));
  assert.deepEqual(changed.prepared.camera, changed.project.camera);
  const shortened = prepareProjectUpdate(project, {
    durationMs: 9000, viewport: project.viewport,
    start: project.camera[0].value, end: project.camera.at(-1).value, prepare
  });
  assert.deepEqual(shortened.project.camera.map(({ atMs }) => atMs), [0, 4000, 8000, 9000]);
  assert.deepEqual(project.camera.map(({ atMs }) => atMs), [0, 4000, 8000, 12000]);
  assert.throws(() => prepareProjectUpdate(project, {
    durationMs: 7000, viewport: project.viewport,
    start: project.camera[0].value, end: project.camera.at(-1).value, prepare
  }), /Keyframe وسيطًا/);
  assert.deepEqual(project.camera.map(({ atMs }) => atMs), [0, 4000, 8000, 12000], "rejected update retains original keys");
});

test("browser module uses the engine sampling API and includes deterministic seek and replay paths", async () => {
  const source = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  const timeline = await readFile(resolve(root, "examples/motion-studio-lab/studio-timeline.js"), "utf8");
  const characterTimeline = await readFile(resolve(root, "examples/motion-studio-lab/studio-character-timeline.js"), "utf8");
  assert.match(source, /import \{[^}]*compileProject[^}]*sampleFrame[^}]*\} from "@qarton\/cinematic-engine\/motion-studio"/);
  assert.match(source, /seek\.addEventListener\("input"/);
  assert.match(source, /function replay\(\)/);
  assert.match(source, /async function replay\(\)[\s\S]*?captureCurrentScene\(\)[\s\S]*?const first = sequenceEditor\.scenes\[0\][\s\S]*?globalTimeMs: 0, localTimeMs: 0[\s\S]*?sequenceTimeMs = 0[\s\S]*?await play\(\)/,
    "Replay captures the active scene before seeking so recent timeline edits survive the sequence reset");
  assert.match(source, /decodeImageBitmap\(file/);
  assert.match(source, /imageRequest\.isCurrent\(requestToken\)/);
  assert.match(source, /projectInput\.addEventListener\("change"[\s\S]*?imageRequest\.begin\(\)/);
  assert.match(source, /get: \(assetId\) => sceneImageSources\.get\(assetId\) \?\? \(project\.layers\.some\(\(layer\) => layer\.assetId === assetId\) \? imageSource : null\)/);
  assert.match(source, /for \(const layer of project\.layers\) sceneImageSources\.set\(layer\.assetId, prepared\.surface\)/,
    "Fit and Fill redraws refresh the cached scene asset used by the renderer");
  assert.match(source, /const imageSettings = sceneImageSettings\(sceneId\);[\s\S]*?aspectPreset = imageSettings\.aspectPreset;[\s\S]*?fitMode = imageSettings\.fitMode/,
    "scene activation restores the scene-local Fit and aspect settings before decoding its image");
  assert.doesNotMatch(source, /project\.layers\[0\]\.assetId\s*=\s*["']photo-1/);
  assert.match(source, /bitmap\.close/);
  assert.doesNotMatch(source, /createCameraTrack|sampleCameraTrack|createTimeline/);
  assert.match(source, /createStudioTimeline/);
  const renderer = await readFile(resolve(root, "examples/motion-studio-lab/studio-scene-renderer.js"), "utf8");
  assert.match(renderer, /sampleFrame\(compiledProject, timeMs\)/);
  assert.match(source, /drawStudioScene\(\{ ctx: context, compiledProject: compiled, timeMs: currentMs/);
  assert.match(source, /drawStudioScene\(\{ ctx, compiledProject: exportCompiled, timeMs: projectMs/);
  assert.match(renderer, /characterAnimation\.sample\(timeMs\)/);
  assert.match(renderer, /drawCharacterWithCamera\(ctx, pose/);
  assert.match(source, /characterTimeline\?\.setBusy\(busy\)/);
  assert.match(source, /makeProjectFile\(project, currentFileInfo, \{ aspectPreset, fitMode \}, characterTrack, audioTracks, audioAssets, audioMasterVolume, visualEffectsTrack\)/);
  assert.match(characterTimeline, /pointercancel/);
  assert.match(characterTimeline, /lostpointercapture/);
  assert.match(characterTimeline, /moveCharacterKeyframe/);
  assert.match(characterTimeline, /isBusy\(\)/);
  assert.doesNotMatch(source, /pointerdown|pointermove|keyframeDrag/u, "timeline pointer state is isolated in its module");
  for (const api of ["addCameraKeyframe", "updateCameraKeyframe", "moveCameraKeyframe", "deleteCameraKeyframe"]) {
    assert.match(timeline, new RegExp(`${api}\\(`), `timeline must use L6-A ${api}`);
  }
  assert.match(timeline, /pointercancel/);
  assert.match(timeline, /lostpointercapture/);
  assert.match(timeline, /setPointerCapture/);
  assert.match(timeline, /markers\.querySelector\([\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(timeline, /if \(busy\) \{\s*const capturedPointerId = drag\?\.pointerId \?\? scrubPointerId;\s*drag = null;/);
});

test("UI prepares a candidate project before committing the active project and compiled frame", async () => {
  const source = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  const updateIndex = source.indexOf("function updateProject(");
  const prepareIndex = source.indexOf("prepare: (candidate) => compileProject(projectForRaster(candidate, nextPreview)", updateIndex);
  const commitIndex = source.indexOf("project = nextProject;", updateIndex);
  assert.notEqual(prepareIndex, -1);
  assert.notEqual(commitIndex, -1);
  assert.ok(prepareIndex < commitIndex, "candidate compilation runs before the active project is replaced");
  assert.match(source, /project = nextProject;\s*compiled = nextCompiled;/);
});

test("video export uses Motion Studio sampling, cancellation, resource cleanup and real MIME probes", async () => {
  const source = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  const renderer = await readFile(resolve(root, "examples/motion-studio-lab/studio-scene-renderer.js"), "utf8");
  assert.match(source, /compileProject\(projectForRaster\(project, rasterViewport\), imageProvider\)/);
  assert.match(renderer, /drawFrame\(ctx, \{ \.\.\.sampleFrame\(compiledProject, timeMs\), camera: effectSample\.camera \}\)/);
  assert.match(source, /startExport\(plan, host/);
  assert.match(source, /planExport\(snapshot/);
  assert.match(source, /supportedCandidates\(RecorderClass, "mp4"\)/);
  assert.match(source, /supportedCandidates\(RecorderClass, "webm"\)/);
  assert.match(source, /controller\.abort\(abortError\)/);
  assert.match(source, /stream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(source, /audioGraph\.audio\.close\(\)/);
  assert.match(source, /window\.addEventListener\("pagehide"/);
  assert.match(source, /exportFrameTime\(frameIndex, rasterViewport\.fps, exportLengthMs\)/);
  assert.match(source, /presentFrame\(frameIndex\)/);
  assert.match(source, /tryWebmButton\.hidden = !canTryWebm/);
  assert.match(source, /tryWebmButton\.addEventListener\("click"/);
});
