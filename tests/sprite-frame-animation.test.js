import test from "node:test";
import assert from "node:assert/strict";
import { createSpriteFrameAnimation } from "../src/character/sprite-frame-animation.js";

test("sprite frame animation samples deterministic looping frames from the shared clock", () => {
  const animation = createSpriteFrameAnimation({
    frames: ["walk-1", "walk-2", "walk-3"],
    frameDurationMs: 100
  });
  assert.deepEqual(animation.sample(0, { state: "moving" }), {
    frameKey: "walk-1", frameIndex: 0, playing: true
  });
  assert.equal(animation.sample(100, { state: "moving" }).frameKey, "walk-2");
  assert.equal(animation.sample(350, { state: "moving" }).frameKey, "walk-1");
  assert.deepEqual(animation.sample(100, { state: "idle" }), {
    frameKey: "walk-1", frameIndex: 0, playing: false
  });
});

test("sprite frame animation supports idle frames, delayed starts, and non-looping sequences", () => {
  const animation = createSpriteFrameAnimation({
    frames: ["attack-1", "attack-2"],
    idleFrame: "stand",
    frameDurationMs: 50,
    startTimeMs: 100,
    loop: false,
    activeState: "attacking"
  });
  assert.equal(animation.sample(99, { state: "attacking" }).frameKey, "stand");
  assert.equal(animation.sample(100, { state: "attacking" }).frameKey, "attack-1");
  assert.equal(animation.sample(150, { state: "attacking" }).frameKey, "attack-2");
  assert.equal(animation.sample(300, { state: "attacking" }).playing, false);
  assert.deepEqual(animation.frames, ["attack-1", "attack-2"]);
});

test("sprite frame animation validates configuration and sample inputs", () => {
  assert.throws(() => createSpriteFrameAnimation({ frames: [] }), /non-empty array/);
  assert.throws(() => createSpriteFrameAnimation({ frames: ["a"], frameDurationMs: 0 }), /frameDurationMs/);
  assert.throws(() => createSpriteFrameAnimation({ frames: ["a"], loop: 1 }), /loop/);
  const animation = createSpriteFrameAnimation({ frames: ["a"] });
  assert.throws(() => animation.sample(-1, { state: "moving" }), /timeMs/);
  assert.throws(() => animation.sample(0, null), /characterState/);
});
