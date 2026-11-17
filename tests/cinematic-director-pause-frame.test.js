import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";
import { createTimeline } from "../src/motion/timeline.js";

test("pause during asynchronous character sampling prevents audio and event dispatch for that frame", async () => {
  let resolveFirstFrame;
  let frameCount = 0;
  const audioCalls = [];
  const delivered = [];
  const stage = {
    mount: async () => true,
    update: () => {
      frameCount += 1;
      if (frameCount === 1) {
        return new Promise(resolve => { resolveFirstFrame = resolve; });
      }
      return Promise.resolve();
    },
    unmount: () => {},
    destroy: () => {}
  };
  const audio = {
    update: time => audioCalls.push(["update", time]),
    pause: time => audioCalls.push(["pause", time]),
    resume: time => audioCalls.push(["resume", time]),
    stopAll: options => audioCalls.push(["stopAll", options]),
    destroy: () => {}
  };
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([{ id: "opening", atMs: 0, type: "story" }]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  const pendingFrame = director.update(0);
  await Promise.resolve();
  assert.equal(typeof resolveFirstFrame, "function");

  assert.equal(director.pause(), true);
  resolveFirstFrame();
  const pausedResult = await pendingFrame;

  assert.equal(pausedResult.paused, true);
  assert.deepEqual(pausedResult.events, []);
  assert.deepEqual(audioCalls, [["pause", -1]]);
  assert.deepEqual(delivered, []);

  assert.equal(director.resume(), true);
  await director.update(0);
  assert.deepEqual(audioCalls, [
    ["pause", -1],
    ["resume", -1],
    ["update", 0]
  ]);
  assert.deepEqual(delivered, ["opening"]);
  await director.destroy();
});


test("rewind does not replay audio until character sampling succeeds", async () => {
  const played = [];
  const stopped = [];
  const delivered = [];
  let failNextSample = false;
  const stage = {
    mount: async () => true,
    update: async () => {
      if (failNextSample) {
        failNextSample = false;
        throw new Error("rewound character sample failed");
      }
    },
    unmount: () => {},
    destroy: () => {}
  };
  const { createAudioCueController } = await import("../src/audio/audio-cue-controller.js");
  const audio = createAudioCueController({
    cues: [
      { id: "early", atMs: 50, asset: "early" },
      { id: "middle", atMs: 250, asset: "middle" }
    ],
    play: asset => { played.push(asset); return asset; },
    stop: voice => stopped.push(voice)
  });
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([{ id: "rewound-event", atMs: 100, type: "story" }]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  await director.update(300);
  assert.deepEqual(played, ["early", "middle"]);

  failNextSample = true;
  await assert.rejects(director.update(100), /rewound character sample failed/);
  assert.deepEqual(stopped, ["early", "middle"]);
  assert.deepEqual(played, ["early", "middle"]);
  assert.deepEqual(delivered, []);

  await director.update(100);
  assert.deepEqual(played, ["early", "middle", "early"]);
  assert.deepEqual(delivered, ["rewound-event"]);
  await director.destroy();
});
