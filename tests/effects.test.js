import test from "node:test";
import assert from "node:assert/strict";
import { computeParallaxOffset } from "../src/effects/parallax.js";
import { sampleCameraShake } from "../src/effects/camera-shake.js";
import { createParticleField } from "../src/effects/particle-field.js";

test("parallax offset scales with depth and clamps extreme movement", () => {
  assert.deepEqual(computeParallaxOffset({ cameraX: 10, cameraY: -5, depth: 0.5 }), { x: -5, y: 2.5 });
  assert.deepEqual(computeParallaxOffset({ cameraX: 100, depth: 2, maxOffset: 20 }), { x: -20, y: 0 });
  assert.throws(() => computeParallaxOffset({ depth: Infinity }), /finite/);
});

test("parallax calculation remains finite for extreme values and zero intensity", () => {
  const extreme = Number.MAX_VALUE;
  assert.deepEqual(computeParallaxOffset({
    cameraX: extreme,
    cameraY: -extreme,
    depth: extreme,
    intensity: 0,
    maxOffset: extreme
  }), { x: 0, y: 0 });

  assert.deepEqual(computeParallaxOffset({
    cameraX: extreme,
    cameraY: -extreme,
    depth: extreme,
    maxOffset: 50
  }), { x: -50, y: 50 });

  const reordered = computeParallaxOffset({
    cameraX: extreme,
    depth: extreme,
    intensity: Number.MIN_VALUE,
    maxOffset: extreme
  });
  assert.ok(Number.isFinite(reordered.x));
  assert.ok(reordered.x < 0);
  assert.ok(reordered.x > -extreme);
});

test("camera shake is deterministic and decays to zero", () => {
  const a = sampleCameraShake({ timeMs: 250, durationMs: 1000, amplitude: 8, seed: 42 });
  const b = sampleCameraShake({ timeMs: 250, durationMs: 1000, amplitude: 8, seed: 42 });
  assert.deepEqual(a, b);
  assert.deepEqual(sampleCameraShake({ timeMs: 1000, durationMs: 1000, amplitude: 8 }), { x: 0, y: 0, rotation: 0 });
  assert.throws(() => sampleCameraShake({ timeMs: -1, durationMs: 1000 }), /invalid/);
});

test("camera shake rejects finite inputs whose phase overflows and keeps extreme amplitudes finite", () => {
  assert.throws(() => sampleCameraShake({
    timeMs: Number.MAX_VALUE / 2,
    durationMs: Number.MAX_VALUE,
    frequencyHz: Number.MAX_VALUE,
    amplitude: 1
  }), /phase calculation/);
  assert.throws(() => sampleCameraShake({
    timeMs: 1,
    durationMs: 1000,
    frequencyHz: 0,
    seed: Number.MAX_VALUE,
    amplitude: 1
  }), /phase calculation/);
  const extremeAmplitude = sampleCameraShake({
    timeMs: 1,
    durationMs: 1000,
    amplitude: Number.MAX_VALUE
  });
  assert.ok(Object.values(extremeAmplitude).every(Number.isFinite));
});

test("particle field is deterministic and respects adaptive particle budgets", () => {
  const options = { count: 20, seed: 7, width: 320, height: 180, lifetimeMs: 2000, profile: { particleBudget: 6 } };
  const a = createParticleField(options);
  const b = createParticleField(options);
  assert.equal(a.count, 6);
  assert.deepEqual(a.sample(400), b.sample(400));
  assert.equal(a.sample(400).length, 6);
  assert.ok(a.sample(400).every(particle => particle.x >= 0 && particle.x < 320 && particle.opacity >= 0 && particle.opacity <= 1));
  assert.equal(createParticleField({ ...options, profile: { maxParticles: 3 } }).count, 3);
  assert.throws(() => createParticleField({ count: -1, width: 100, height: 100 }), /invalid/);
});

test("particle field safely wraps very large timestamps and rejects non-finite derived positions", () => {
  const stable = createParticleField({
    count: 3,
    width: 100,
    height: 100,
    lifetimeMs: 3000,
    speedMin: 0,
    speedMax: 0
  });
  assert.ok(stable.sample(Number.MAX_VALUE).every(particle =>
    Number.isFinite(particle.x) && Number.isFinite(particle.y)
  ));

  const unstable = createParticleField({
    count: 1,
    width: 100,
    height: 100,
    lifetimeMs: Number.MAX_VALUE,
    speedMin: 0,
    speedMax: 0,
    gravity: Number.MAX_VALUE
  });
  assert.throws(() => unstable.sample(Number.MAX_VALUE), /position exceeded/);
});
