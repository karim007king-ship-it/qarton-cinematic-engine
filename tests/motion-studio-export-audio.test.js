import assert from "node:assert/strict";
import test from "node:test";
import { planExport } from "../packages/motion-studio/export/export-plan.js";
import { prepareAudioMix } from "../packages/motion-studio/export/audio-mix.js";

function makePlan({ tracks, info, range = { startMs: 0, endMs: 10_000 }, master = 1 } = {}) {
  const project = { version: 1, durationMs: 10_000, viewport: { width: 720, height: 1280, fps: 24 }, layers: [] };
  const assets = [...new Set(tracks.flatMap(track => track.clips.map(clip => clip.asset)))].map(id => ({ id, name: `${id}.wav`, type: "audio/wav", size: 200 }));
  const capabilities = [{ verification: "verified", mimeType: "video/webm;codecs=vp8,opus", width: 720, height: 1280, fps: 24, audioMode: "mix" }];
  return planExport({ project, audioTracks: tracks, audioAssets: assets, audioAssetInfo: info, audioMasterVolume: master }, { range }, capabilities);
}

class FakeNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.gain = { value: 1, events: [], setValueAtTime: (value, at) => this.gain.events.push(["set", value, at]), linearRampToValueAtTime: (value, at) => this.gain.events.push(["ramp", value, at]) }; }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
}
class FakeSource extends FakeNode {
  constructor(context) { super(context, "source"); this.calls = []; this.loop = false; }
  start(...args) { this.calls.push(["start", ...args]); }
  stop(...args) { this.calls.push(["stop", ...args]); }
}
class FakeAudioContext {
  constructor() { this.state = "running"; this.currentTime = 2; this.sources = []; this.gains = []; this.decodeCalls = []; this.destination = null; }
  async decodeAudioData(bytes) {
    this.decodeCalls.push(bytes.byteLength);
    return this.makeBuffer();
  }
  makeBuffer() { return { length: 48_000, numberOfChannels: 2, sampleRate: 48_000, duration: 1, getChannelData: () => ({ fill() {} }) }; }
  createMediaStreamDestination() {
    this.destination = new FakeNode(this, "destination");
    this.audioTrack = { stopped: false, stop() { this.stopped = true; } };
    this.destination.stream = { getAudioTracks: () => [this.audioTrack], getTracks: () => [this.audioTrack] };
    return this.destination;
  }
  createGain() { const node = new FakeNode(this, "gain"); this.gains.push(node); return node; }
  createBufferSource() { const source = new FakeSource(this); this.sources.push(source); return source; }
}

const tracks = [
  { id: "music-a", type: "music", volume: 0.5, clips: [
    { id: "loop", asset: "shared", startMs: 1000, durationMs: 6000, volume: 0.8, loop: true },
    { id: "one-shot", asset: "shared", startMs: 3000, durationMs: 3000, volume: 0.4, loop: false }
  ] },
  { id: "sfx", type: "sfx", volume: 0.75, clips: [
    { id: "hit", asset: "hit", startMs: 4500, durationMs: 1000, volume: 1 }
  ] }
];
const assetInfo = ["shared", "hit"].map(id => ({ id, durationMs: 2000, channels: 2, sampleRate: 48_000 }));

test("local audio assets decode once and overlapping clips schedule at exact range offsets on one epoch", async () => {
  const plan = makePlan({ tracks, info: assetInfo, range: { startMs: 2000, endMs: 7000 }, master: 0.8 });
  const context = new FakeAudioContext();
  let resolved = 0;
  const mixer = await prepareAudioMix(plan, { audioContext: context, resolveAudio: async id => { resolved++; return new Blob([id]); } });
  assert.equal(resolved, 2);
  assert.equal(context.decodeCalls.length, 2);
  assert.equal(mixer.stream.getAudioTracks().length, 1);
  const scheduled = mixer.schedule(2.2);
  assert.deepEqual(scheduled.map(item => [item.clipId, item.when, item.endAt, item.offset, item.loop]), [
    ["loop", 2.2, 7.2, 0, true], ["one-shot", 3.2, 6.2, 0, false], ["hit", 4.7, 5.7, 0, false]
  ]);
  assert.equal(context.sources.length, 3);
  assert.deepEqual(context.gains.find(node => node.gain.events.length === 5).gain.events.slice(1, 3), [["set", 0, 2.2], ["ramp", 0.8, 2.205]]);
  assert.equal(mixer.decodedBytes, 2 * 48_000 * 2 * 4);
  assert.ok(plan.headroomGain < 1);
  mixer.stop();
  mixer.stop();
  assert.equal(context.destination.connections.length, 0);
  assert.ok(context.sources.every(source => source.connections.length === 0));
});

test("music loop offsets wrap to the source duration while one-shot clips preserve source position", async () => {
  const looping = [{ id: "music", type: "music", clips: [
    { id: "loop", asset: "tone", startMs: 0, durationMs: 8000, loop: true },
    { id: "shot", asset: "tone", startMs: 0, durationMs: 8000, loop: false }
  ] }];
  const plan = makePlan({ tracks: looping, info: [{ id: "tone", durationMs: 1000, channels: 2, sampleRate: 48_000 }], range: { startMs: 500, endMs: 1500 } });
  const context = new FakeAudioContext();
  const mix = await prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["tone"]) });
  const scheduled = mix.schedule(3);
  assert.deepEqual(scheduled.map(item => item.offset), [0.5, 0.5]);
  assert.deepEqual(scheduled.map(item => item.loop), [true, false]);
  mix.stop();
});

test("one-shot dialogue is not scheduled when a seek starts after the decoded source ends", async () => {
  const dialogue = [{ id: "dialogue", type: "dialogue", clips: [
    { id: "late", asset: "short", startMs: 0, durationMs: 8000, language: "ar", visemes: [] }
  ] }];
  const plan = makePlan({ tracks: dialogue, info: [{ id: "short", durationMs: 1000, channels: 1, sampleRate: 48_000 }], range: { startMs: 3000, endMs: 5000 } });
  const context = new FakeAudioContext();
  const mix = await prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["voice"]) });
  assert.deepEqual(mix.schedule(3), []);
  assert.equal(context.sources.length, 0);
  mix.stop();
});

test("missing or undecodable local sources fail preflight preparation with typed errors", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  await assert.rejects(prepareAudioMix(plan, { audioContext: new FakeAudioContext(), resolveAudio: async () => null }), { code: "ASSET_MISSING" });
  const context = new FakeAudioContext();
  context.decodeAudioData = async () => { throw new Error("corrupt fixture"); };
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["bad"]) }), { code: "DECODE_FAILED" });
});

test("audio decode that never settles fails within its bounded preparation window", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  const context = new FakeAudioContext();
  context.decodeAudioData = () => new Promise(() => {});
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["shared"]) },
    { decodeTimeoutMs: 10 }), { code: "DECODE_FAILED" });
  assert.equal(context.destination, null);
});

test("oversized compressed assets are rejected before reading or decoding", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  const context = new FakeAudioContext();
  let readCount = 0;
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => ({
    size: 20 * 1024 * 1024 + 1,
    arrayBuffer: async () => { readCount++; return new ArrayBuffer(0); }
  }) }), { code: "BUDGET_EXCEEDED" });
  assert.equal(readCount, 0, "budget is enforced before Blob.arrayBuffer allocates a compressed copy");
  assert.deepEqual(context.decodeCalls, []);
  assert.equal(context.destination, null);
});

test("compressed inputs share a bounded budget across unique assets", async () => {
  const twoAssets = [{ id: "music", type: "music", clips: [
    { id: "first", asset: "first", startMs: 0, durationMs: 1000 },
    { id: "second", asset: "second", startMs: 1000, durationMs: 1000 }
  ] }];
  const info = ["first", "second"].map(id => ({ id, durationMs: 1000, channels: 1, sampleRate: 48_000 }));
  const plan = makePlan({ tracks: twoAssets, info });
  const context = new FakeAudioContext();
  let readCount = 0;
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async id => ({
    size: id === "first" ? 12 * 1024 * 1024 : 9 * 1024 * 1024,
    arrayBuffer: async () => { readCount++; return new ArrayBuffer(id === "first" ? 12 * 1024 * 1024 : 9 * 1024 * 1024); }
  }) }), { code: "BUDGET_EXCEEDED" });
  assert.equal(readCount, 1, "the second asset is rejected before allocating its encoded copy");
  assert.equal(context.decodeCalls.length, 1);
  assert.equal(context.destination, null);
});

test("corrupt assets release already decoded PCM and do not create output nodes", async () => {
  const twoAssets = [{ id: "music", type: "music", clips: [
    { id: "first", asset: "first", startMs: 0, durationMs: 1000 },
    { id: "broken", asset: "broken", startMs: 1000, durationMs: 1000 }
  ] }];
  const info = ["first", "broken"].map(id => ({ id, durationMs: 1000, channels: 1, sampleRate: 48_000 }));
  const plan = makePlan({ tracks: twoAssets, info });
  const context = new FakeAudioContext();
  let releasedSamples = 0;
  context.makeBuffer = () => ({ length: 48_000, numberOfChannels: 1, sampleRate: 48_000, duration: 1,
    getChannelData: () => ({ fill: () => { releasedSamples++; } }) });
  context.decodeAudioData = async bytes => {
    context.decodeCalls.push(bytes.byteLength);
    if (new Uint8Array(bytes)[0] === 0) throw new Error("corrupt audio");
    return context.makeBuffer();
  };
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async id => new Blob([id === "broken" ? "\0" : "valid"]) }),
    { code: "DECODE_FAILED" });
  assert.equal(releasedSamples, 1, "previously decoded PCM is discarded after a later asset fails");
  assert.equal(context.destination, null);
  assert.equal(context.gains.length, 0);
});

test("decoded PCM is checked against the exact budget and discarded on overflow", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [{ id: "shared", durationMs: 100, channels: 1, sampleRate: 48_000 }] });
  const context = new FakeAudioContext();
  let releasedSamples = 0;
  context.makeBuffer = () => ({ length: 8_388_609, numberOfChannels: 1, sampleRate: 48_000, duration: 175,
    getChannelData: () => ({ fill: () => { releasedSamples++; } }) });
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["valid"]) }),
    { code: "BUDGET_EXCEEDED" });
  assert.equal(releasedSamples, 1);
  assert.equal(context.destination, null);
});

test("late decode completion after timeout is consumed and discarded", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  const context = new FakeAudioContext();
  let releasedSamples = 0;
  context.decodeAudioData = () => new Promise(resolve => setTimeout(() => resolve({ length: 48_000, numberOfChannels: 1,
    sampleRate: 48_000, duration: 1, getChannelData: () => ({ fill: () => { releasedSamples++; } }) }), 30));
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["valid"]) },
    { decodeTimeoutMs: 5 }), { code: "DECODE_FAILED" });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(releasedSamples, 1);
  assert.equal(context.destination, null);
});

test("repeated prepare and cancel cycles stop tracks and release each decoded buffer", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  const contexts = [];
  for (let index = 0; index < 5; index++) {
    const context = new FakeAudioContext();
    let releasedSamples = 0;
    context.makeBuffer = () => ({ length: 48_000, numberOfChannels: 1, sampleRate: 48_000, duration: 1,
      getChannelData: () => ({ fill: () => { releasedSamples++; } }) });
    const mix = await prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => new Blob(["valid"]) });
    mix.schedule(3);
    mix.stop();
    mix.stop();
    contexts.push({ context, releasedSamples });
  }
  assert.ok(contexts.every(({ context }) => context.audioTrack.stopped));
  assert.ok(contexts.every(({ releasedSamples }) => releasedSamples === 1));
  assert.ok(contexts.every(({ context }) => context.sources.every(source => source.connections.length === 0)));
});

test("aborting during local audio resolution prevents later decode and exposes no destination", async () => {
  const plan = makePlan({ tracks: [tracks[0]], info: [assetInfo[0]] });
  const controller = new AbortController();
  const context = new FakeAudioContext();
  await assert.rejects(prepareAudioMix(plan, { audioContext: context, resolveAudio: async () => {
    controller.abort(); return new Blob(["shared"]);
  } }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(context.decodeCalls.length, 0);
  assert.equal(context.destination, null);
});

test("audio disabled does not require a Web Audio context or emit a track", async () => {
  const plan = { audio: "none" };
  const mix = await prepareAudioMix(plan);
  assert.equal(mix.stream, null);
  assert.deepEqual(mix.schedule(0), undefined);
  mix.stop();
});
