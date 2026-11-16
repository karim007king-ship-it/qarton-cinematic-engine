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
  assert.deepEqual(calls, ["unmount"]);
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
  assert.deepEqual(calls, ["destroy"]);
});

test("stale director mount completion cannot unmount a newer stage mount", async () => {
  let releaseFirst;
  let calls = 0;
  let unmountCalls = 0;
  let stageMounted = false;
  const stage = {
    mount: () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { releaseFirst = resolve; });
      stageMounted = true;
      return Promise.resolve(true);
    },
    update: async () => {
      if (!stageMounted) throw new Error("stage is not mounted");
    },
    unmount: () => { unmountCalls += 1; stageMounted = false; },
    destroy: () => { stageMounted = false; }
  };
  const director = createCinematicDirector({ characterStage: stage });
  const staleMount = director.mount();
  director.unmount();
  const freshMount = director.mount();
  assert.equal(await freshMount, true);
  releaseFirst(true);
  assert.equal(await staleMount, false);
  assert.equal(calls, 2);
  assert.equal(unmountCalls, 1);
  await director.update(0);
  director.destroy();
});


test("director destroy attempts audio cleanup when character stage destruction fails", async () => {
  const stageError = new Error("stage destroy failed");
  let audioDestroyCalls = 0;
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => {},
      destroy: () => { throw stageError; }
    },
    audio: {
      update: () => {},
      pause: () => {},
      resume: () => {},
      stopAll: () => {},
      destroy: () => { audioDestroyCalls += 1; }
    }
  });

  await director.mount();
  assert.throws(() => director.destroy(), error => error === stageError);
  assert.equal(audioDestroyCalls, 1);
  assert.deepEqual(director.getState(), {
    mounted: false, paused: false, destroyed: true, timeMs: -1
  });
  assert.doesNotThrow(() => director.destroy());
  assert.equal(audioDestroyCalls, 1);
});

test("director unmount resets lifecycle and stops audio even when stage unmount fails", async () => {
  const stageError = new Error("stage unmount failed");
  let audioStopCalls = 0;
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => { throw stageError; },
      destroy: () => {}
    },
    audio: {
      update: () => {},
      pause: () => {},
      resume: () => {},
      stopAll: () => { audioStopCalls += 1; },
      destroy: () => {}
    }
  });

  await director.mount();
  await director.update(120);
  assert.throws(() => director.unmount(), error => error === stageError);
  assert.equal(audioStopCalls, 1);
  assert.deepEqual(director.getState(), {
    mounted: false, paused: false, destroyed: false, timeMs: -1
  });
  director.destroy();
});


test("concurrent director updates are serialized in shared-clock order", async () => {
  let releaseFirst;
  const stageUpdates = [];
  const events = [];
  const stage = {
    mount: async () => true,
    update: time => {
      stageUpdates.push(time);
      if (time === 100) return new Promise(resolve => { releaseFirst = resolve; });
      return Promise.resolve();
    },
    unmount: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({
    characterStage: stage,
    timeline: createTimeline([
      { id: "first", atMs: 100, type: "cue" },
      { id: "second", atMs: 200, type: "cue" }
    ]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  const first = director.update(100);
  const second = director.update(200);
  for (let i = 0; i < 8 && !releaseFirst; i += 1) await Promise.resolve();
  assert.equal(typeof releaseFirst, "function");
  assert.deepEqual(stageUpdates, [100]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(stageUpdates, [100, 200]);
  assert.deepEqual(events, ["first", "second"]);
  director.destroy();
});

test("unmount cancels pending director events after an asynchronous stage update", async () => {
  let releaseUpdate;
  const events = [];
  const stage = {
    mount: async () => true,
    update: () => new Promise(resolve => { releaseUpdate = resolve; }),
    unmount: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({
    characterStage: stage,
    timeline: createTimeline([{ id: "late", atMs: 100, type: "cue" }]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  const pending = director.update(100);
  for (let i = 0; i < 8 && !releaseUpdate; i += 1) await Promise.resolve();
  assert.equal(typeof releaseUpdate, "function");
  director.unmount();
  releaseUpdate();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.deepEqual(events, []);
  assert.equal(director.getState().timeMs, -1);
  director.destroy();
});


test("pause invalidates pending director events even if playback resumes before rendering completes", async () => {
  let releaseUpdate;
  const events = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: () => new Promise(resolve => { releaseUpdate = resolve; }),
      unmount: () => {},
      destroy: () => {}
    },
    timeline: createTimeline([{ id: "pending", atMs: 100, type: "cue" }]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  const pending = director.update(100);
  for (let i = 0; i < 8 && !releaseUpdate; i += 1) await Promise.resolve();
  assert.equal(typeof releaseUpdate, "function");
  assert.equal(director.pause(100), true);
  assert.equal(director.resume(100), true);
  releaseUpdate();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.deepEqual(events, []);
  director.destroy();
});


test("queued update is cancelled when pause and resume happen before it starts", async () => {
  let releaseFirst;
  const stageUpdates = [];
  const events = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: time => {
        stageUpdates.push(time);
        if (time === 100) return new Promise(resolve => { releaseFirst = resolve; });
      },
      unmount: () => {},
      destroy: () => {}
    },
    timeline: createTimeline([
      { id: "first", atMs: 100, type: "cue" },
      { id: "queued", atMs: 200, type: "cue" }
    ]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  const first = director.update(100);
  const queued = director.update(200);
  for (let i = 0; i < 8 && !releaseFirst; i += 1) await Promise.resolve();
  assert.equal(typeof releaseFirst, "function");
  assert.equal(director.pause(100), true);
  assert.equal(director.resume(100), true);
  releaseFirst();
  const [firstResult, result] = await Promise.all([first, queued]);
  assert.equal(firstResult.cancelled, true);
  assert.equal(result.cancelled, true);
  assert.deepEqual(stageUpdates, [100]);
  assert.deepEqual(events, []);
  director.destroy();
});

test("queued update from an old mount cannot run after unmount and remount", async () => {
  let releaseFirst;
  const stageUpdates = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: time => {
        stageUpdates.push(time);
        if (time === 100) return new Promise(resolve => { releaseFirst = resolve; });
      },
      unmount: () => {},
      destroy: () => {}
    }
  });

  await director.mount();
  const first = director.update(100);
  const staleQueued = director.update(200);
  for (let i = 0; i < 8 && !releaseFirst; i += 1) await Promise.resolve();
  assert.equal(typeof releaseFirst, "function");
  director.unmount();
  await director.mount();
  releaseFirst();
  const [firstResult, result] = await Promise.all([first, staleQueued]);
  assert.equal(firstResult.cancelled, true);
  assert.equal(result.cancelled, true);
  assert.deepEqual(stageUpdates, [100]);
  await director.update(0);
  assert.deepEqual(stageUpdates, [100, 0]);
  director.destroy();
});


test("audio update failure leaves the director clock retryable", async () => {
  let audioAttempts = 0;
  const stageUpdates = [];
  const events = [];
  const audio = {
    update: () => {
      audioAttempts += 1;
      if (audioAttempts === 1) throw new Error("audio adapter failed");
    },
    pause: () => {},
    resume: () => {},
    stopAll: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({
    audio,
    characterStage: {
      mount: async () => true,
      update: async time => { stageUpdates.push(time); },
      unmount: () => {},
      destroy: () => {}
    },
    timeline: createTimeline([{ id: "retry-audio", atMs: 100, type: "cue" }]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  await assert.rejects(director.update(100), /audio adapter failed/);
  assert.equal(director.getState().timeMs, -1);
  assert.deepEqual(stageUpdates, []);
  const result = await director.update(100);
  assert.deepEqual(result.events.map(event => event.id), ["retry-audio"]);
  assert.equal(director.getState().timeMs, 100);
  assert.deepEqual(stageUpdates, [100]);
  assert.deepEqual(events, ["retry-audio"]);
  director.destroy();
});

test("stage failure can retry the same timestamp without replaying audio cues or events", async () => {
  let stageAttempts = 0;
  let playCalls = 0;
  const events = [];
  const audio = {
    update: time => {
      // Model the real cue controller's idempotent same-time retry behavior.
      if (time !== 100) throw new Error("unexpected audio time");
      if (playCalls === 0) playCalls += 1;
    },
    pause: () => {},
    resume: () => {},
    stopAll: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({
    audio,
    characterStage: {
      mount: async () => true,
      update: async () => {
        stageAttempts += 1;
        if (stageAttempts === 1) throw new Error("stage render failed");
      },
      unmount: () => {},
      destroy: () => {}
    },
    timeline: createTimeline([{ id: "retry-stage", atMs: 100, type: "cue" }]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  await assert.rejects(director.update(100), /stage render failed/);
  assert.equal(director.getState().timeMs, -1);
  await director.update(100);
  assert.equal(director.getState().timeMs, 100);
  assert.equal(stageAttempts, 2);
  assert.equal(playCalls, 1);
  assert.deepEqual(events, ["retry-stage"]);
  director.destroy();
});
