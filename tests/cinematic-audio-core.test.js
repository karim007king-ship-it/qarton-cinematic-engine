import test from "node:test";
import assert from "node:assert/strict";
import { compileCinematicAudioProject, createCinematicAudioPlayer } from "../src/audio/cinematic-audio-core.js";

const projectData = {
  durationMs: 5000,
  tracks: [
    { id: "dialogue", type: "dialogue", volume: 0.8, clips: [{
      id: "line-ar", asset: "voice-ar-01", startMs: 500, durationMs: 2000, language: "ar",
      visemes: [
        { atMs: 0, phoneme: "م", viseme: "closed" },
        { atMs: 300, phoneme: "ا", viseme: "open" },
        { atMs: 900, phoneme: "و", viseme: "round" },
        { atMs: 1700, phoneme: "سكون", viseme: "rest" }
      ]
    }] },
    { id: "music", type: "music", volume: 0.5, clips: [{ id: "bed", asset: "score", startMs: 0, durationMs: 5000, loop: true }] },
    { id: "effects", type: "sfx", clips: [{ id: "bell", asset: "bell", startMs: 2500, durationMs: 400 }] }
  ]
};

test("cinematic audio compiles dialogue, music and SFX into an ordered immutable timeline", () => {
  const compiled = compileCinematicAudioProject(projectData);
  assert.deepEqual(compiled.tracks.map(track => track.type), ["dialogue", "music", "sfx"]);
  assert.deepEqual(compiled.timeline.events.map(event => event.atMs), [...compiled.timeline.events.map(event => event.atMs)].sort((a, b) => a - b));
  assert.equal(compiled.sample(2400).activeClips.length, 2);
  assert.equal(compiled.sample(1000).dialogue[0].phoneme, "ا");
  assert.equal(compiled.sample(1000).dialogue[0].mouthOpen, 1);
  assert.equal(compiled.sample(4500).dialogue.length, 0);
  assert.throws(() => { compiled.tracks[0].clips[0].visemes[0].viseme = "open"; }, TypeError);
});

test("Arabic and Tunisian prepared viseme samples are absolute-time deterministic", () => {
  const data = structuredClone(projectData);
  data.tracks[0].clips[0].language = "tn";
  const compiled = compileCinematicAudioProject(data);
  const first = compiled.sample(1700);
  compiled.sample(4000);
  assert.deepEqual(compiled.sample(1700), first);
  assert.equal(first.dialogue[0].language, "tn");
  assert.equal(first.dialogue[0].phoneme, "و");
  assert.equal(compiled.sample(1400).dialogue[0].viseme, "round");
});

test("dialogue timing and volume validation reject invalid tracks atomically", () => {
  assert.throws(() => compileCinematicAudioProject({ ...projectData, durationMs: 0 }), RangeError);
  assert.throws(() => compileCinematicAudioProject({ ...projectData, tracks: [{ ...projectData.tracks[0], volume: 1.1 }] }), RangeError);
  const badLang = structuredClone(projectData); badLang.tracks[0].clips[0].language = "auto";
  assert.throws(() => compileCinematicAudioProject(badLang), /language/);
  const duplicateCue = structuredClone(projectData); duplicateCue.tracks[0].clips[0].visemes[1].atMs = 0;
  assert.throws(() => compileCinematicAudioProject(duplicateCue), /duplicate viseme/);
  const badClip = structuredClone(projectData); badClip.tracks[1].clips[0].durationMs = 6000;
  assert.throws(() => compileCinematicAudioProject(badClip), /fit inside/);
  const wrongLoop = structuredClone(projectData); wrongLoop.tracks[2].clips[0].loop = true;
  assert.throws(() => compileCinematicAudioProject(wrongLoop), /Only music/);
});

test("scene transport synchronizes cues to one clock through play, pause, seek, resume and replay", () => {
  let now = 0;
  const played = [];
  const stopped = [];
  const levels = [];
  const compiled = compileCinematicAudioProject(projectData);
  const player = createCinematicAudioPlayer(compiled, {
    now: () => now,
    play: (asset, options) => { const voice = { asset, options }; played.push(voice); return voice; },
    stop: voice => stopped.push(voice.asset),
    setVolume: (voice, value) => levels.push([voice.asset, value])
  });
  player.play();
  assert.equal(player.state, "playing");
  assert.deepEqual(played.map(item => item.asset), ["score"]);
  now = 750;
  assert.equal(player.tick().dialogue[0].viseme, "closed");
  assert.equal(played.at(-1).asset, "voice-ar-01");
  assert.equal(played.at(-1).options.offsetMs, 250);
  player.pause();
  const pausedAt = player.timeMs;
  now = 4000;
  assert.equal(player.timeMs, pausedAt);
  assert.equal(player.activeVoiceCount, 0);
  player.resume();
  assert.equal(played.findLast(item => item.asset === "voice-ar-01").options.offsetMs, 250);
  const sampled = player.seek(1300);
  assert.equal(sampled.dialogue[0].viseme, "open");
  assert.equal(played.findLast(item => item.asset === "voice-ar-01").options.offsetMs, 800);
  player.setMasterVolume(0.5);
  player.setTrackVolume("dialogue", 0.25);
  assert.deepEqual(levels.slice(-3), [["voice-ar-01", 0.4], ["score", 0.25], ["voice-ar-01", 0.125]]);
  now = 8000;
  player.tick();
  assert.equal(player.state, "ended");
  assert.equal(player.activeVoiceCount, 0);
  assert.equal(player.replay().timeMs, 0);
  assert.equal(player.state, "playing");
  assert.equal(player.destroy(), true);
  assert.equal(player.destroy(), false);
  assert.ok(stopped.length >= 4);
  assert.throws(() => player.seek(0), /destroyed/);
});

test("seeking while paused does not allocate voices and out-of-range seeks are rejected", () => {
  const compiled = compileCinematicAudioProject(projectData);
  const played = [];
  const player = createCinematicAudioPlayer(compiled, { play: asset => { played.push(asset); return asset; } });
  assert.equal(player.seek(1000).dialogue[0].viseme, "open");
  assert.equal(played.length, 0);
  assert.equal(player.seek(5001).timeMs, compiled.durationMs);
  assert.equal(player.state, "ended");
  player.destroy();
});

test("destroy remains closed and retries a voice whose adapter cleanup failed", () => {
  const compiled = compileCinematicAudioProject(projectData);
  let shouldFail = true;
  let stopAttempts = 0;
  const player = createCinematicAudioPlayer(compiled, {
    play: () => ({ id: "music" }),
    stop: () => { stopAttempts += 1; if (shouldFail) throw new Error("temporary stop failure"); }
  });
  player.play();
  assert.throws(() => player.destroy(), /temporary stop failure/);
  assert.equal(player.state, "destroying");
  assert.throws(() => player.play(), /destroyed/);
  shouldFail = false;
  assert.equal(player.destroy(), true);
  assert.equal(stopAttempts, 2);
  assert.equal(player.state, "destroyed");
});
