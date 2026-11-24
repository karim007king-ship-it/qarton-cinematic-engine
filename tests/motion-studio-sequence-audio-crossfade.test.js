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
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.gain = new FakeParam(); this.disconnected = false; }
  connect(node) {
    this.context.connects++;
    if (this.context.failConnectAt === this.context.connects) throw new Error(`connect failed ${this.context.connects}`);
    this.connections.push(node);
  }
  disconnect() { this.connections.length = 0; this.disconnected = true; this.context.disconnects++; }
}
class FakeSource extends FakeNode {
  constructor(context) { super(context, "source"); this.calls = []; this.loop = false; this.onended = null; this._buffer = null; }
  get buffer() { return this._buffer; }
  set buffer(value) { if (this.context.failBufferAssignment) throw new Error("source buffer assignment failed"); this._buffer = value; }
  start(...args) { this.calls.push(["start", ...args]); if (this.context.failStart) throw new Error("source start failed"); }
  stop(...args) { this.calls.push(["stop", ...args]); if (this.context.failStop) throw new Error("source stop failed"); }
}
class FakeAudioContext {
  constructor() { this.currentTime = 1; this.destination = new FakeNode(this, "destination"); this.sources = []; this.gains = []; this.nodes = []; this.disconnects = 0; this.connects = 0; this.failConnectAt = 0; this.failGainAt = 0; this.failSource = false; this.failBufferAssignment = false; this.failStart = false; this.failStop = false; }
  createGain() {
    if (this.gains.length + 1 === this.failGainAt) throw new Error(`gain allocation failed ${this.failGainAt}`);
    const node = new FakeNode(this, "gain"); this.gains.push(node); this.nodes.push(node); return node;
  }
  createBufferSource() {
    if (this.failSource) throw new Error("source allocation failed");
    const node = new FakeSource(this); this.sources.push(node); this.nodes.push(node); return node;
  }
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
  const recorderDestination = new FakeNode(context, "media-stream-audio-destination");
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context,
    audioBuffers: new Map([[sound.id, buffer()]]), destination: recorderDestination });
  assert.equal(context.gains[1].connections[0], recorderDestination, "a MediaStreamAudioDestinationNode can be the shared output");
  const session = engine.schedule({ epoch: 2, fromMs: 750.5 });
  assert.deepEqual(session.scheduled.map(item => [item.sceneId, item.localStartMs, item.globalStartMs, item.when, item.offset]), [
    ["a", 0, 0, 2, 0.7505], ["b", 100, 700, 2, 0.0505]
  ]);
  assert.equal(context.sources.length, 2);
  const fractionalProgress = (800.5 - 700) / 200;
  assert.ok(Math.abs(engine.sample(800.5).gains[0].gain - Math.cos(fractionalProgress * Math.PI / 2)) < 1e-12);
  assert.ok(Math.abs(engine.sample(800.5).gains[1].gain - Math.sin(fractionalProgress * Math.PI / 2)) < 1e-12);
  assert.deepEqual(engine.sample(800.5), engine.sample(800.5), "fractional seek/replay sampling is absolute and deterministic");
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
  const cutSession = engine.schedule({ epoch: 2 });
  const cutSceneGainNodes = ctx.gains.slice(2, 4);
  assert.ok(cutSceneGainNodes[0].gain.events.some(event => event[0] === "set" && event[1] === 0 && event[2] === 3),
    "outgoing scene audio must stop on the exact Cut boundary");
  assert.ok(cutSceneGainNodes[1].gain.events.some(event => event[0] === "set" && event[1] === 1 && event[2] === 3),
    "incoming scene audio must start on the exact Cut boundary");
  cutSession.stop();
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
  assert.equal(engine.diagnostics.safeHeadroom, 1, "a sub-unity master level already provides sufficient peak headroom");
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
  const quietSession = quietEngine.schedule({ epoch: 2 });
  assert.equal(quietSession.scheduled.length, 0);
  assert.equal(quietSession.stopped, true);
  quietEngine.dispose();
  assert.equal(ctx.nodes.length, 0, "silent scenes allocate no audio graph nodes");

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

  function assertAllReleased(context, label) {
    assert.ok(context.nodes.every(node => node.disconnected), `${label}: all allocated nodes disconnected`);
    assert.ok(context.sources.every(source => source.buffer === null), `${label}: source buffers detached`);
  }
  for (const failGainAt of [1, 2]) {
    const context = new FakeAudioContext(); context.failGainAt = failGainAt;
    assert.throws(() => createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context,
      audioBuffers: { [sound.id]: buffer() } }), /gain allocation failed/u);
    assertAllReleased(context, `gain allocation ${failGainAt}`);
  }
  for (const failGainAt of [3, 4, 5]) {
    const context = new FakeAudioContext();
    const failing = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context, audioBuffers: { [sound.id]: buffer() } });
    context.failGainAt = failGainAt;
    assert.throws(() => failing.schedule({ epoch: 2 }), /gain allocation failed/u);
    failing.dispose(); assertAllReleased(context, `gain allocation ${failGainAt}`);
  }
  for (const failConnectAt of [1, 2]) {
    const context = new FakeAudioContext(); context.failConnectAt = failConnectAt;
    assert.throws(() => createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context,
      audioBuffers: { [sound.id]: buffer() } }), /connect failed/u);
    assertAllReleased(context, `engine connect ${failConnectAt}`);
  }
  for (const failConnectAt of [3, 4, 5, 6]) {
    const context = new FakeAudioContext();
    const failing = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context, audioBuffers: { [sound.id]: buffer() } });
    context.failConnectAt = failConnectAt;
    assert.throws(() => failing.schedule({ epoch: 2 }), /connect failed/u);
    failing.dispose(); assertAllReleased(context, `session connect ${failConnectAt}`);
  }
  for (const operation of ["failSource", "failBufferAssignment", "failStart", "failStop"]) {
    const context = new FakeAudioContext();
    const failing = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context, audioBuffers: { [sound.id]: buffer() } });
    context[operation] = true;
    assert.throws(() => failing.schedule({ epoch: 2 }), /source allocation failed|source buffer assignment failed|source start failed|source stop failed/u);
    failing.dispose(); assertAllReleased(context, operation);
  }
});

test("natural source completion automatically releases clip, track, and scene nodes", () => {
  const compiled = compile({ scenes: [audioScene("a", 1000, [music("a")])] });
  const context = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(compiled, { audioContext: context, audioBuffers: { [sound.id]: buffer() } });
  const session = engine.schedule({ epoch: 2 });
  const sessionNodes = context.nodes.slice(2); // exclude persistent master and headroom nodes
  assert.ok(sessionNodes.some(node => !node.disconnected));
  context.sources[0].onended();
  assert.equal(session.stopped, true);
  assert.ok(sessionNodes.every(node => node.disconnected), "the scene and track gains are released after the final voice ends");
  assert.equal(context.sources[0].buffer, null);
  engine.dispose();
});

test("safe headroom follows the actual equal-power bound and PCM/clip budgets are enforced", () => {
  const paired = compile({ scenes: [audioScene("a", 1000, [music("a", { volume: 0.8 })]),
    audioScene("b", 1000, [music("b", { volume: 0.8 })])], transitions: [
    { fromSceneId: "a", toSceneId: "b", type: "dissolve", durationMs: 400, audioCrossfadeMs: 400 }
  ] });
  const context = new FakeAudioContext();
  const engine = createStudioSequenceAudioCrossfadeEngine(paired, { audioContext: context, audioBuffers: { [sound.id]: buffer() } });
  assert.ok(Math.abs(engine.diagnostics.safeHeadroom - 1 / (0.8 * Math.SQRT2)) < 1e-12);
  assert.ok(engine.diagnostics.estimatedMaxSessionNodes <= 2 + 2 + 2 * 2);
  engine.dispose();

  const buffers = new Map([[sound.id, buffer({ duration: 0.5, channels: 2 })]]);
  const one = compile({ scenes: [audioScene("budget", 1000, [music("a")])] });
  const budgeted = createStudioSequenceAudioCrossfadeEngine(one, { audioContext: new FakeAudioContext(), audioBuffers: buffers });
  assert.equal(budgeted.diagnostics.decodedPcmBytes, 500 * 48000 / 1000 * 2 * 4);
  budgeted.dispose();

  const manyTracks = id => [{ id: "many", type: "music", volume: 1, clips: Array.from({ length: 300 }, (_, index) => ({
    id: `${id}-${index}`, asset: sound.id, startMs: 0, durationMs: 1, volume: 1, loop: false
  })) }];
  const tooManyCompiled = compile({ scenes: [audioScene("many-a", 1000, manyTracks("a")),
    audioScene("many-b", 1000, manyTracks("b"))], transitions: [
    { fromSceneId: "many-a", toSceneId: "many-b", type: "cut", durationMs: 0, audioCrossfadeMs: 0 }
  ] });
  assert.throws(() => createStudioSequenceAudioCrossfadeEngine(tooManyCompiled, {
    audioContext: new FakeAudioContext(), audioBuffers: { [sound.id]: buffer() }
  }), error => error.code === "BUDGET_EXCEEDED");

  const oversized = { duration: 500, length: 500 * 48000, numberOfChannels: 2,
    getChannelData: () => new Float32Array(1) };
  assert.throws(() => createStudioSequenceAudioCrossfadeEngine(one, { audioContext: new FakeAudioContext(),
    audioBuffers: { [sound.id]: oversized } }), error => error.code === "BUDGET_EXCEEDED");
});
