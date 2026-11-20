import test from "node:test";
import assert from "node:assert/strict";
import { createWalkAnimation } from "../src/character/walk-animation.js";

test("walk animation is deterministic and returns a neutral pose outside movement", () => {
  const walk = createWalkAnimation({ stepPeriodMs: 400, bobAmplitude: 3, strideScale: 0.02 });
  assert.deepEqual(walk.sample(0, { state: "moving" }), walk.sample(400, { state: "moving" }));
  assert.deepEqual(walk.sample(0, { state: "idle" }), {
    active: false, offsetY: 0, scaleX: 1, scaleY: 1
  });
  assert.equal(walk.sample(100, { state: "moving" }).offsetY, -3);
  assert.equal(walk.sample(100, { state: "moving" }).scaleX, 1);
  assert.equal(walk.sample(200, { state: "moving" }).offsetY, 0);
});

test("walk animation validates configuration and sample inputs", () => {
  assert.throws(() => createWalkAnimation({ stepPeriodMs: 0 }), /stepPeriodMs/);
  assert.throws(() => createWalkAnimation({ bobAmplitude: -1 }), /bobAmplitude/);
  assert.throws(() => createWalkAnimation({ strideScale: 0.2 }), /strideScale/);
  const walk = createWalkAnimation();
  assert.throws(() => walk.sample(-1, { state: "moving" }), /timeMs/);
  assert.throws(() => walk.sample(0, null), /characterState/);
});
