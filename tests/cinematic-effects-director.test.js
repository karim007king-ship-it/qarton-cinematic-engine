import test from "node:test";
import assert from "node:assert/strict";
import { CINEMATIC_MOODS, CINEMATIC_SHOTS, CINEMATIC_TRANSITIONS, compileTextCinematicDirection, sampleCinematicDirector } from "../src/effects/cinematic-director.js";

test("cinematic moods provide reusable direction, shot sizes and transition choices", () => {
  assert.deepEqual(Object.keys(CINEMATIC_MOODS), ["calm", "emotional", "mystery", "fear", "confrontation", "sad", "heroic", "siege"]);
  assert.deepEqual(CINEMATIC_SHOTS, { wide: .9, medium: 1, close: 1.14 });
  assert.deepEqual(CINEMATIC_TRANSITIONS, ["cut", "crossfade", "through-black", "through-light", "focus"]);
  const direction = compileTextCinematicDirection({ durationMs: 8000, mood: "siege", shot: "close", timeOfDay: "night", seed: 7 });
  const sample = sampleCinematicDirector(direction, 1200);
  assert.equal(sample.effects.layers.length, 0, "director metadata must not become opaque full-frame overlays");
  assert.equal(sample.parallaxLayers.length, 2);
  assert.equal(sample.transition, "through-light");
  assert.equal(sample.shotScale, 1.14);
  assert.ok(sample.fields.some(field => field.kind === "smoke"));
  assert.ok(sample.fields.some(field => field.kind === "rain"));
  assert.ok(sample.fire > 0);
  assert.ok(sample.shadows > 0);
});

test("cinematic effects are deterministic at absolute time across seek and replay", () => {
  const direction = compileTextCinematicDirection({ durationMs: 8000, mood: "mystery", seed: 128, timeOfDay: "night" });
  const first = sampleCinematicDirector(direction, 3250);
  sampleCinematicDirector(direction, 6500);
  assert.deepEqual(sampleCinematicDirector(direction, 3250), first);
  assert.deepEqual(first.parallaxLayers, sampleCinematicDirector(direction, 3250).parallaxLayers);
  assert.notDeepEqual(first.parallaxLayers, sampleCinematicDirector(direction, 6500).parallaxLayers);
  assert.ok(first.fog.density > 0);
  assert.ok(first.fields.some(field => field.particles.some(particle => particle.opacity > 0)));
});

test("effects can be disabled without disabling shot or scene timing and reject malformed profiles", () => {
  const disabled = compileTextCinematicDirection({ durationMs: 2000, mood: "fear", shot: "wide", enabled: false, strength: .8 });
  const sample = sampleCinematicDirector(disabled, 700);
  assert.equal(sample.enabled, false);
  assert.equal(sample.shotScale, 1);
  assert.equal(sample.fields.length, 0);
  assert.equal(sample.effects.vignette, 0);
  assert.throws(() => compileTextCinematicDirection({ durationMs: 1000, mood: "unknown" }), /mood/u);
  assert.throws(() => compileTextCinematicDirection({ durationMs: 1000, shot: "extreme" }), /shot size/u);
});
