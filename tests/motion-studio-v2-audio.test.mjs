import test from "node:test";
import assert from "node:assert/strict";
import { compileCinematicAudioProject, createCinematicAudioPlayer } from "../src/audio/cinematic-audio-core.js";

function makeClock(durationMs = 6000) {
  let timeMs = 0, paused = true;
  return {
    time: () => timeMs,
    pause() { paused = true; },
    resume() { paused = false; },
    seek(value) { timeMs = Math.max(0, Math.min(durationMs, value)); },
    advance(value) { if (!paused) timeMs += value; },
    get paused() { return paused; }
  };
}

test("V2 audio uses the shared sequence clock and honors a trimmed source offset", () => {
  const clock = makeClock();
  const project = compileCinematicAudioProject({
    durationMs: 6000,
    tracks: [
      { id: "audio-dialogue", type: "dialogue", volume: 0.8, clips: [{ id: "voice", asset: "voice-a", startMs: 2500, sourceStartMs: 700, durationMs: 2000, language: "ar" }] },
      { id: "audio-music", type: "music", volume: 0.5, clips: [{ id: "music", asset: "music-a", startMs: 0, durationMs: 6000 }] },
      { id: "audio-sfx", type: "sfx", volume: 1, clips: [] }
    ]
  });
  const calls = [];
  const player = createCinematicAudioPlayer(project, {
    clock,
    play(asset, options) { calls.push({ asset, ...options }); return { id: options.id }; },
    stop() {},
    setVolume() {}
  });
  player.play();
  assert.equal(clock.paused, false);
  assert.equal(player.activeVoiceCount, 1);
  assert.equal(calls[0].asset, "music-a");
  clock.seek(2500);
  player.seek(2500);
  assert.equal(player.activeVoiceCount, 2);
  assert.equal(calls.findLast(call => call.asset === "voice-a").offsetMs, 700);
  clock.seek(4000);
  player.seek(4000);
  assert.equal(calls.findLast(call => call.asset === "voice-a").offsetMs, 2200);
  player.pause();
  assert.equal(clock.paused, true);
  assert.equal(player.activeVoiceCount, 0);
  player.destroy();
});

test("failed or invalid clips never pass compiled validation", () => {
  assert.throws(() => compileCinematicAudioProject({
    durationMs: 3000,
    tracks: [{ id: "audio-dialogue", type: "dialogue", clips: [{ id: "bad", asset: "a", startMs: 0, sourceStartMs: -1, durationMs: 1000, language: "ar" }] }]
  }), /source|clip|integer|range/iu);
});
