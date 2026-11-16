import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";
import { createTimeline } from "../src/motion/timeline.js";
import { createAudioCueController } from "../src/audio/audio-cue-controller.js";

function audioSpy() {
  const calls = [];
  return {
    calls,
    update: time => calls.push(["update", time]),
    pause: time => calls.push(["pause", time]),
    resume: time => calls.push(["resume", time]),
    stopAll: options => calls.push(["stopAll", options]),
    destroy: () => calls.push(["destroy"])
  };
}

test("director synchronizes timeline, audio and character stage on one clock", async () => {
  const calls = [];
  const stage = {
    mount: async () => { calls.push(["mount"]); return true; },
    update: async time => calls.push(["character", time]),
    unmount: () => calls.push(["unmount"]),
    destroy: () => calls.push(["destroy"])
  };
  const audio = audioSpy();
  const events = [];
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([
      { id: "opening", atMs: 0, type: "camera" },
      { id: "impact", atMs: 400, type: "shake" }
    ]),
    onEvent: event => events.push(event.id)
  });

  assert.equal(await director.mount(), true);
  assert.deepEqual((await director.update(0)).events.map(event => event.id), ["opening"]);
  assert.deepEqual((await director.update(500)).events.map(event => event.id), ["impact"]);
  assert.deepEqual(events, ["opening", "impact"]);
  assert.deepEqual(calls, [["mount"], ["character", 0], ["character", 500]]);
  assert.deepEqual(audio.calls, [["update", 0], ["update", 500]]);
  await director.destroy();
  assert.equal(director.getState().destroyed, true);
  assert.equal(calls.at(-1)[0], "destroy");
  assert.equal(audio.calls.at(-1)[0], "destroy");
});

test("director pauses, resumes and replays timeline deterministically after rewind", async () => {
  const audio = audioSpy();
  const events = [];
  const director = createCinematicDirector({
    audio,
    timeline: createTimeline([
      { id: "first", atMs: 100, type: "cue" },
      { id: "during-pause", atMs: 225, type: "cue" },
      { id: "later", atMs: 300, type: "cue" }
    ]),
    onEvent: event => events.push(event.id)
  });
  await director.mount();
  await director.update(200);
  assert.equal(director.pause(200), true);
  assert.equal((await director.update(250)).paused, true);
  assert.equal(director.resume(250), true);
  await director.update(350);
  assert.deepEqual(events, ["first", "later"]);
  assert.deepEqual(audio.calls, [
    ["update", 200], ["pause", 200], ["resume", 250], ["update", 350]
  ]);

  await director.update(50);
  assert.deepEqual(events, ["first", "later"]);
  assert.deepEqual(audio.calls.slice(-2), [["stopAll", { reset: true }], ["update", 50]]);
  const replay = await director.update(350);
  assert.deepEqual(replay.events.map(event => event.id), ["first", "during-pause", "later"]);
  assert.deepEqual(events, ["first", "later", "first", "during-pause", "later"]);
  director.unmount();
  assert.equal(director.getState().timeMs, -1);
  await director.destroy();
});

test("director validates clock order and lifecycle", async () => {
  const director = createCinematicDirector();
  await assert.rejects(director.update(0), /mounted/);
  await director.mount();
  await assert.rejects(director.update(-1), /non-negative/);
  assert.throws(() => director.pause(-2), /Pause time/);
  await director.destroy();
  await assert.rejects(director.update(0), /destroyed/);
});


test("unmount invalidates an asynchronous director mount", async () => {
  let resolveMount;
  const calls = [];
  const stage = {
    mount: () => new Promise(resolve => { resolveMount = resolve; }),
    update: async () => {},
    unmount: () => calls.push("unmount"),
    destroy: () => calls.push("destroy")
  };
  const director = createCinematicDirector({ characterStage: stage });
  const mounting = director.mount();
  director.unmount();
  resolveMount(true);
  assert.equal(await mounting, false);
  assert.equal(director.getState().mounted, false);
  assert.deepEqual(calls, ["unmount"]);
  await director.destroy();
});

test("destroy invalidates an asynchronous director mount", async () => {
  let resolveMount;
  const calls = [];
  const stage = {
    mount: () => new Promise(resolve => { resolveMount = resolve; }),
    update: async () => {},
    unmount: () => calls.push("unmount"),
    destroy: () => calls.push("destroy")
  };
  const director = createCinematicDirector({ characterStage: stage });
  const mounting = director.mount();
  const destroying = director.destroy();
  resolveMount(true);
  assert.equal(await mounting, false);
  await destroying;
  assert.equal(director.getState().mounted, false);
  assert.deepEqual(calls, ["destroy"]);
});

test("director destroys audio even when character stage cleanup throws", async () => {
  const calls = [];
  const failure = new Error("character stage cleanup failed");
  let stageDestroyAttempts = 0;
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => {},
      destroy: () => { calls.push("stage"); stageDestroyAttempts += 1; if (stageDestroyAttempts === 1) throw failure; }
    },
    audio: {
      update: () => {},
      pause: () => {},
      resume: () => {},
      stopAll: () => {},
      destroy: () => calls.push("audio")
    }
  });

  await assert.rejects(director.destroy(), error => error === failure);
  assert.deepEqual(calls, ["stage", "audio"]);
  assert.equal(director.getState().destroyed, true);
  await assert.doesNotReject(director.destroy());
  assert.deepEqual(calls, ["stage", "audio", "stage", "audio"]);
});

test("director unmount attempts audio reset and resets state when stage cleanup throws", async () => {
  const calls = [];
  const failure = new Error("stage unmount failed");
  const audio = audioSpy();
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => { calls.push("stage"); throw failure; },
      destroy: () => {}
    },
    audio: {
      ...audio,
      stopAll: options => { calls.push(["audio", options]); audio.stopAll(options); }
    }
  });

  await director.mount();
  await director.update(125);
  assert.throws(() => director.unmount(), error => error === failure);
  assert.deepEqual(calls, ["stage", ["audio", { reset: true }]]);
  assert.deepEqual(director.getState(), {
    mounted: false, paused: false, destroyed: false, timeMs: -1
  });
  await director.mount();
  await director.destroy();
});


test("director destroy retries asynchronous subsystem cleanup failures", async () => {
  let fail = true;
  let stageAttempts = 0;
  const calls = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => {},
      destroy: async () => {
        stageAttempts += 1;
        calls.push("stage");
        if (fail) throw new Error("transient stage destroy failure");
      }
    },
    audio: {
      update: () => {},
      pause: () => {},
      resume: () => {},
      stopAll: () => {},
      destroy: async () => { calls.push("audio"); }
    }
  });

  await assert.rejects(director.destroy(), /transient stage destroy failure/);
  assert.equal(director.getState().destroyed, true);
  fail = false;
  await director.destroy();
  assert.equal(stageAttempts, 2);
  assert.deepEqual(calls, ["stage", "audio", "stage", "audio"]);
  await assert.rejects(director.update(0), /destroyed/);
});

test("director destroy waits for pending mount rollback before resolving", async () => {
  let resolveMount;
  const calls = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: () => new Promise(resolve => { resolveMount = resolve; }),
      update: async () => {},
      unmount: () => calls.push("unmount"),
      destroy: async () => { calls.push("destroy"); }
    }
  });

  const mounting = director.mount();
  const destroying = director.destroy();
  let settled = false;
  destroying.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveMount(true);
  assert.equal(await mounting, false);
  await destroying;
  assert.deepEqual(calls, ["destroy"]);
});


test("director allows a fresh mount while an invalidated mount is still pending", async () => {
  const resolvers = [];
  let mountCount = 0;
  const stage = {
    mount: () => {
      mountCount += 1;
      return new Promise(resolve => resolvers.push(resolve));
    },
    update: async () => {},
    unmount: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({ characterStage: stage });

  const stale = director.mount();
  director.unmount();
  const fresh = director.mount();
  assert.equal(mountCount, 2);

  resolvers[1](true);
  assert.equal(await fresh, true);
  resolvers[0](true);
  assert.equal(await stale, false);
  assert.equal(director.getState().mounted, true);
  await director.destroy();
});


test("director resumes event delivery after a callback throws without replaying prior events or audio", async () => {
  const delivered = [];
  const played = [];
  const audio = createAudioCueController({
    cues: [{ id: "impact", atMs: 0, asset: "impact" }],
    play: asset => { played.push(asset); return asset; },
    stop: () => {}
  });
  let secondCalls = 0;
  const director = createCinematicDirector({
    audio,
    timeline: createTimeline([
      { id: "first", atMs: 0, type: "story" },
      { id: "second", atMs: 10, type: "story" },
      { id: "third", atMs: 20, type: "story" }
    ]),
    onEvent: event => {
      delivered.push(event.id);
      if (event.id === "second") {
        secondCalls += 1;
        if (secondCalls === 1) throw new Error("story callback failed");
      }
    }
  });

  await director.mount();
  await assert.rejects(director.update(20), /story callback failed/);
  assert.deepEqual(delivered, ["first", "second"]);
  const retried = await director.update(20);
  assert.deepEqual(retried.events.map(event => event.id), ["third"]);
  assert.deepEqual(delivered, ["first", "second", "third"]);
  assert.deepEqual(played, ["impact"]);
  await director.destroy();
});

test("director keeps timeline events pending when character sampling fails", async () => {
  const delivered = [];
  const played = [];
  let fail = true;
  const stage = {
    mount: async () => true,
    update: async () => {
      if (fail) throw new Error("character sampling failed");
    },
    unmount: () => {},
    destroy: () => {}
  };
  const audio = createAudioCueController({
    cues: [{ id: "ambience", atMs: 0, asset: "ambience" }],
    play: asset => { played.push(asset); return asset; },
    stop: () => {}
  });
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([
      { id: "line-one", atMs: 10, type: "dialogue" },
      { id: "line-two", atMs: 20, type: "dialogue" }
    ]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  await assert.rejects(director.update(20), /character sampling failed/);
  assert.deepEqual(delivered, []);
  fail = false;
  await director.update(20);
  assert.deepEqual(delivered, ["line-one", "line-two"]);
  assert.deepEqual(played, ["ambience"]);
  await director.destroy();
});
