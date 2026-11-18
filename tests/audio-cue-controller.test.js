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

test("stopAll retains failed voices and commits timeline reset only after cleanup succeeds", () => {
  const stopped = [];
  const failure = new Error("first voice failed to stop");
  let fail = true;
  const controller = createAudioCueController({
    cues: [
      { id: "music", atMs: 0, asset: "music" },
      { id: "impact", atMs: 0, asset: "impact" }
    ],
    play: (_asset, options) => options.id,
    stop: voice => {
      stopped.push(voice);
      if (voice === "music" && fail) throw failure;
    }
  });

  controller.update(0);
  assert.throws(() => controller.stopAll({ reset: true }), error => error === failure);
  assert.deepEqual(stopped, ["music", "impact"]);
  assert.deepEqual(controller.getState(), {
    cursor: 0, paused: false, destroyed: false, volume: 1, activeVoices: 1
  });

  fail = false;
  controller.stopAll({ reset: true });
  assert.deepEqual(stopped, ["music", "impact", "music"]);
  assert.deepEqual(controller.getState(), {
    cursor: -1, paused: false, destroyed: false, volume: 1, activeVoices: 0
  });
});

test("destroy retries failed voices while keeping the controller closed to new work", () => {
  const stopped = [];
  const failure = new Error("music stop failed");
  let fail = true;
  const controller = createAudioCueController({
    cues: [
      { id: "music", atMs: 0, asset: "music" },
      { id: "effect", atMs: 0, asset: "effect" }
    ],
    play: (_asset, options) => options.id,
    stop: voice => {
      stopped.push(voice);
      if (voice === "music" && fail) throw failure;
    }
  });

  controller.update(0);
  assert.throws(() => controller.destroy(), error => error === failure);
  assert.deepEqual(stopped, ["music", "effect"]);
  assert.deepEqual(controller.getState(), {
    cursor: 0, paused: false, destroyed: true, volume: 1, activeVoices: 1
  });
  assert.throws(() => controller.update(1), /destroyed/);

  fail = false;
  assert.doesNotThrow(() => controller.destroy());
  assert.deepEqual(stopped, ["music", "effect", "music"]);
  assert.equal(controller.getState().activeVoices, 0);
});


test("a synchronous play failure leaves the failed cue retryable without replaying earlier cues", () => {
  const attempts = [];
  const failure = new Error("impact adapter failed");
  let failImpact = true;
  const controller = createAudioCueController({
    cues: [
      { id: "music", atMs: 0, asset: "theme", loop: true },
      { id: "impact", atMs: 0, asset: "impact" }
    ],
    play: (_asset, options) => {
      attempts.push(options.id);
      if (options.id === "impact" && failImpact) throw failure;
      return options.id;
    }
  });

  assert.throws(() => controller.update(0), error => error === failure);
  assert.deepEqual(attempts, ["music", "impact"]);
  assert.deepEqual(controller.getState(), {
    cursor: -1, paused: false, destroyed: false, volume: 1, activeVoices: 1
  });

  failImpact = false;
  assert.deepEqual(controller.update(0), ["impact"]);
  assert.deepEqual(attempts, ["music", "impact", "impact"]);
  assert.equal(controller.getState().cursor, 0);
  assert.equal(controller.getState().activeVoices, 2);
});


test("pause and resume suspend every active voice while preserving cue timing", () => {
  const calls = [];
  const controller = createAudioCueController({
    cues: [
      { id: "music", atMs: 0, asset: "theme", loop: true },
      { id: "impact", atMs: 100, asset: "impact" }
    ],
    play: (_asset, options) => options.id,
    pauseVoice: voice => calls.push(["pause", voice]),
    resumeVoice: voice => calls.push(["resume", voice])
  });

  controller.update(120);
  controller.pause(120);
  assert.deepEqual(calls, [["pause", "music"], ["pause", "impact"]]);
  assert.equal(controller.getState().paused, true);
  controller.update(250);
  controller.resume(250);
  assert.deepEqual(calls, [
    ["pause", "music"], ["pause", "impact"],
    ["resume", "music"], ["resume", "impact"]
  ]);
  controller.update(300);
  assert.equal(controller.getState().paused, false);
});

test("voice lifecycle attempts every voice and leaves failed resume retryable", () => {
  const calls = [];
  let fail = true;
  const controller = createAudioCueController({
    cues: [{ id: "a", atMs: 0, asset: "a" }, { id: "b", atMs: 0, asset: "b" }],
    play: (_asset, options) => options.id,
    pauseVoice: voice => calls.push(["pause", voice]),
    resumeVoice: voice => {
      calls.push(["resume", voice]);
      if (voice === "a" && fail) throw new Error("resume denied");
    }
  });
  controller.update(0);
  controller.pause(0);
  assert.throws(() => controller.resume(0), /resume denied/);
  assert.equal(controller.getState().paused, true);
  fail = false;
  controller.resume(0);
  assert.equal(controller.getState().paused, false);
  assert.deepEqual(calls, [
    ["pause", "a"], ["pause", "b"],
    ["resume", "a"], ["resume", "b"],
    ["resume", "a"], ["resume", "b"]
  ]);
});


test("pause retries voices that failed to suspend on the first attempt", () => {
  const calls = [];
  let fail = true;
  const controller = createAudioCueController({
    cues: [{ id: "music", atMs: 0, asset: "music" }, { id: "ambience", atMs: 0, asset: "ambience" }],
    play: (_asset, options) => options.id,
    pauseVoice: voice => {
      calls.push(voice);
      if (voice === "music" && fail) throw new Error("pause denied");
    }
  });

  controller.update(0);
  assert.throws(() => controller.pause(0), /pause denied/);
  assert.equal(controller.getState().paused, true);
  assert.deepEqual(calls, ["music", "ambience"]);

  fail = false;
  assert.doesNotThrow(() => controller.pause(0));
  assert.equal(controller.getState().paused, true);
  assert.deepEqual(calls, ["music", "ambience", "music", "ambience"]);
});


test("naturally ended one-shot cues release their voice from controller ownership", () => {
  let ended;
  const controller = createAudioCueController({
    cues: [{ id: "impact", atMs: 0, asset: "impact" }],
    play: (_asset, options) => {
      ended = options.onEnded;
      return { id: "impact" };
    },
    stop: () => {}
  });
  controller.update(0);
  assert.equal(controller.getState().activeVoices, 1);
  ended();
  assert.equal(controller.getState().activeVoices, 0);
  controller.destroy();
});

test("a one-shot that ends before play returns is not registered as active", () => {
  const controller = createAudioCueController({
    cues: [{ id: "short", atMs: 0, asset: "short" }],
    play: (_asset, options) => {
      options.onEnded();
      return { id: "short" };
    }
  });
  controller.update(0);
  assert.equal(controller.getState().activeVoices, 0);
  controller.destroy();
});

test("a stale one-shot completion cannot release a replacement voice with the same cue id", () => {
  const completions = [];
  const controller = createAudioCueController({
    cues: [{ id: "impact", atMs: 0, asset: "impact" }],
    play: (_asset, options) => {
      const voice = { generation: completions.length };
      completions.push({ voice, onEnded: options.onEnded });
      return voice;
    },
    stop: () => {}
  });

  controller.update(0);
  controller.stopAll({ reset: true });
  controller.update(0);
  assert.equal(controller.getState().activeVoices, 1);

  completions[0].onEnded();
  assert.equal(controller.getState().activeVoices, 1,
    "an ended callback from the previous playback must not remove the replacement voice");

  completions[1].onEnded();
  assert.equal(controller.getState().activeVoices, 0);
  controller.destroy();
});

test("looping cues do not receive a one-shot completion callback", () => {
  let received;
  const controller = createAudioCueController({
    cues: [{ id: "music", atMs: 0, asset: "music", loop: true }],
    play: (_asset, options) => {
      received = options.onEnded;
      return { id: "music" };
    }
  });
  controller.update(0);
  assert.equal(received, undefined);
  assert.equal(controller.getState().activeVoices, 1);
  controller.destroy();
});


test("volume changes attempt every active voice and allow failed voices to be retried", () => {
  const calls = [];
  const failure = new Error("music volume update failed");
  let failMusic = true;
  const controller = createAudioCueController({
    cues: [
      { id: "music", atMs: 0, asset: "music", volume: 0.5 },
      { id: "ambience", atMs: 0, asset: "ambience", volume: 0.8 }
    ],
    play: (_asset, options) => options.id,
    setVolume: (voice, volume) => {
      calls.push([voice, volume]);
      if (voice === "music" && failMusic) throw failure;
    }
  });

  controller.update(0);
  assert.throws(() => controller.setMasterVolume(0.5), error => error === failure);
  assert.deepEqual(calls, [["music", 0.25], ["ambience", 0.4]]);
  assert.equal(controller.getState().volume, 0.5);

  failMusic = false;
  assert.equal(controller.setMasterVolume(0.5), 0.5);
  assert.deepEqual(calls, [
    ["music", 0.25], ["ambience", 0.4],
    ["music", 0.25], ["ambience", 0.4]
  ]);
  controller.destroy();
});
