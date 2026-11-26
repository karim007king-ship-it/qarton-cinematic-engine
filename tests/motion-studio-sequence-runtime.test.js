import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSequenceV1, createStudioSequenceV2, compileStudioSequenceV2 } from "../packages/motion-studio/index.js";
import { createStudioSequenceRuntime, decodeStudioSequenceAudio } from "../examples/motion-studio-lab/studio-sequence-runtime.js";

const viewport = { width: 360, height: 640, fps: 24 };
const image = { id: "image", kind: "image", name: "image.png", mimeType: "image/png", size: 1 };
const scene = id => ({ id, project: { version: 1, durationMs: 1000, viewport, layers: [{ id: `layer-${id}`, assetId: image.id, z: 0 }] } });
class Surface {
  constructor(width, height) { this.width = width; this.height = height; this.ctx = new Context(this); }
  getContext() { return this.ctx; }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.calls = []; this.globalAlpha = 1; this.globalCompositeOperation = "source-over"; }
  save() {} restore() {} setTransform() {} clearRect() {} fillRect() { this.calls.push("fill"); }
  drawImage(surface) { this.calls.push(surface?.ctx?.calls?.at(-1) ?? "image"); }
}

test("V1 projects migrate to V2 cuts and preserve total duration and absolute samples", () => {
  const v1 = createStudioSequenceV1({ viewport, scenes: [scene("a"), scene("b"), scene("c")], assets: [image] });
  const runtime = createStudioSequenceRuntime(v1, { createSurface: (w, h) => new Surface(w, h) });
  assert.equal(runtime.compiled.kind, "compiled-studio-sequence-v2");
  assert.equal(runtime.durationMs, 3000);
  assert.deepEqual(runtime.compiled.transitions.map(item => item.type), ["cut", "cut"]);
  assert.equal(runtime.sample(1000).scene.id, "b");
  assert.equal(runtime.sample(2000).scene.id, "c");
  runtime.release();
  assert.throws(() => runtime.sample(0), /released/u);
});

test("V2 dissolve composition samples both local clocks on the shared project timestamp", () => {
  const sequence = createStudioSequenceV2({ viewport, scenes: [scene("out"), scene("in")], assets: [image],
    transitions: [{ fromSceneId: "out", toSceneId: "in", type: "dissolve", durationMs: 400, audioCrossfadeMs: 200 }] });
  const compiled = compileStudioSequenceV2(sequence);
  const target = new Context({ width: 360, height: 640 });
  const runtime = createStudioSequenceRuntime(sequence, { createSurface: (w, h) => new Surface(w, h) });
  const drawn = [];
  runtime.draw(target, 800, (_ctx, item, localMs) => drawn.push([item.id, localMs]));
  assert.deepEqual(drawn, [["out", 800], ["in", 200]]);
  assert.equal(runtime.sample(800).transition.type, "dissolve");
  assert.equal(compiled.durationMs, 1600);
  runtime.release();
});

test("audio memory is reserved before decode and late decoder buffers are cleared on cancellation", async () => {
  const sound = { id: "sound", kind: "audio", name: "sound.wav", mimeType: "audio/wav", size: 8 };
  const audioScene = { ...scene("audio"), audioTracks: [{ id: "music-track", type: "music", volume: 1,
    clips: [{ id: "music-clip", asset: sound.id, startMs: 0, durationMs: 1000, volume: 1, loop: true }] }] };
  const sequence = createStudioSequenceV2({ viewport, scenes: [audioScene], assets: [image, sound] });
  const runtime = createStudioSequenceRuntime(sequence);
  let decodeCalls = 0;
  const context = { decodeAudioData: async () => { decodeCalls++; throw new Error("decode must not start"); } };
  await assert.rejects(decodeStudioSequenceAudio(runtime.compiled, { audioContext: context,
    resolveAudio: async () => new Blob(["x"]), audioInfo: [{ id: sound.id, durationMs: 90_000, channels: 2, sampleRate: 48_000 }] }),
  { code: "BUDGET_EXCEEDED" });
  assert.equal(decodeCalls, 0);

  let resolveDecode;
  const samples = new Float32Array(32).fill(0.5);
  const pending = decodeStudioSequenceAudio(runtime.compiled, { audioContext: { decodeAudioData: () => new Promise(resolve => { resolveDecode = resolve; }) },
    resolveAudio: async () => new Blob(["x"]), audioInfo: [{ id: sound.id, durationMs: 1, channels: 1, sampleRate: 48_000 }] });
  await new Promise(resolve => setImmediate(resolve));
  const abort = new AbortController();
  // Start an independent cancelled decode to exercise late AudioBuffer cleanup.
  let resolveLate;
  const lateSamples = new Float32Array(32).fill(0.5);
  const cancelled = decodeStudioSequenceAudio(runtime.compiled, { audioContext: { decodeAudioData: () => new Promise(resolve => { resolveLate = resolve; }) },
    resolveAudio: async () => new Blob(["x"]), audioInfo: [{ id: sound.id, durationMs: 1, channels: 1, sampleRate: 48_000 }], signal: abort.signal });
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  resolveLate({ length: 32, numberOfChannels: 1, duration: 32 / 48_000,
    getChannelData: () => lateSamples });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(lateSamples.every(value => value === 0));
  // Release the non-cancelled unresolved fixture so it does not leave test work behind.
  resolveDecode?.({ length: 32, numberOfChannels: 1, duration: 32 / 48_000,
    getChannelData: () => samples });
  const decoded = await pending;
  decoded.release();
  runtime.release();
});

test("long files retain only the requested range and files outside that range are never decoded", async () => {
  const sound = { id: "long", kind: "audio", name: "long.wav", mimeType: "audio/wav", size: 8 };
  const audioScene = { ...scene("audio"), audioTracks: [{ id: "music-track", type: "music", volume: 1,
    clips: [{ id: "music-clip", asset: sound.id, startMs: 0, durationMs: 1000, volume: 1, loop: false }] }] };
  const unusedScene = { ...scene("unused"), audioTracks: [{ id: "unused-track", type: "sfx", volume: 1,
    clips: [{ id: "unused-clip", asset: "never", startMs: 0, durationMs: 1000, volume: 1 }] }] };
  const sequence = createStudioSequenceV2({ viewport, scenes: [audioScene, unusedScene], assets: [image, sound,
    { id: "never", kind: "audio", name: "never.wav", mimeType: "audio/wav", size: 8 }] });
  const runtime = createStudioSequenceRuntime(sequence);
  const decoded = [];
  const context = {
    decodeAudioData: async () => ({ length: 2_880_000, numberOfChannels: 2, sampleRate: 48_000, duration: 60,
      getChannelData: () => new Float32Array(2_880_000) }),
    createBuffer: (channels, length, sampleRate) => ({ length, numberOfChannels: channels, sampleRate,
      duration: length / sampleRate, getChannelData: () => new Float32Array(length),
      copyToChannel: () => {} })
  };
  const result = await decodeStudioSequenceAudio(runtime.compiled, { audioContext: context,
    resolveAudio: async id => { decoded.push(id); return new Blob(["audio"]); },
    audioInfo: [{ id: "long", durationMs: 60_000, channels: 2, sampleRate: 48_000 },
      { id: "never", durationMs: 60_000, channels: 2, sampleRate: 48_000 }],
    range: { startMs: 0, endMs: 500 } });
  assert.deepEqual(decoded, ["long"]);
  assert.equal(result.buffers.get("long").length, 24_000);
  assert.equal(result.decodedBytes, 24_000 * 2 * 4);
  result.release();
});
