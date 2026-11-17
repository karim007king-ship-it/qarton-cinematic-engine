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


test("naturally ended non-looping voices leave the active registry", () => {
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

  // An already-ended one-shot must not be paused again during teardown.
  adapter.destroy();
  assert.equal(pauseCalls, 0);
});

test("looping voices do not detach on ended events and stop removes their listener", () => {
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
  assert.equal(listeners.has("ended"), false);
});
