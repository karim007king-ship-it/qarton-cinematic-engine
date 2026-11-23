import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_LIMITS, planExport, rasterForQuality } from "../packages/motion-studio/export/export-plan.js";

const project = (durationMs = 10_000, width = 720, height = 1280, fps = 24) => ({
  version: 1, durationMs, viewport: { width, height, fps }, layers: []
});
const audioTracks = [
  { id: "dialogue", type: "dialogue", volume: 1, clips: [
    { id: "voice-a", asset: "voice", startMs: 1000, durationMs: 4000, volume: 1, language: "ar", visemes: [] }
  ] },
  { id: "music", type: "music", volume: 0.75, clips: [
    { id: "music-a", asset: "music", startMs: 0, durationMs: 10000, volume: 0.5, loop: true }
  ] }
];
const snapshot = (durationMs = 10_000, tracks = audioTracks) => ({
  project: project(durationMs), audioTracks: tracks,
  audioAssets: tracks.flatMap(track => track.clips.map(clip => ({ id: clip.asset, name: `${clip.asset}.wav`, type: "audio/wav", size: 1024 })))
    .filter((asset, i, all) => all.findIndex(item => item.id === asset.id) === i),
  audioAssetInfo: tracks.flatMap(track => track.clips.map(clip => ({
    id: clip.asset, durationMs: clip.asset === "voice" ? 5000 : clip.durationMs,
    channels: clip.asset === "voice" ? 1 : 2, sampleRate: 48_000
  }))).filter((info, i, all) => all.findIndex(item => item.id === info.id) === i),
  audioMasterVolume: 0.8
});
const capabilities = (width = 720, height = 1280, fps = 24, audioMode = "mix") => [
  { verification: "verified", mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", width, height, fps, audioMode },
  { verification: "verified", mimeType: "video/webm;codecs=vp8,opus", width, height, fps, audioMode }
];

test("planning freezes a project snapshot, trims range clips, calculates source offsets, and selects verified MP4", () => {
  const source = snapshot();
  const result = planExport(source, { range: { startMs: 2500, endMs: 6000 } }, capabilities());
  assert.equal(result.durationMs, 3500);
  assert.deepEqual(result.range, { startMs: 2500, endMs: 6000 });
  assert.equal(result.mimeType, capabilities()[0].mimeType);
  assert.deepEqual(result.audioClips.map(clip => [clip.id, clip.startMs, clip.endMs, clip.offsetMs]), [
    ["voice-a", 2500, 5000, 1500], ["music-a", 2500, 6000, 2500]
  ]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.snapshot.project));
  source.project.viewport.width = 360;
  assert.equal(result.snapshot.project.viewport.width, 720);
  assert.equal(result.estimatedPcmBytes, (5000 / 1000 * 1 * 48000 * 4) + (10000 / 1000 * 2 * 48000 * 4));
  assert.ok(result.headroomGain <= 1);
});

test("profile raster preserves aspect, does not upscale, keeps even dimensions, and respects Canvas budget", () => {
  assert.deepEqual(rasterForQuality({ width: 720, height: 1280 }, "720p"), { width: 720, height: 1280 });
  const landscape = rasterForQuality({ width: 1920, height: 1080 }, "480p");
  assert.deepEqual(landscape, { width: 852, height: 480 });
  const small = rasterForQuality({ width: 360, height: 640 }, "1080p");
  assert.deepEqual(small, { width: 360, height: 640 });
  assert.ok(landscape.width % 2 === 0 && landscape.height % 2 === 0);
  assert.ok(landscape.width * landscape.height <= EXPORT_LIMITS.canvasPixels);
});

test("auto falls back to verified WebM and explicit formats never silently switch", () => {
  const caps = capabilities().slice(1);
  assert.match(planExport(snapshot(), {}, caps).mimeType, /^video\/webm/u);
  assert.throws(() => planExport(snapshot(), { format: "mp4" }, caps), { code: "UNSUPPORTED_FORMAT" });
  assert.throws(() => planExport(snapshot(), {}, [{ ...caps[0], verification: "advertised" }]), { code: "UNSUPPORTED_FORMAT" });
  assert.throws(() => planExport(snapshot(), {}, capabilities(360, 640)), { code: "UNSUPPORTED_FORMAT" });
});

test("preflight rejects missing active audio by default and explicitly permits silence with a warning list", () => {
  const value = snapshot();
  value.audioAssetInfo = [];
  assert.throws(() => planExport(value, {}, capabilities()), error => error.code === "ASSET_MISSING" &&
    error.details.assetIds.includes("voice") && error.details.assetIds.includes("music"));
  const silent = planExport(value, { missingAudio: "silence" }, capabilities());
  assert.deepEqual(silent.missingAudioAssetIds, ["voice", "music"]);
  assert.deepEqual(silent.audioClips, []);
  const videoOnly = planExport(value, { audio: "none" }, capabilities(720, 1280, 24, "none"));
  assert.equal(videoOnly.estimatedPcmBytes, 0);
  assert.deepEqual(videoOnly.audioClips, []);
});

test("zero-volume clips preserve scene timing and visemes without allocating decoded PCM", () => {
  const tracks = [{ id: "dialogue", type: "dialogue", volume: 0, clips: [
    { id: "silent-talk", asset: "voice", startMs: 1000, durationMs: 4000, volume: 1, language: "tn",
      visemes: [{ atMs: 500, viseme: "wide" }] }
  ] }];
  const value = snapshot(10_000, tracks);
  value.audioAssets = [{ id: "voice", name: "voice.wav", type: "audio/wav", size: 1024 }];
  value.audioAssetInfo = [{ id: "voice", durationMs: 4000, channels: 1, sampleRate: 48000 }];
  const result = planExport(value, {}, capabilities());
  assert.equal(result.audioClips[0].volume, 0);
  assert.equal(result.estimatedPcmBytes, 0);
  assert.equal(result.audioClips[0].visemes[0].viseme, "wide");
});

test("request validation rejects nonintegral ranges and output/PCM budgets before recording", () => {
  assert.throws(() => planExport(snapshot(), { range: { startMs: 0.5, endMs: 5000 } }, capabilities()), { code: "INVALID_REQUEST" });
  assert.throws(() => planExport(snapshot(), { range: { startMs: 5000, endMs: 5000 } }, capabilities()), { code: "INVALID_REQUEST" });
  assert.throws(() => planExport(snapshot(60_000), { quality: "1080p" }, capabilities(1080, 1920)), { code: "BUDGET_EXCEEDED" });
  const longAudio = snapshot(100_000, [{ id: "music", type: "music", clips: [
    { id: "long", asset: "long", startMs: 0, durationMs: 100_000, loop: true }
  ] }]);
  longAudio.audioAssets = [{ id: "long", name: "long.wav", type: "audio/wav", size: 100 }];
  longAudio.audioAssetInfo = [{ id: "long", durationMs: 100_000, channels: 2, sampleRate: 48_000 }];
  assert.throws(() => planExport(longAudio, { quality: "480p" }, capabilities(480, 852)), error => error.code === "BUDGET_EXCEEDED" && /PCM/u.test(error.message));
});

test("legacy v1 projects without audio metadata remain exportable with empty tracks", () => {
  const legacy = { project: project(), audioTracks: [], audioAssets: [] };
  const result = planExport(legacy, { audio: "none" }, capabilities(720, 1280, 24, "none"));
  assert.equal(result.audioClips.length, 0);
  assert.equal(result.snapshot.audioMasterVolume, 1);
  assert.equal(result.format, "mp4");
});
