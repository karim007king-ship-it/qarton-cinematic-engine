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
  // A second destroy must not need to clean the already released voice.
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(paused, 1);
});

test("asynchronous play rejection releases the voice and reports once", async () => {
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
  // The cue controller already received this voice handle; retain adapter
  // ownership until its later stop/destroy call releases that handle.
  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(paused, 2);
});

test("failed asynchronous playback retains ownership when pause cleanup fails", async () => {
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
