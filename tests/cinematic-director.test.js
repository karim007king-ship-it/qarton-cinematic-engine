import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";
import { createTimeline } from "../src/motion/timeline.js";
import { createAudioCueController } from "../src/audio/audio-cue-controller.js";
import { createCharacterStage } from "../src/character/character-stage.js";
import { createCharacterController } from "../src/character/character-controller.js";
import { createMotionPath } from "../src/motion/path.js";

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
    onEvent: async event => {
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
  assert.deepEqual(retried.events.map(event => event.id), ["second", "third"]);
  assert.deepEqual(delivered, ["first", "second", "second", "third"]);
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


class TestElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
}
class TestDocument {
  createElement(tag) { return new TestElement(tag, this); }
}

test("director drives real character stage and audio cues from the same timeline clock", async () => {
  const document = new TestDocument();
  const root = new TestElement("main", document);
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const controller = createCharacterController({
    id: "hero",
    initial: { expression: "neutral" },
    motions: [{ id: "walk", path, startMs: 0, durationMs: 1000, expression: "focused" }]
  });
  const stage = createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{
      controller,
      sprites: { neutral: "hero-neutral", focused: "hero-focused" }
    }]
  });
  const played = [];
  const audio = createAudioCueController({
    cues: [{ id: "footstep", atMs: 500, asset: "footstep" }],
    play: asset => { played.push(asset); return asset; },
    stop: () => {}
  });
  const events = [];
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([{ id: "camera-cut", atMs: 500, type: "camera" }]),
    onEvent: event => events.push(event.id)
  });

  await director.mount();
  await director.update(500);
  assert.match(root.children[0].style.transform, /translate3d\(50px, 0px, 0\)/);
  assert.equal(root.children[0].children[0].src, "https://assets.test/hero-focused.png");
  assert.deepEqual(played, ["footstep"]);
  assert.deepEqual(events, ["camera-cut"]);

  await director.unmount();
  assert.equal(root.children.length, 0);
  await director.destroy();
});


test("concurrent director updates serialize frame sampling and timeline event delivery", async () => {
  const audio = audioSpy();
  const characterTimes = [];
  const delivered = [];
  let releaseFirstEvent;
  const firstEvent = new Promise(resolve => { releaseFirstEvent = resolve; });
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async time => { characterTimes.push(time); },
      unmount: () => {},
      destroy: () => {}
    },
    audio,
    timeline: createTimeline([
      { id: "opening", atMs: 0, type: "story" },
      { id: "later", atMs: 150, type: "story" }
    ]),
    onEvent: async event => {
      delivered.push(event.id);
      if (event.id === "opening") await firstEvent;
    }
  });

  await director.mount();
  const first = director.update(100);
  const second = director.update(200);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(characterTimes, [100]);
  assert.deepEqual(delivered, ["opening"]);
  assert.deepEqual(audio.calls, [["update", 100]]);

  releaseFirstEvent();
  const firstResult = await first;
  const secondResult = await second;
  assert.deepEqual(firstResult.events.map(event => event.id), ["opening"]);
  assert.deepEqual(secondResult.events.map(event => event.id), ["later"]);
  assert.deepEqual(characterTimes, [100, 200]);
  assert.deepEqual(delivered, ["opening", "later"]);
  assert.deepEqual(audio.calls, [["update", 100], ["update", 200]]);
  await director.destroy();
});

test("unmount invalidates an in-flight director frame before it dispatches timeline events", async () => {
  let resolveCharacterUpdate;
  const delivered = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: () => new Promise(resolve => { resolveCharacterUpdate = resolve; }),
      unmount: () => {},
      destroy: () => {}
    },
    timeline: createTimeline([{ id: "must-not-fire", atMs: 0, type: "story" }]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  const updating = director.update(0);
  await Promise.resolve();
  director.unmount();
  resolveCharacterUpdate();
  const result = await updating;
  assert.deepEqual(result.events, []);
  assert.deepEqual(delivered, []);
  assert.equal(director.getState().timeMs, -1);
  await director.destroy();
});


test("director rebases raw host timestamps after background pause and freezes the shared clock", async () => {
  const audio = audioSpy();
  const characterTimes = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async time => characterTimes.push(time),
      unmount: () => {},
      destroy: () => {}
    },
    audio
  });

  await director.mount();
  await director.update(100);
  director.pause();
  assert.equal((await director.update(10000)).paused, true);
  director.resume();
  const resumed = await director.update(20000);
  assert.equal(resumed.timeMs, 100);
  const next = await director.update(20100);
  assert.equal(next.timeMs, 200);
  assert.deepEqual(characterTimes, [100, 100, 200]);
  assert.deepEqual(audio.calls, [
    ["update", 100], ["pause", 100], ["resume", 100], ["update", 100], ["update", 200]
  ]);
  await director.destroy();
});

test("director resumes from logical zero when the page was hidden before its first frame", async () => {
  const audio = audioSpy();
  const director = createCinematicDirector({ audio });
  await director.mount();
  director.pause();
  director.resume();
  const result = await director.update(8000);
  assert.equal(result.timeMs, 0);
  assert.deepEqual(audio.calls, [
    ["pause", -1], ["resume", -1], ["update", 0]
  ]);
  await director.destroy();
});


test("director commits paused state when an active audio voice fails to pause", async () => {
  let failPause = true;
  const audio = createAudioCueController({
    cues: [{ id: "ambience", atMs: 0, asset: "ambience", loop: true }],
    play: () => "voice",
    pauseVoice: () => {
      if (failPause) throw new Error("voice pause failed");
    }
  });
  const director = createCinematicDirector({ audio });
  await director.mount();
  await director.update(100);

  assert.throws(() => director.pause(), /voice pause failed/);
  assert.equal(director.getState().paused, true);
  assert.equal((await director.update(10000)).timeMs, 100);
  assert.equal(audio.getState().paused, true);

  failPause = false;
  assert.equal(director.resume(), true);
  assert.equal(director.getState().paused, false);
  assert.equal((await director.update(20000)).timeMs, 100);
  await director.destroy();
});


test("director pauses at the audio cursor after a character frame fails and preserves pending events", async () => {
  let failCharacter = true;
  const delivered = [];
  const played = [];
  const stage = {
    mount: async () => true,
    update: async () => {
      if (failCharacter) throw new Error("character update failed");
    },
    unmount: () => {},
    destroy: () => {}
  };
  const audio = createAudioCueController({
    cues: [{ id: "impact", atMs: 50, asset: "impact" }],
    play: asset => { played.push(asset); return asset; }
  });
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([{ id: "story-beat", atMs: 50, type: "story" }]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  await assert.rejects(director.update(100), /character update failed/);
  assert.equal(audio.getState().cursor, 100);
  assert.doesNotThrow(() => director.pause());
  assert.equal(director.getState().timeMs, 100);
  assert.equal(director.getState().paused, true);

  failCharacter = false;
  director.resume();
  const resumed = await director.update(20000);
  assert.equal(resumed.timeMs, 100);
  assert.deepEqual(played, ["impact"], "audio cues already fired before the failure must not replay");
  assert.deepEqual(delivered, ["story-beat"], "events from the interrupted frame must remain pending");
  await director.destroy();
});


test("director keeps failed scene callbacks pending when page lifecycle pauses the clock", async () => {
  const delivered = [];
  let failOnce = true;
  const director = createCinematicDirector({
    timeline: createTimeline([
      { id: "delivered", atMs: 10, type: "story" },
      { id: "retry", atMs: 20, type: "story" }
    ]),
    onEvent: event => {
      delivered.push(event.id);
      if (event.id === "retry" && failOnce) {
        failOnce = false;
        throw new Error("event callback failed");
      }
    }
  });

  await director.mount();
  await assert.rejects(director.update(20), /event callback failed/);
  assert.equal(director.getState().timeMs, 20);
  director.pause();
  director.resume();
  await director.update(20000);
  assert.deepEqual(delivered, ["delivered", "retry", "retry"]);
  await director.destroy();
});


test("director retries an audio pause failure while keeping the cinematic clock frozen", async () => {
  const pauseCalls = [];
  let fail = true;
  const audio = {
    update: () => {},
    pause: timeMs => {
      pauseCalls.push(timeMs);
      if (fail) throw new Error("audio pause failed");
    },
    resume: () => {},
    stopAll: () => {},
    destroy: () => {}
  };
  const director = createCinematicDirector({ audio });
  await director.mount();
  await director.update(125);

  assert.throws(() => director.pause(), /audio pause failed/);
  assert.deepEqual(director.getState(), {
    mounted: true, paused: true, destroyed: false, timeMs: 125
  });
  assert.equal((await director.update(10000)).timeMs, 125);

  fail = false;
  assert.equal(director.pause(), false);
  assert.deepEqual(pauseCalls, [125, 125]);
  assert.equal(director.getState().paused, true);
  await director.destroy();
});


test("director stays paused when an audio voice needs a user gesture and retries cleanly", async () => {
  let contextRunning = false;
  const voiceCalls = [];
  const audio = createAudioCueController({
    cues: [{ id: "music", atMs: 0, asset: "music", loop: true }],
    play: () => ({ id: "music" }),
    pauseVoice: voice => { voiceCalls.push(["pause", voice.id]); },
    resumeVoice: voice => {
      voiceCalls.push(["resume", voice.id]);
      if (!contextRunning) throw new Error("user gesture required");
    }
  });
  const director = createCinematicDirector({ audio });
  await director.mount();
  await director.update(100);
  director.pause();

  assert.throws(() => director.resume(), /user gesture required/);
  assert.equal(director.getState().paused, true);
  assert.equal(audio.getState().paused, true);

  contextRunning = true;
  assert.equal(director.resume(), true);
  assert.equal(director.getState().paused, false);
  assert.equal(audio.getState().paused, false);
  assert.deepEqual(voiceCalls, [
    ["pause", "music"], ["resume", "music"], ["resume", "music"]
  ]);
  await director.destroy();
});

test("director retries failed audio suspension while remaining paused on the same clock", async () => {
  const calls = [];
  let failPause = true;
  const audio = {
    update: time => calls.push(["update", time]),
    pause: time => {
      calls.push(["pause", time]);
      if (failPause) throw new Error("transient audio suspension failure");
    },
    resume: time => calls.push(["resume", time]),
    stopAll: options => calls.push(["stopAll", options]),
    destroy: () => calls.push(["destroy"])
  };
  const director = createCinematicDirector({ audio });

  await director.mount();
  await director.update(125);
  assert.throws(() => director.pause(), /transient audio suspension failure/);
  assert.deepEqual(director.getState(), {
    mounted: true, paused: true, destroyed: false, timeMs: 125
  });

  failPause = false;
  assert.equal(director.pause(), false, "retrying an already-paused director does not emit a second pause transition");
  assert.deepEqual(director.getState(), {
    mounted: true, paused: true, destroyed: false, timeMs: 125
  });
  assert.deepEqual(calls, [
    ["update", 125],
    ["pause", 125],
    ["pause", 125]
  ], "retry must not advance the audio or director clock");

  assert.equal(director.resume(), true);
  assert.deepEqual(calls.at(-1), ["resume", 125]);
  await director.destroy();
});

test("director destroy waits for an active update before destroying owned resources", async () => {
  let resolveUpdate;
  const calls = [];
  const stage = {
    mount: async () => true,
    update: () => new Promise(resolve => { resolveUpdate = resolve; }),
    unmount: () => {},
    destroy: () => { calls.push("stage destroy"); }
  };
  const audio = {
    update: time => calls.push(["audio update", time]),
    pause: () => {},
    resume: () => {},
    stopAll: () => {},
    destroy: () => { calls.push("audio destroy"); }
  };
  const director = createCinematicDirector({ characterStage: stage, audio });
  await director.mount();
  const frame = director.update(100);
  await Promise.resolve();
  const destroying = director.destroy();
  await Promise.resolve();
  assert.deepEqual(calls, [["audio update", 100]]);
  resolveUpdate();
  await frame;
  await destroying;
  assert.deepEqual(calls, [["audio update", 100], "stage destroy", "audio destroy"]);
});


test("director rejects reentrant destroy from an event callback instead of deadlocking the update queue", async () => {
  let director;
  director = createCinematicDirector({
    timeline: createTimeline([{ id: "final-beat", atMs: 0, type: "story" }]),
    onEvent: async () => {
      await director.destroy();
    }
  });

  await director.mount();
  await assert.rejects(
    director.update(0),
    /Cannot destroy the cinematic director inside onEvent; use requestDestroy from the host after the callback settles/
  );
  assert.equal(director.getState().destroyed, false);
  await director.destroy();
  assert.equal(director.getState().destroyed, true);
});


test("director keeps the reentrant destroy guard active after an async event callback yields", async () => {
  let director;
  director = createCinematicDirector({
    timeline: createTimeline([{ id: "async-final-beat", atMs: 0, type: "story" }]),
    onEvent: async () => {
      await Promise.resolve();
      await director.destroy();
    }
  });

  await director.mount();
  await assert.rejects(
    director.update(0),
    /Cannot destroy the cinematic director inside onEvent; use requestDestroy from the host after the callback settles/
  );
  assert.equal(director.getState().destroyed, false,
    "reentrant destroy must be rejected without closing the director");

  await director.destroy();
  assert.equal(director.getState().destroyed, true);
});


test("director rewind resets and replays real audio cues on the same timeline as scene events", async () => {
  const played = [];
  const stopped = [];
  const delivered = [];
  const audio = createAudioCueController({
    cues: [
      { id: "opening", atMs: 100, asset: "opening" },
      { id: "impact", atMs: 300, asset: "impact" }
    ],
    play: (asset, options) => {
      const voice = { asset, id: options.id };
      played.push(voice);
      return voice;
    },
    stop: voice => stopped.push(voice.id)
  });
  const director = createCinematicDirector({
    audio,
    timeline: createTimeline([
      { id: "opening-beat", atMs: 100, type: "story" },
      { id: "impact-beat", atMs: 300, type: "story" }
    ]),
    onEvent: event => delivered.push(event.id)
  });

  await director.mount();
  await director.update(350);
  assert.deepEqual(played.map(voice => voice.id), ["opening", "impact"]);
  assert.deepEqual(delivered, ["opening-beat", "impact-beat"]);

  director.pause(350);
  director.resume(350);
  await director.update(400);
  assert.equal(played.length, 2, "pause/resume must not replay already-fired cues");

  await director.update(50);
  assert.deepEqual(stopped, ["opening", "impact"]);
  assert.equal(audio.getState().cursor, 50);

  await director.update(350);
  assert.deepEqual(played.map(voice => voice.id), ["opening", "impact", "opening", "impact"]);
  assert.deepEqual(delivered, [
    "opening-beat", "impact-beat", "opening-beat", "impact-beat"
  ]);
  assert.equal(audio.getState().cursor, 350);

  await director.destroy();
  assert.deepEqual(stopped, ["opening", "impact", "opening", "impact"]);
});


test("director unmount and remount releases old audio voices and restarts scene cues from zero", async () => {
  const voices = [];
  const played = [];
  const adapter = (await import("../src/audio/html-audio-adapter.js")).createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const listeners = new Map();
      const audio = {
        paused: true,
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
          if (listeners.get(type) === handler) listeners.delete(type);
        },
        listeners
      };
      voices.push(audio);
      return audio;
    }
  });
  const audio = createAudioCueController({
    cues: [
      { id: "theme", atMs: 0, asset: "theme", loop: true },
      { id: "impact", atMs: 80, asset: "impact" }
    ],
    play: (asset, options) => {
      played.push(options.id);
      return adapter.play(asset, options);
    },
    stop: voice => adapter.stop(voice),
    pauseVoice: voice => adapter.pause(voice),
    resumeVoice: voice => adapter.resume(voice),
    setVolume: (voice, volume) => adapter.setVolume(voice, volume)
  });
  const director = createCinematicDirector({ audio });

  await director.mount();
  await director.update(100);
  assert.deepEqual(played, ["theme", "impact"]);
  assert.equal(audio.getState().activeVoices, 2);
  const oldVoices = [...voices];
  const staleEnded = oldVoices[1].listeners.get("ended");

  director.unmount();
  assert.equal(audio.getState().cursor, -1);
  assert.equal(audio.getState().activeVoices, 0);
  assert.ok(oldVoices.every(voice => voice.paused));
  assert.ok(oldVoices.every(voice => voice.listeners.size === 0));

  // Simulate a native ended event already queued before listener removal.
  staleEnded();
  assert.equal(audio.getState().activeVoices, 0);

  await director.mount();
  await director.update(80);
  assert.deepEqual(played, ["theme", "impact", "theme", "impact"]);
  assert.equal(audio.getState().cursor, 80);
  assert.equal(audio.getState().activeVoices, 2);
  assert.equal(voices.length, 4);
  assert.ok(voices.slice(2).every(voice => !voice.paused));

  await director.destroy();
  adapter.destroy();
  assert.ok(voices.every(voice => voice.paused));
  assert.ok(voices.every(voice => voice.listeners.size === 0));
});


test("director and HTMLAudio adapter release every resource across repeated scene remounts", async () => {
  const voices = [];
  const adapter = (await import("../src/audio/html-audio-adapter.js")).createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const listeners = new Map();
      const audio = {
        paused: true,
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
          if (listeners.get(type) === handler) listeners.delete(type);
        },
        listeners
      };
      voices.push(audio);
      return audio;
    }
  });
  const audio = createAudioCueController({
    cues: [
      { id: "theme", atMs: 0, asset: "theme", loop: true },
      { id: "impact", atMs: 25, asset: "impact" }
    ],
    play: (asset, options) => adapter.play(asset, options),
    stop: voice => adapter.stop(voice),
    pauseVoice: voice => adapter.pause(voice),
    resumeVoice: voice => adapter.resume(voice),
    setVolume: (voice, volume) => adapter.setVolume(voice, volume)
  });
  const director = createCinematicDirector({ audio });

  for (let cycle = 0; cycle < 50; cycle += 1) {
    assert.equal(await director.mount(), true, `mount cycle ${cycle}`);
    await director.update(30);
    assert.equal(audio.getState().activeVoices, 2, `active voices before unmount cycle ${cycle}`);

    const currentVoices = voices.slice(cycle * 2, cycle * 2 + 2);
    const staleEnded = currentVoices[1].listeners.get("ended");
    assert.equal(currentVoices[1].listeners.size, 1);

    director.unmount();

    assert.equal(audio.getState().cursor, -1, `audio cursor after unmount cycle ${cycle}`);
    assert.equal(audio.getState().activeVoices, 0, `controller voices after unmount cycle ${cycle}`);
    assert.ok(currentVoices.every(voice => voice.paused), `native voices stopped in cycle ${cycle}`);
    assert.ok(currentVoices.every(voice => voice.listeners.size === 0), `listeners detached in cycle ${cycle}`);

    // A native event already queued before listener removal must be harmless.
    staleEnded();
    assert.equal(audio.getState().activeVoices, 0, `stale ended event in cycle ${cycle}`);
  }

  assert.equal(voices.length, 100, "each scene mount creates exactly two voices");
  await director.destroy();
  adapter.destroy();
  assert.ok(voices.every(voice => voice.paused), "all native voices remain stopped after final destroy");
  assert.ok(voices.every(voice => voice.listeners.size === 0), "no ended listeners remain after final destroy");
});


test("host-requested destroy waits for an active async event callback before releasing resources", async () => {
  let releaseEvent;
  let notifyEventStarted;
  const eventStarted = new Promise(resolve => { notifyEventStarted = resolve; });
  const eventGate = new Promise(resolve => { releaseEvent = resolve; });
  const calls = [];
  const stage = {
    mount: async () => true,
    update: async () => {},
    unmount: () => {},
    destroy: () => { calls.push("stage destroy"); }
  };
  const audio = {
    update: () => {},
    pause: () => {},
    resume: () => {},
    stopAll: () => {},
    destroy: () => { calls.push("audio destroy"); }
  };
  const director = createCinematicDirector({
    characterStage: stage,
    audio,
    timeline: createTimeline([
      { id: "active-event", atMs: 0, type: "story" },
      { id: "must-not-run", atMs: 0, type: "story" }
    ]),
    onEvent: async event => {
      calls.push(`event ${event.id} started`);
      if (event.id === "active-event") {
        notifyEventStarted();
        await eventGate;
        calls.push("event callback settled");
      }
    }
  });

  await director.mount();
  const frame = director.update(0);
  await eventStarted;
  const destroying = director.requestDestroy();

  await Promise.resolve();
  assert.deepEqual(calls, ["event active-event started"],
    "destroy must not release stage or audio while an event callback is pending");
  releaseEvent();
  await frame;
  await destroying;

  assert.deepEqual(calls, [
    "event active-event started",
    "event callback settled",
    "stage destroy",
    "audio destroy"
  ], "teardown must follow callback settlement and later events must not dispatch");
  assert.equal(director.getState().destroyed, true);
});

test("successful director destroy is idempotent across repeated calls", async () => {
  const calls = [];
  const director = createCinematicDirector({
    characterStage: {
      mount: async () => true,
      update: async () => {},
      unmount: () => {},
      destroy: () => { calls.push("stage"); }
    },
    audio: {
      update: () => {},
      pause: () => {},
      resume: () => {},
      stopAll: () => {},
      destroy: () => { calls.push("audio"); }
    }
  });

  await director.mount();
  await director.destroy();
  await director.destroy();
  await director.requestDestroy();

  assert.deepEqual(calls, ["stage", "audio"],
    "successful teardown must release each owned subsystem exactly once");
});

test("director pauses again when the host reports a late asynchronous resume rejection", async () => {
  let director;
  let rejectResume;
  const calls = [];
  const audio = {
    update: time => calls.push(["update", time]),
    pause: time => calls.push(["pause", time]),
    resume: time => {
      calls.push(["resume", time]);
      if (calls.filter(([name]) => name === "resume").length === 1) {
        queueMicrotask(() => rejectResume?.(new Error("autoplay denied")));
      }
    },
    stopAll: () => {},
    destroy: () => {}
  };
  director = createCinematicDirector({ audio });
  const rejected = new Promise(resolve => { rejectResume = error => {
    // This is the host's onPlaybackError({ phase: "resume" }) recovery path.
    director.pause();
    resolve(error);
  }; });

  await director.mount();
  await director.update(100);
  assert.equal(director.pause(100), true);
  assert.equal(director.resume(100), true);
  assert.match((await rejected).message, /autoplay denied/);
  assert.equal(director.getState().paused, true,
    "late resume rejection must return the director to a retryable paused state");

  // A later explicit user gesture can retry through the director.
  assert.equal(director.resume(100), true);
  assert.equal(director.getState().paused, false);
  await director.destroy();
});

