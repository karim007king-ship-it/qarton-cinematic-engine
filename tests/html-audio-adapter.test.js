import test from "node:test";
import assert from "node:assert/strict";
import { createHTMLAudioAdapter } from "../src/audio/html-audio-adapter.js";

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
