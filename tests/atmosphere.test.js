import test from "node:test";
import assert from "node:assert/strict";
import { resolveLighting, sampleFog } from "../src/effects/atmosphere.js";

test("lighting clamps intensities and adapts shadow detail to profile", () => {
  const low = resolveLighting({ keyIntensity: 8, ambientIntensity: -1, warmth: 2, profile: { shadowQuality: "none" } });
  assert.equal(low.keyIntensity, 4);
  assert.equal(low.ambientIntensity, 0);
  assert.equal(low.warmth, 1);
  assert.equal(low.shadowEnabled, false);
  assert.equal(low.shadowOpacity, 0);
  const medium = resolveLighting({ profile: { shadowQuality: "simple" } });
  assert.equal(medium.shadowOpacity, 0.45);
  assert.throws(() => resolveLighting({ warmth: Infinity }), /finite/);
});

test("fog animation and density adapt to quality tiers", () => {
  const high = sampleFog({ timeMs: 1000, density: 0.8, driftX: 10, speed: 2, profile: { tier: "high" } });
  const low = sampleFog({ timeMs: 1000, density: 0.8, driftX: 10, speed: 2, profile: { tier: "low" } });
  assert.equal(high.density, 0.8);
  assert.equal(low.density, 0.8 * 0.35);
  assert.equal(high.offsetX, 20);
  assert.equal(low.animated, false);
  assert.throws(() => sampleFog({ timeMs: -1 }), /finite/);
});

test("fog sampling rejects overflow from extreme finite drift values", () => {
  assert.throws(() => sampleFog({
    timeMs: Number.MAX_VALUE,
    speed: Number.MAX_VALUE,
    driftX: 1
  }), /drift exceeded/);
  assert.throws(() => sampleFog({
    timeMs: 1000,
    speed: 1,
    driftY: Number.MAX_VALUE
  }), /drift exceeded/);
});
