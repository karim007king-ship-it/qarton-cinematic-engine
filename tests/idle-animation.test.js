import test from "node:test";
import assert from "node:assert/strict";
import { createIdleAnimation } from "../src/character/idle-animation.js";

test("idle animation is deterministic and returns a stable neutral pose", () => {
  const idle = createIdleAnimation();
  assert.deepEqual(idle.sample(0), idle.sample(0));
  assert.equal(idle.sample(0).blinking, true);
  assert.equal(idle.sample(200).blinking, false);
  assert.equal(idle.sample(4200).blinking, true);
});

test("breathing motion stays within configured bounds and loops", () => {
  const idle = createIdleAnimation({
    periodMs: 2000,
    bobAmplitude: 3,
    swayAmplitude: 0.02,
    blinkIntervalMs: 5000
  });
  const first = idle.sample(350);
  const looped = idle.sample(2350);
  assert.deepEqual(looped, first);
  assert.ok(first.offsetY <= 0 && first.offsetY >= -3);
  assert.ok(first.scaleX >= 0.98 && first.scaleX <= 1.02);
  assert.ok(first.scaleY >= 0.99 && first.scaleY <= 1.01);
});

test("blink animation reaches its closed-eye scale at the midpoint", () => {
  const idle = createIdleAnimation({
    blinkIntervalMs: 1000,
    blinkDurationMs: 200,
    blinkAmount: 0.9
  });
  assert.equal(idle.sample(100).blinking, true);
  assert.ok(Math.abs(idle.sample(100).blinkScaleY - 0.1) < 1e-12);
  assert.equal(idle.sample(200).blinking, false);
});

test("idle animation validates timing and amplitude configuration", () => {
  assert.throws(() => createIdleAnimation({ periodMs: 0 }), /periodMs/);
  assert.throws(() => createIdleAnimation({ blinkDurationMs: 5000 }), /shorter/);
  assert.throws(() => createIdleAnimation({ bobAmplitude: -1 }), /bobAmplitude/);
  assert.throws(() => createIdleAnimation({ swayAmplitude: 0.2 }), /swayAmplitude/);
  assert.throws(() => createIdleAnimation({ blinkAmount: 2 }), /blinkAmount/);
  assert.throws(() => createIdleAnimation({ phaseOffsetMs: NaN }), /phaseOffsetMs/);
  assert.throws(() => createIdleAnimation().sample(-1), /timeMs/);
});
