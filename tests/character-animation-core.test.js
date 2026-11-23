import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterAnimation, createCharacterAnimationPlayer } from "../src/character/animation-core.js";

const character = {
  id: "hero",
  initial: { x: 12, expression: "neutral" },
  animation: { clips: { idle: { fps: 4, frames: [0, 1, 2, 3], loop: true,
    spriteSheet: { asset: "hero-sheet.svg", frameWidth: 64, frameHeight: 64, columns: 2, frameCount: 4 } } } }
};
const keyframes = [
  { atMs: 0, values: { headRotation: -8, eyeX: -0.2, expression: "neutral", gesture: "neutral" } },
  { atMs: 500, values: { headRotation: 18, eyeX: 0.4, eyeY: -0.2, expression: "curious", gesture: "wave", mouthOpen: 0.7 } },
  { atMs: 900, values: { blink: 1, mouthOpen: 0 }, easing: "linear" },
  { atMs: 1050, values: { blink: 0, bodyRotation: 7, expression: "happy" } },
  { atMs: 1500, values: { mouthOpen: 1, gesture: "talk" } },
  { atMs: 1900, values: { mouthOpen: 0, gesture: "neutral" } }
];

test("character animation samples keyframed face, head, and gesture state deterministically", () => {
  const animation = createCharacterAnimation({ character, durationMs: 2000, keyframes });
  const first = animation.sample(250);
  const repeated = animation.sample(250);
  assert.deepEqual(repeated, first);
  assert.equal(first.id, "hero");
  assert.equal(first.x, 12);
  assert.equal(first.expression, "neutral");
  assert.equal(first.gesture, "neutral");
  assert.ok(first.headRotation > -8 && first.headRotation < 18);
  assert.ok(first.eyeX > -0.2 && first.eyeX < 0.4);
  assert.equal(animation.sample(720).expression, "curious");
  assert.equal(animation.sample(1050).expression, "happy");
  assert.equal(animation.sample(1050).blink, 0);
  assert.deepEqual(animation.timeline.events.map(event => event.atMs), [0, 500, 900, 1050, 1500, 1900]);
});

test("character keyframe boundaries hold first and last values and frame sequences use sprite sheets", () => {
  const animation = createCharacterAnimation({ character, durationMs: 2000, keyframes });
  assert.equal(animation.sample(0).headRotation, -8);
  assert.equal(animation.sample(2000).mouthOpen, 0);
  const frame = animation.sample(750).spriteFrame;
  assert.equal(frame.asset, "hero-sheet.svg");
  assert.deepEqual([frame.x, frame.y, frame.width, frame.height], [64, 64, 64, 64]);
  assert.strictEqual(animation.sample(760).spriteFrame, frame);
  assert.deepEqual(animation.frameAssets, ["hero-sheet.svg"]);
});

test("character animation rejects invalid times, duplicate keys, channel bounds, and easing names", () => {
  assert.throws(() => createCharacterAnimation({ character, durationMs: 0 }), /duration/);
  assert.throws(() => createCharacterAnimation({ character, durationMs: 100, keyframes: [
    { atMs: 0, values: { headRotation: 0 } }, { atMs: 0, values: { headRotation: 1 } }
  ] }), /Duplicate/);
  assert.throws(() => createCharacterAnimation({ character, durationMs: 100, keyframes: [
    { atMs: 101, values: { mouthOpen: 0 } }
  ] }), /time/);
  assert.throws(() => createCharacterAnimation({ character, durationMs: 100, keyframes: [
    { atMs: 0, values: { eyeX: 3 } }
  ] }), /eyeX/);
  assert.throws(() => createCharacterAnimation({ character, durationMs: 100, keyframes: [
    { atMs: 0, values: { unknown: 1 } }
  ] }), /unsupported/);
  assert.throws(() => createCharacterAnimation({ character, durationMs: 100, keyframes: [
    { atMs: 0, values: { blink: 0 }, easing: "bounce" }
  ] }), /easing/);
  assert.throws(() => createCharacterAnimation({ character: { id: "bad", animation: { clips: {
    idle: { fps: 8, frames: [4], spriteSheet: { asset: "sheet", frameWidth: 16, frameHeight: 16, columns: 2, frameCount: 4 } }
  } } }, durationMs: 100 }), /frame index/);
});

test("character animation player uses the shared scene clock for pause, seek, resume, and replay", () => {
  let wall = 0;
  const animation = createCharacterAnimation({ character, durationMs: 2000, keyframes });
  const player = createCharacterAnimationPlayer(animation, { now: () => wall });
  assert.equal(player.paused, true);
  player.play();
  wall = 250;
  assert.equal(player.timeMs, 250);
  const at250 = player.seek(250);
  assert.deepEqual(player.sample(), at250);
  wall = 500;
  player.pause();
  const pausedAt = player.timeMs;
  wall = 900;
  assert.equal(player.timeMs, pausedAt);
  player.resume();
  wall += 100;
  assert.equal(player.timeMs, pausedAt + 100);
  player.seek(2000);
  player.play();
  assert.equal(player.timeMs, 0);
  assert.equal(player.paused, false);
  player.destroy();
  assert.throws(() => player.sample(), /destroyed/);
});
