import test from "node:test";
import assert from "node:assert/strict";
import { createHTMLAudioAdapter } from "../src/audio/html-audio-adapter.js";
import { createAudioCueController } from "../src/audio/audio-cue-controller.js";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";

function fakeAudio() {
  return {
    paused: true,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
}

test("HTMLAudio adapter creates voices and supports stop and volume", () => {
  const made = [];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/audio/${key}.mp3`,
    createAudio: () => { const audio = fakeAudio(); made.push(audio); return audio; }
  });
  const voice = adapter.play("impact", { loop: true, volume: 0.5 });
  assert.equal(voice.src, "/audio/impact.mp3");
  assert.equal(voice.loop, true);
  assert.equal(voice.volume, 0.5);
  adapter.setVolume(voice, 0.25);
  assert.equal(voice.volume, 0.25);
  adapter.stop(voice);
  assert.equal(voice.paused, true);
});

test("HTMLAudio validates voice volume before allocating a media object", () => {
  let allocations = 0;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/voice.mp3",
    createAudio: () => { allocations += 1; return fakeAudio(); }
  });
  assert.throws(() => adapter.play("voice", { volume: 2 }), /voice volume/);
  assert.equal(allocations, 0);
});

test("HTMLAudio adapter validates injected host functions and media objects", () => {
  assert.throws(() => createHTMLAudioAdapter({}), /requires resolveAsset/);
  const adapter = createHTMLAudioAdapter({ resolveAsset: () => "/x.mp3", createAudio: () => ({}) });
  assert.throws(() => adapter.play("x"), /HTMLAudio-like/);
  const good = createHTMLAudioAdapter({ resolveAsset: () => " " , createAudio: fakeAudio });
  assert.throws(() => good.play("x"), /return a URL/);
});

test("HTMLAudio adapter applies master volume and cleans up on destroy", () => {
  const audio = fakeAudio();
  const adapter = createHTMLAudioAdapter({ resolveAsset: () => "/theme.mp3", createAudio: () => audio });
  adapter.play("theme", { volume: 0.8 });
  adapter.setMasterVolume(0.25);
  assert.equal(audio.volume, 0.2);
  adapter.destroy();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
  assert.throws(() => adapter.play("late"), /destroyed/);
});


test("HTMLAudio destroy attempts every voice and retries transient pause failures", () => {
  const made = [];
  const calls = [];
  let failFirstPause = true;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const audio = fakeAudio();
      const id = made.length === 0 ? "first" : "second";
      audio.pause = () => {
        calls.push(id);
        if (id === "first" && failFirstPause) throw new Error("first audio pause failed");
        audio.paused = true;
      };
      made.push(audio);
      return audio;
    }
  });
  adapter.play("first");
  adapter.play("second");

  assert.throws(() => adapter.destroy(), /first audio pause failed/);
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(made[0].src, "");
  assert.equal(made[1].src, "");

  failFirstPause = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.deepEqual(calls, ["first", "second", "first"]);
  assert.throws(() => adapter.setVolume(made[0], 0.5), /destroyed/);
  assert.throws(() => adapter.play("late"), /destroyed/);
});


test("HTMLAudio adapter pauses and resumes an active voice without releasing it", () => {
  let playCalls = 0;
  const audio = fakeAudio();
  audio.play = () => { playCalls += 1; audio.paused = false; return Promise.resolve(); };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/theme.mp3",
    createAudio: () => audio
  });
  const voice = adapter.play("theme", { loop: true });
  assert.equal(playCalls, 1);
  adapter.pause(voice);
  assert.equal(audio.paused, true);
  adapter.resume(voice);
  assert.equal(audio.paused, false);
  assert.equal(playCalls, 2);
  adapter.stop(voice);
  adapter.resume(voice);
  assert.equal(audio.paused, true);
  assert.equal(playCalls, 2);
});

test("HTMLAudio reports resume rejection but ignores it after the voice is stopped", async () => {
  let rejectResume;
  const errors = [];
  const audio = fakeAudio();
  let playCount = 0;
  audio.play = () => {
    playCount += 1;
    if (playCount === 1) return Promise.resolve();
    return new Promise((_resolve, reject) => { rejectResume = reject; });
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => audio,
    onPlaybackError: (error, context) => errors.push([error.message, context.asset])
  });
  const voice = adapter.play("theme");
  adapter.pause(voice);
  adapter.resume(voice);
  adapter.stop(voice);
  rejectResume(new Error("late resume rejection"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, []);
});

test("HTMLAudio contains exceptions thrown by playback error reporting", async () => {
  const reported = [];
  const audio = fakeAudio();
  audio.play = () => Promise.reject(new Error("decode failed"));
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/voice.mp3",
    createAudio: () => audio,
    onPlaybackError: error => {
      reported.push(error.message);
      throw new Error("reporting failed");
    }
  });
  adapter.play("voice");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(reported, ["decode failed"]);
});


test("synchronous play failure releases the allocated voice and reports the error", () => {
  const failure = new Error("synchronous media failure");
  const audio = fakeAudio();
  let reported;
  let paused = 0;
  audio.play = () => { throw failure; };
  audio.pause = () => { paused += 1; audio.paused = true; };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/broken.mp3",
    createAudio: () => audio,
    onPlaybackError: error => { reported = error; }
  });

  assert.throws(() => adapter.play("broken"), error => error === failure);
  assert.equal(reported, failure);
  assert.equal(paused, 1);
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(paused, 1);
});

test("asynchronous play rejection is reported once and remains owned for teardown", async () => {
  const failure = new Error("autoplay denied");
  const audio = fakeAudio();
  let reported = 0;
  let paused = 0;
  audio.play = () => Promise.reject(failure);
  audio.pause = () => { paused += 1; audio.paused = true; };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/blocked.mp3",
    createAudio: () => audio,
    onPlaybackError: (error, context) => {
      assert.equal(error, failure);
      assert.equal(context.audio, audio);
      reported += 1;
    }
  });

  adapter.play("blocked");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reported, 1);
  assert.equal(paused, 1);
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(paused, 2);
});

test("failed asynchronous playback cleanup remains retryable", async () => {
  const audio = fakeAudio();
  const failure = new Error("play rejected");
  let pauseFails = true;
  let pauseCalls = 0;
  audio.play = () => Promise.reject(failure);
  audio.pause = () => {
    pauseCalls += 1;
    if (pauseFails) throw new Error("pause unavailable");
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/retry.mp3",
    createAudio: () => audio
  });

  adapter.play("retry");
  await Promise.resolve();
  await Promise.resolve();
  pauseFails = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 2);
});

test("naturally ended one-shot voices are released without teardown pause", () => {
  const listeners = new Map();
  let pauseCalls = 0;
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    pause() { pauseCalls += 1; this.paused = true; }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });

  adapter.play("effect");
  assert.equal(listeners.has("ended"), true);
  listeners.get("ended")();
  assert.equal(listeners.has("ended"), false);
  adapter.destroy();
  assert.equal(pauseCalls, 0);
});

test("looping voices remain owned until explicit stop", () => {
  const listeners = new Map();
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/music.mp3",
    createAudio: () => audio
  });

  adapter.play("music", { loop: true });
  assert.equal(listeners.has("ended"), false);
  adapter.stop(audio);
  assert.equal(listeners.size, 0);
});

test("volume updates do not resurrect naturally ended voices", () => {
  const listeners = new Map();
  let pauseCalls = 0;
  let volumeWrites = 0;
  const audio = {
    paused: true,
    set volume(value) { this._volume = value; volumeWrites += 1; },
    get volume() { return this._volume; },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { pauseCalls += 1; this.paused = true; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });

  adapter.play("effect");
  listeners.get("ended")();
  const writesAfterEnd = volumeWrites;
  adapter.setVolume(audio, 0.3);
  adapter.setMasterVolume(0.2);
  assert.equal(volumeWrites, writesAfterEnd);
  adapter.destroy();
  assert.equal(pauseCalls, 0);
});

test("initial play rejection after stop is ignored", async () => {
  let rejectPlay;
  const errors = [];
  const audio = fakeAudio();
  audio.play = () => new Promise((_resolve, reject) => { rejectPlay = reject; });
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/impact.mp3",
    createAudio: () => audio,
    onPlaybackError: error => errors.push(error.message)
  });

  const voice = adapter.play("impact");
  adapter.stop(voice);
  rejectPlay(new Error("late initial play rejection"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, []);
});

test("resume rejection after stop is ignored", async () => {
  let rejectResume;
  const errors = [];
  const audio = fakeAudio();
  let playCount = 0;
  audio.play = () => {
    playCount += 1;
    if (playCount === 1) return Promise.resolve();
    return new Promise((_resolve, reject) => { rejectResume = reject; });
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/theme.mp3",
    createAudio: () => audio,
    onPlaybackError: error => errors.push(error.message)
  });

  const voice = adapter.play("theme");
  adapter.pause(voice);
  adapter.resume(voice);
  adapter.stop(voice);
  rejectResume(new Error("late resume rejection"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, []);
});

test("resume rejection preserves the suspended playhead for a later retry", async () => {
  const audio = fakeAudio();
  let playCount = 0;
  let rejectResume;
  audio.currentTime = 18.75;
  audio.play = () => {
    playCount += 1;
    if (playCount === 1) return Promise.resolve();
    if (playCount === 2) return new Promise((_resolve, reject) => { rejectResume = reject; });
    return Promise.resolve();
  };
  const errors = [];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/long-theme.mp3",
    createAudio: () => audio,
    onPlaybackError: error => errors.push(error.message)
  });

  const voice = adapter.play("theme", { loop: true });
  adapter.pause(voice);
  adapter.resume(voice);
  rejectResume(new Error("resume blocked"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 18.75);
  assert.deepEqual(errors, ["resume blocked"]);

  adapter.resume(voice);
  assert.equal(playCount, 3);
  assert.equal(audio.currentTime, 18.75);
  adapter.destroy();
});

test("playback error callback exceptions are contained", async () => {
  const reported = [];
  const audio = fakeAudio();
  audio.play = () => Promise.reject(new Error("decode failed"));
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/voice.mp3",
    createAudio: () => audio,
    onPlaybackError: error => {
      reported.push(error.message);
      throw new Error("reporting failed");
    }
  });

  adapter.play("voice");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(reported, ["decode failed"]);
});


test("a queued ended event after stop does not notify the cue owner", () => {
  const listeners = new Map();
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  let endedCount = 0;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });

  const voice = adapter.play("effect", { onEnded: () => { endedCount += 1; } });
  const queuedEndedHandler = listeners.get("ended");
  adapter.stop(voice);
  queuedEndedHandler();

  assert.equal(endedCount, 0);
  assert.equal(listeners.has("ended"), false);
  adapter.destroy();
});

test("one-shot ended event notifies the cue owner and detaches its listener", () => {
  const listeners = new Map();
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  let endedVoice;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });
  adapter.play("effect", { onEnded: voice => { endedVoice = voice; } });
  listeners.get("ended")();
  assert.equal(endedVoice, audio);
  assert.equal(listeners.has("ended"), false);
  adapter.destroy();
});


test("destroy retains ownership when ended-listener removal fails during native teardown", () => {
  const listeners = new Map();
  let failPause = true;
  let failRemove = true;
  let pauseCalls = 0;
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (failRemove) throw new Error("listener removal failed");
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    pause() {
      pauseCalls += 1;
      if (failPause) throw new Error("native pause failed");
      this.paused = true;
    }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });
  adapter.play("effect");
  const endedHandler = listeners.get("ended");

  assert.throws(() => adapter.destroy(), error => error instanceof AggregateError && error.errors.some(item => item.message === "native pause failed"));
  assert.equal(listeners.has("ended"), true);

  // A queued native event must not discard the voice while destroy is retryable.
  endedHandler();
  assert.equal(listeners.has("ended"), true);

  failPause = false;
  failRemove = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 2);
  assert.equal(listeners.has("ended"), false);
});


test("stop retains voice ownership when ended-listener removal fails", () => {
  const listeners = new Map();
  let failRemove = true;
  let pauseCalls = 0;
  const audio = {
    ...fakeAudio(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (failRemove) throw new Error("listener removal failed");
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    pause() { pauseCalls += 1; this.paused = true; }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/effect.mp3",
    createAudio: () => audio
  });
  const voice = adapter.play("effect");
  const endedHandler = listeners.get("ended");

  assert.throws(() => adapter.stop(voice), /ended listener/);
  endedHandler();
  assert.equal(listeners.has("ended"), true);

  failRemove = false;
  assert.doesNotThrow(() => adapter.stop(voice));
  assert.equal(pauseCalls, 2);
  assert.equal(listeners.has("ended"), false);
  adapter.destroy();
});


test("synchronous playback failure retains ownership if ended-listener cleanup fails", () => {
  const listeners = new Map();
  let failRemove = true;
  let pauseCalls = 0;
  const failure = new Error("synchronous play failed");
  const audio = {
    ...fakeAudio(),
    play() { throw failure; },
    pause() { pauseCalls += 1; this.paused = true; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (failRemove) throw new Error("listener removal failed");
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/broken.mp3",
    createAudio: () => audio
  });

  assert.throws(() => adapter.play("broken"), error => error === failure);
  assert.equal(listeners.has("ended"), true);
  failRemove = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 2);
  assert.equal(listeners.has("ended"), false);
});


test("HTMLAudio skips ended listeners when the host cannot remove them", () => {
  let addCalls = 0;
  const audio = {
    ...fakeAudio(),
    addEventListener() { addCalls += 1; }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/limited-host.mp3",
    createAudio: () => audio
  });

  const voice = adapter.play("limited-host");
  assert.equal(addCalls, 0);
  assert.doesNotThrow(() => adapter.stop(voice));
  assert.equal(audio.paused, true);
  assert.doesNotThrow(() => adapter.destroy());
});


test("HTMLAudio master volume attempts every active voice and allows failed writes to be retried", () => {
  const calls = [];
  let failFirst = true;
  let enforceFailures = false;
  const made = [];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const audio = fakeAudio();
      const id = made.length === 0 ? "music" : "ambience";
      let currentVolume = 1;
      Object.defineProperty(audio, "volume", {
        get: () => currentVolume,
        set: value => {
          calls.push([id, value]);
          if (enforceFailures && id === "music" && failFirst) throw new Error("music volume write failed");
          currentVolume = value;
        }
      });
      made.push(audio);
      return audio;
    }
  });

  adapter.play("music", { volume: 0.8 });
  adapter.play("ambience", { volume: 0.5 });
  calls.length = 0;
  enforceFailures = true;
  assert.throws(() => adapter.setMasterVolume(0.25), /music volume write failed/);
  assert.deepEqual(calls, [["music", 0.2], ["ambience", 0.125]]);

  failFirst = false;
  assert.equal(adapter.setMasterVolume(0.25), 0.25);
  assert.deepEqual(calls.slice(2), [["music", 0.2], ["ambience", 0.125]]);
  assert.equal(made[0].volume, 0.2);
  assert.equal(made[1].volume, 0.125);
  adapter.destroy();
});

test("HTMLAudio master volume aggregates multiple voice write failures", () => {
  const calls = [];
  let enforceFailures = false;
  const first = new Error("music volume failed");
  const second = new Error("ambience volume failed");
  const made = [];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const audio = fakeAudio();
      const id = made.length === 0 ? "music" : made.length === 1 ? "ambience" : "effect";
      Object.defineProperty(audio, "volume", {
        get: () => 1,
        set: () => {
          calls.push(id);
          if (enforceFailures && id === "music") throw first;
          if (enforceFailures && id === "ambience") throw second;
        }
      });
      made.push(audio);
      return audio;
    }
  });
  adapter.play("music");
  adapter.play("ambience");
  adapter.play("effect");
  calls.length = 0;
  enforceFailures = true;
  assert.throws(() => adapter.setMasterVolume(0.6), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.deepEqual(calls, ["music", "ambience", "effect"]);
  adapter.destroy();
});


test("HTMLAudio setup setter failures release the allocated native voice", () => {
  const failure = new Error("native src assignment failed");
  const audio = fakeAudio();
  let pauseCalls = 0;
  let reported;
  Object.defineProperty(audio, "src", {
    configurable: true,
    set(value) { if (value !== "") throw failure; }
  });
  audio.pause = () => { pauseCalls += 1; audio.paused = true; };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/broken-setup.mp3",
    createAudio: () => audio,
    onPlaybackError: error => { reported = error; }
  });

  assert.throws(() => adapter.play("broken-setup"), error => error === failure);
  assert.equal(pauseCalls, 1);
  assert.equal(reported, failure);
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 1);
});

test("HTMLAudio setup failure retains ownership when native pause cleanup fails", () => {
  const failure = new Error("native volume assignment failed");
  const audio = fakeAudio();
  let pauseFails = true;
  let pauseCalls = 0;
  Object.defineProperty(audio, "volume", {
    configurable: true,
    set() { throw failure; }
  });
  audio.pause = () => {
    pauseCalls += 1;
    if (pauseFails) throw new Error("native pause unavailable");
    audio.paused = true;
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/retry-setup.mp3",
    createAudio: () => audio
  });

  assert.throws(() => adapter.play("retry-setup"), error => error === failure);
  assert.equal(pauseCalls, 1);
  pauseFails = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 2);
  assert.equal(audio.src, "");
});


test("HTMLAudio setup failure clears a source assigned before a later setter throws", () => {
  const audio = fakeAudio();
  let source = "";
  let pauseCalls = 0;
  Object.defineProperty(audio, "src", {
    configurable: true,
    get: () => source,
    set: value => { source = value; }
  });
  Object.defineProperty(audio, "loop", {
    configurable: true,
    set() { throw new Error("native loop setter failed"); }
  });
  audio.pause = () => { pauseCalls += 1; audio.paused = true; };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/partially-configured.mp3",
    createAudio: () => audio
  });

  assert.throws(() => adapter.play("partial"), /native loop setter failed/);
  assert.equal(pauseCalls, 1);
  assert.equal(source, "");
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(pauseCalls, 1);
});

test("HTMLAudio retains a setup-failed voice when source clearing fails so destroy can retry", () => {
  const audio = fakeAudio();
  let source = "";
  let sourceClearFails = true;
  let pauseCalls = 0;
  Object.defineProperty(audio, "src", {
    configurable: true,
    get: () => source,
    set: value => {
      if (value === "" && sourceClearFails) throw new Error("native source clear failed");
      source = value;
    }
  });
  Object.defineProperty(audio, "loop", {
    configurable: true,
    set() { throw new Error("native loop setter failed"); }
  });
  audio.pause = () => { pauseCalls += 1; audio.paused = true; };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/retry-source-clear.mp3",
    createAudio: () => audio
  });

  assert.throws(() => adapter.play("retry-source-clear"), /native loop setter failed/);
  assert.equal(source, "/retry-source-clear.mp3");
  assert.equal(pauseCalls, 1);
  sourceClearFails = false;
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(source, "");
  assert.equal(pauseCalls, 2);
});


test("an asynchronous HTMLAudio resume rejection returns the cinematic director to paused state", async () => {
  const errors = [];
  let playCalls = 0;
  let director;
  const audio = fakeAudio();
  audio.play = () => {
    playCalls += 1;
    audio.paused = false;
    if (playCalls === 2) return Promise.reject(new Error("autoplay denied on resume"));
    return Promise.resolve();
  };

  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/theme.mp3",
    createAudio: () => audio,
    onPlaybackError: error => {
      errors.push(error.message);
      // The host routes asynchronous adapter errors back through the owner
      // of the shared clock instead of mutating the audio adapter directly.
      if (director && !director.getState().paused) director.pause();
    }
  });
  const controller = createAudioCueController({
    cues: [{ id: "theme", atMs: 0, asset: "theme", loop: true }],
    play: (asset, options) => adapter.play(asset, options),
    stop: voice => adapter.stop(voice),
    pauseVoice: voice => adapter.pause(voice),
    resumeVoice: voice => adapter.resume(voice),
    setVolume: (voice, volume) => adapter.setVolume(voice, volume)
  });
  director = createCinematicDirector({ audio: controller });

  await director.mount();
  await director.update(0);
  director.pause(0);
  assert.equal(audio.paused, true);

  director.resume(0);
  assert.equal(director.getState().paused, false);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(errors, ["autoplay denied on resume"]);
  assert.equal(director.getState().paused, true,
    "the shared director must return to paused state after async playback rejection");
  assert.equal(audio.paused, true);

  await director.destroy();
  adapter.destroy();
});


test("HTMLAudio repeated scene cycles release every one-shot listener and ignore stale events", () => {
  const voices = [];
  let endedNotifications = 0;
  let pauseCalls = 0;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => {
      const listeners = new Map();
      const audio = {
        paused: true,
        play() { this.paused = false; return Promise.resolve(); },
        pause() { pauseCalls += 1; this.paused = true; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
          if (listeners.get(type) === handler) listeners.delete(type);
        }
      };
      audio.listeners = listeners;
      voices.push(audio);
      return audio;
    }
  });

  for (let index = 0; index < 25; index += 1) {
    const voice = adapter.play(`scene-${index}`, {
      onEnded: () => { endedNotifications += 1; }
    });
    const staleHandler = voice.listeners.get("ended");
    assert.equal(voice.listeners.size, 1);

    if (index % 2 === 0) {
      staleHandler();
      assert.equal(endedNotifications, (index / 2) + 1);
    } else {
      adapter.stop(voice);
      staleHandler();
      assert.equal(endedNotifications, Math.floor(index / 2) + 1);
    }

    assert.equal(voice.listeners.size, 0, `voice ${index} must detach its ended listener`);
  }

  assert.equal(voices.length, 25);
  assert.equal(endedNotifications, 13);
  assert.equal(pauseCalls, 12);
  assert.doesNotThrow(() => adapter.destroy());
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(voices.reduce((total, voice) => total + voice.listeners.size, 0), 0);
  assert.equal(pauseCalls, 12, "destroy must not pause voices already ended or stopped");
});

test("director remount ignores a late play rejection from the previous scene generation", async () => {
  const voices = [];
  const errors = [];
  let rejectFirstPlay;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/scene-theme.mp3",
    createAudio: () => {
      const audio = fakeAudio();
      const generation = voices.length;
      audio.play = () => {
        audio.paused = false;
        if (generation === 0) {
          return new Promise((_resolve, reject) => { rejectFirstPlay = reject; });
        }
        return Promise.resolve();
      };
      voices.push(audio);
      return audio;
    },
    onPlaybackError: error => errors.push(error.message)
  });
  const controller = createAudioCueController({
    cues: [{ id: "theme", atMs: 0, asset: "theme", loop: true }],
    play: (asset, options) => adapter.play(asset, options),
    stop: voice => adapter.stop(voice),
    pauseVoice: voice => adapter.pause(voice),
    resumeVoice: voice => adapter.resume(voice),
    setVolume: (voice, volume) => adapter.setVolume(voice, volume)
  });
  const director = createCinematicDirector({ audio: controller });

  await director.mount();
  await director.update(0);
  const oldVoice = voices[0];
  assert.equal(controller.getState().activeVoices, 1);

  director.unmount();
  assert.equal(oldVoice.paused, true);
  assert.equal(controller.getState().activeVoices, 0);

  await director.mount();
  await director.update(0);
  const currentVoice = voices[1];
  assert.equal(controller.getState().activeVoices, 1);
  assert.notEqual(currentVoice, oldVoice);

  rejectFirstPlay(new Error("late rejection from previous scene"));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(errors, [], "a rejected promise from an unmounted voice is stale");
  assert.equal(oldVoice.paused, true);
  assert.equal(currentVoice.paused, false,
    "a stale rejection must not pause or otherwise affect the remounted scene");
  assert.equal(controller.getState().activeVoices, 1);

  await director.destroy();
  adapter.destroy();
});
