import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";
import { createTimeline } from "../src/motion/timeline.js";

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
  director.destroy();
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
  director.unmount();
  assert.equal(director.getState().timeMs, -1);
  director.destroy();
});

test("director validates clock order and lifecycle", async () => {
  const director = createCinematicDirector();
  await assert.rejects(director.update(0), /mounted/);
  await director.mount();
  await assert.rejects(director.update(-1), /non-negative/);
  assert.throws(() => director.pause(-2), /Pause time/);
  director.destroy();
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
  assert.deepEqual(calls, ["unmount", "unmount"]);
  director.destroy();
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
  director.destroy();
  resolveMount(true);
  assert.equal(await mounting, false);
  assert.equal(director.getState().mounted, false);
  assert.deepEqual(calls, ["destroy", "unmount"]);
});
