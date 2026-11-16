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

test("HTMLAudio adapter releases naturally ended voices and notifies the cue controller", () => {
  const listeners = new Map();
  const audio = {
    paused: true,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); }
  };
  let endedVoice = null;
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/one-shot.mp3",
    createAudio: () => audio
  });
  adapter.play("one-shot", { onEnded: voice => { endedVoice = voice; } });
  listeners.get("ended")();
  assert.equal(endedVoice, audio);
  assert.equal(adapter.setVolume(audio, 0.5), false);
  assert.equal(listeners.has("ended"), false);
  adapter.destroy();
});

test("HTMLAudio adapter releases voice references when playback is rejected", async () => {
  const audio = {
    play: () => Promise.reject(new Error("autoplay blocked")),
    pause() {}
  };
  let endedVoice = null;
  const errors = [];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/blocked.mp3",
    createAudio: () => audio,
    onPlaybackError: error => errors.push(error.message)
  });
  adapter.play("blocked", { onEnded: voice => { endedVoice = voice; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(endedVoice, audio);
  assert.equal(adapter.setVolume(audio, 0.5), false);
  assert.deepEqual(errors, ["autoplay blocked"]);
  adapter.destroy();
});


test("stop releases adapter references even when the host pause method throws", () => {
  const audio = {
    play() { return Promise.resolve(); },
    pause() { throw new Error("media teardown failed"); }
  };
  const adapter = createHTMLAudioAdapter({
    resolveAsset: () => "/fragile.mp3",
    createAudio: () => audio
  });
  adapter.play("fragile");
  assert.throws(() => adapter.stop(audio), /media teardown failed/);
  assert.equal(adapter.setVolume(audio, 0.5), false);
  adapter.destroy();
});

test("destroy cleans every voice when one host pause method throws", () => {
  const first = {
    src: "",
    play() { return Promise.resolve(); },
    pause() { throw new Error("first voice failed"); }
  };
  const second = {
    src: "",
    play() { return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const voices = [first, second];
  const adapter = createHTMLAudioAdapter({
    resolveAsset: key => `/${key}.mp3`,
    createAudio: () => voices.shift()
  });
  adapter.play("first");
  adapter.play("second");
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(first.src, "");
  assert.equal(second.src, "");
  assert.equal(second.paused, true);
  assert.doesNotThrow(() => adapter.destroy());
  assert.throws(() => adapter.play("late"), /destroyed/);
});
