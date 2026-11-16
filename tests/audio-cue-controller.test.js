import test from "node:test";
import assert from "node:assert/strict";
import { createAudioCueController } from "../src/audio/audio-cue-controller.js";

test("audio cues fire once in timeline order with channel and volume metadata", () => {
  const played = [];
  const controller = createAudioCueController({
    cues: [
      { id: "impact", atMs: 500, asset: "impact", volume: 0.5 },
      { id: "music", atMs: 0, asset: "theme", channel: "music", loop: true }
    ],
    play: (asset, options) => { played.push({ asset, options }); return asset; }
  });
  assert.deepEqual(controller.update(0), ["music"]);
  assert.deepEqual(controller.update(700), ["impact"]);
  assert.deepEqual(controller.update(900), []);
  assert.equal(played[1].options.volume, 0.5);
  assert.equal(played[0].options.channel, "music");
});

test("pause and resume skip cues that elapsed during pause", () => {
  const played = [];
  const controller = createAudioCueController({
    cues: [
      { id: "a", atMs: 100, asset: "a" },
      { id: "b", atMs: 200, asset: "b" },
      { id: "c", atMs: 300, asset: "c" }
    ],
    play: asset => { played.push(asset); return asset; }
  });
  controller.update(120);
  controller.pause(120);
  assert.deepEqual(controller.update(250), []);
  controller.resume(250);
  controller.update(320);
  assert.deepEqual(played, ["a", "c"]);
});

test("volume changes update active voices and stopAll can reset timeline", () => {
  const volumes = [];
  const stopped = [];
  const controller = createAudioCueController({
    cues: [{ id: "music", atMs: 0, asset: "theme", volume: 0.8 }],
    play: () => "voice-1",
    setVolume: (voice, volume) => volumes.push([voice, volume]),
    stop: voice => stopped.push(voice)
  });
  controller.update(0);
  controller.setMasterVolume(0.5);
  assert.deepEqual(volumes, [["voice-1", 0.4]]);
  controller.stopAll({ reset: true });
  assert.deepEqual(stopped, ["voice-1"]);
  assert.equal(controller.getState().cursor, -1);
});

test("audio cue controller validates cues, time and lifecycle", () => {
  assert.throws(() => createAudioCueController({ cues: [{ id: "x", atMs: -1, asset: "x" }], play() {} }), /atMs/);
  const controller = createAudioCueController({ play() {} });
  assert.throws(() => controller.update(-1), /time/);
  controller.destroy();
  assert.throws(() => controller.update(0), /destroyed/);
});

test("ended voice references are removed from active voice tracking", () => {
  let ended;
  const voice = { id: "one-shot" };
  const controller = createAudioCueController({
    cues: [{ id: "impact", atMs: 0, asset: "impact" }],
    play: (_asset, options) => { ended = options.onEnded; return voice; }
  });
  controller.update(0);
  assert.equal(controller.getState().activeVoices, 1);
  ended(voice);
  assert.equal(controller.getState().activeVoices, 0);
  controller.destroy();
});


test("stopAll releases every voice and resets state when an adapter stop throws", () => {
  const stopped = [];
  const controller = createAudioCueController({
    cues: [
      { id: "first", atMs: 0, asset: "first" },
      { id: "second", atMs: 0, asset: "second" }
    ],
    play: asset => asset,
    stop: voice => {
      stopped.push(voice);
      if (voice === "first") throw new Error("host stop failed");
    }
  });
  controller.update(0);
  controller.pause(0);
  assert.throws(() => controller.stopAll({ reset: true }), /host stop failed/);
  assert.deepEqual(stopped, ["first", "second"]);
  assert.deepEqual(controller.getState(), {
    cursor: -1,
    paused: false,
    destroyed: false,
    volume: 1,
    activeVoices: 0
  });
});

test("destroy attempts every voice and remains destroyed when an adapter stop throws", () => {
  const stopped = [];
  const controller = createAudioCueController({
    cues: [
      { id: "first", atMs: 0, asset: "first" },
      { id: "second", atMs: 0, asset: "second" }
    ],
    play: asset => asset,
    stop: voice => {
      stopped.push(voice);
      if (voice === "first") throw new Error("host stop failed");
    }
  });
  controller.update(0);
  assert.throws(() => controller.destroy(), /host stop failed/);
  assert.deepEqual(stopped, ["first", "second"]);
  assert.deepEqual(controller.getState(), {
    cursor: 0,
    paused: false,
    destroyed: true,
    volume: 1,
    activeVoices: 0
  });
  assert.doesNotThrow(() => controller.destroy());
  assert.throws(() => controller.update(1), /destroyed/);
});
