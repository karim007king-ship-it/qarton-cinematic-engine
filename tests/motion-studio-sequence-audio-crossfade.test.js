import assert from "node:assert/strict";
import test from "node:test";
import { compileStudioSequenceV2, createStudioSequenceAudioCrossfadeEngine, createStudioSequenceV2 } from "../packages/motion-studio/index.js";

const viewport = { width: 2, height: 2, fps: 30 };
const image = { id: "poster", kind: "image", name: "poster.png", mimeType: "image/png", size: 4 };
const sound = { id: "tone", kind: "audio", name: "tone.wav", mimeType: "audio/wav", size: 32 };
function audioScene(id, durationMs = 1000, tracks = []) {
  return { id, project: { version: 1, durationMs, viewport, layers: [{ id: `layer-${id}`, assetId: image.id, z: 0 }] }, audioTracks: tracks };
}
function music(id, { asset = sound.id, startMs = 0, durationMs = 1000, volume = 1, trackVolume = 1, loop = false, type = "music" } = {}) {
  return { id: `track-${id}`, type, volume: trackVolume, clips: [{ id, asset, startMs, durationMs, volume, ...(type === "dialogue" ? { language: "ar" } : {}), loop }] };
}
function compile({ scenes, transitions = [] }) {
  return compileStudioSequenceV2(createStudioSequenceV2({ viewport, scenes, assets: [image, sound], transitions }));
}

class FakeParam {
  constructor() { this.value = 1; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(["set", value, time]); }
  setValueCurveAtTime(values, time, duration) { this.events.push(["curve", [...values], time, duration]); this.value = values.at(-1); }
  linearRampToValueAtTime(value, time) { this.events.push(["ramp", value, time]); this.value = value; }
  cancelScheduledValues(time) { this.events.push(["cancel", time]); }
}
class FakeNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.gain = new FakeParam(); }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections.length = 0; this.context.disconnects++; }
}
class FakeSource extends FakeNode {
  constructor(context) { super(context, "source"); this.calls = []; this.loop = false; this.onended = null; this.buffer = null; }
  start(...args) { this.calls.push(["start", ...args]); }
  stop(...args) { this.calls.push(["stop", ...args]); }
}
class FakeAudioContext {
  constructor() { this.currentTime = 1; this.destination = new FakeNode(this, "destination"); this.sources = []; this.gains = []; this.disconnects = 0; }
  createGain() { const node = new FakeNode(this, "gain"); this.gains.push(node); return node; }
  createBufferSource() { const node = new FakeSource(this); this.sources.push(node); return node; }
}
function buffer({ duration = 2, channels = 1, peak = 1 } = {}) {
  const channel = new Float32Array(Math.round(duration * 48000)).fill(peak);
  return { duration, length: channel.length, numberOfChannels: channels, getChannelData: () => channel };
}

test("sequence audio keeps local clip time and converts scene offset once, including seek offsets", () => {
  const compiled = compile({ scenes: [audioScene("a", 1000, [music("out")]),
    audioScene("b", 1000, [music("in", { startMs: 100, durationMs: 900 })])],
  transitions: [{ fromSceneId: "a", toSceneId: "b", type: "dissolve", durationMs: 400, audioCrossfadeMs: 200 }] });
  const context = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context, audioBuffers: new Map([[sound.id, buffer()]]) });
  const session = engine.schedule({ epoch: 2, fromMs: 750 });
  assert.deepEqual(session.scheduled.map(item => [item.sceneId, item.localStartMs, item.globalStartMs, item.when, item.offset]), [
    ["a", 0, 0, 2, 0.75], ["b", 100, 700, 2, 0.15]
  ]);
  assert.equal(context.sources.length, 2);
  assert.ok(Math.abs(engine.sample(800).gains[0].gain - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(engine.sample(800).gains[1].gain - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(engine.sample(800), engine.sample(800), "seek/replay sampling is absolute and deterministic");
  session.stop();
  assert.equal(session.stopped, true);
  engine.dispose();
});

test("Cut, zero audio windows, and visual-longer-than-audio windows have deterministic boundaries", () => {
  const cut = compile({ scenes: [audioScene("left", 1000, [music("left")]), audioScene("right", 1000, [music("right")])],
    transitions: [{ fromSceneId: "left", toSceneId: "right", type: "cut", durationMs: 0, audioCrossfadeMs: 0 }] });
  const ctx = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(cut, { audioContext: ctx, audioBuffers: { [sound.id]: buffer() } });
  assert.deepEqual(engine.sample(999).gains, [{ sceneId: "left", gain: 1 }]);
  assert.deepEqual(engine.sample(1000).gains, [{ sceneId: "right", gain: 1 }]);
  engine.dispose();

  const fade = compile({ scenes: [audioScene("out", 1000, [music("out")]), audioScene("in", 1000, [music("in")])],
    transitions: [{ fromSceneId: "out", toSceneId: "in", type: "fade", durationMs: 400, audioCrossfadeMs: 0 }] });
  const fadeContext = new FakeAudioContext();
  const fadeEngine = createStudioSequenceAudioCrossfadeEngine(fade, { audioContext: fadeContext, audioBuffers: { [sound.id]: buffer() } });
  assert.deepEqual(fadeEngine.sample(799).gains, [{ sceneId: "out", gain: 1 }, { sceneId: "in", gain: 0 }]);
  assert.deepEqual(fadeEngine.sample(800).gains, [{ sceneId: "out", gain: 0 }, { sceneId: "in", gain: 1 }]);
  const scheduled = fadeEngine.schedule({ epoch: 2 });
  assert.ok(fadeContext.gains.some(node => node.gain.events.some(event => event[0] === "set" && event[1] === 0 && event[2] === 2.8)));
  scheduled.stop(); fadeEngine.dispose();

  const shortWindow = compile({ scenes: [audioScene("a", 1000, [music("a")]), audioScene("b", 1000, [music("b")])],
    transitions: [{ fromSceneId: "a", toSceneId: "b", type: "dissolve", durationMs: 400, audioCrossfadeMs: 100 }] });
  const shortContext = new FakeAudioContext();
  const shortEngine = createStudioSequenceAudioCrossfadeEngine(shortWindow, { audioContext: shortContext, audioBuffers: { [sound.id]: buffer() } });
  const shortSession = shortEngine.schedule({ epoch: 2 });
  const curves = shortContext.gains.map(node => node.gain.events.find(event => event[0] === "curve")).filter(Boolean);
  assert.equal(curves.length, 2);
  assert.ok(curves.every(event => Math.abs(event[3] - 0.1) < 1e-9));
  assert.ok(curves.every(event => Math.abs(event[2] - 2.75) < 1e-9), "100 ms window is centered in the 400 ms transition");
  shortSession.stop(); shortEngine.dispose();
});

test("overlapping dialogue, music and effects retain levels and receive conservative peak headroom", () => {
  const scene = audioScene("mix", 1000, [
    music("dialogue", { type: "dialogue", volume: 0.6, trackVolume: 0.8 }),
    music("bed", { type: "music", volume: 0.3, trackVolume: 0.5, loop: true }),
    music("impact", { type: "sfx", volume: 1, trackVolume: 0.4 })
  ]);
  const compiled = compile({ scenes: [scene] });
  const ctx = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: ctx, audioBuffers: { [sound.id]: buffer() }, masterVolume: 0.75 });
  assert.equal(engine.diagnostics.clipCount, 3);
  assert.equal(engine.diagnostics.peakBound, 0.48 + 0.15 + 0.4);
  assert.ok(engine.diagnostics.safeHeadroom < 1);
  const scheduled = engine.schedule({ epoch: 2 });
  assert.equal(scheduled.scheduled.length, 3);
  assert.ok(scheduled.scheduled.every(item => item.gain <= 0.75));
  scheduled.stop(); engine.dispose();
});

test("consecutive transitions and overlapping clips schedule on one shared AudioContext", () => {
  const compiled = compile({ scenes: [audioScene("a", 1000, [music("a")]), audioScene("b", 1000, [music("b")]),
    audioScene("c", 1000, [music("c")])], transitions: [
    { fromSceneId: "a", toSceneId: "b", type: "dissolve", durationMs: 200, audioCrossfadeMs: 100 },
    { fromSceneId: "b", toSceneId: "c", type: "fade", durationMs: 200, audioCrossfadeMs: 100 }
  ] });
  assert.equal(compiled.durationMs, 2600);
  const ctx = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: ctx, audioBuffers: { [sound.id]: buffer() } });
  const first = engine.schedule({ epoch: 2 });
  const second = engine.schedule({ epoch: 4, fromMs: 1300 });
  assert.equal(first.stopped, true, "rescheduling retires the prior voices before seeking");
  assert.equal(ctx.sources.length, 5);
  assert.equal(second.scheduled[0].sceneId, "b");
  assert.ok(second.scheduled.some(item => item.sceneId === "c"));
  assert.equal(engine.sample(950).gains.length, 2);
  assert.equal(engine.sample(1050).gains.length, 1, "adjacent transitions do not create a triple-scene mix");
  first.stop(); second.stop(); engine.dispose();
});

test("silence, cancellation, and scheduling failures release every created node", () => {
  const silent = compile({ scenes: [audioScene("quiet", 500, [])] });
  const ctx = new FakeAudioContext();
  const quietEngine = createStudioSequenceAudioCrossfadeEngine(silent, { audioContext: ctx, audioBuffers: {} });
  assert.equal(quietEngine.schedule({ epoch: 2 }).scheduled.length, 0);
  quietEngine.dispose();
  assert.ok(ctx.disconnects >= 2);

  const compiled = compile({ scenes: [audioScene("a", 1000, [music("a")])] });
  const controller = new AbortController();
  const abortContext = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: abortContext,
    audioBuffers: { [sound.id]: buffer() }, signal: controller.signal });
  const session = engine.schedule({ epoch: 2 });
  controller.abort();
  assert.equal(session.stopped, true);
  assert.throws(() => engine.schedule({ epoch: 3 }), /disposed/u);
  assert.ok(abortContext.disconnects >= 5);

  const failedContext = new FakeAudioContext();
  const failingEngine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: failedContext,
    audioBuffers: { [sound.id]: buffer() } });
  failedContext.createBufferSource = () => { throw new Error("source allocation failed"); };
  assert.throws(() => failingEngine.schedule({ epoch: 2 }), /source allocation failed/u);
  assert.ok(failedContext.disconnects >= 3);
  failingEngine.dispose();
});
