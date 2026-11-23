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

test("out-of-order absolute keys are sorted before sparse values inherit from earlier times", () => {
  const animation = createCharacterAnimation({
    character: { id: "chronology", initial: { headRotation: -5, eyeY: 0.25 } },
    durationMs: 2000,
    keyframes: [
      { atMs: 1000, values: { headRotation: 30 } },
      { atMs: 1500, values: { eyeY: -0.5 } },
      { atMs: 0, values: { eyeX: 0.5 } },
      { atMs: 500, values: { headRotation: 10, mouthOpen: 0.4 }, easing: "linear" }
    ]
  });

  assert.deepEqual(animation.timeline.events.map(event => event.atMs), [0, 500, 1000, 1500]);
  assert.equal(animation.sample(0).headRotation, -5);
  assert.equal(animation.sample(250).headRotation, 2.5);
  assert.equal(animation.sample(250).eyeX, 0.5);
  assert.equal(animation.sample(500).headRotation, 10);
  assert.equal(animation.sample(500).eyeX, 0.5);
  assert.equal(animation.sample(500).mouthOpen, 0.4);
  assert.equal(animation.sample(750).headRotation, 20);
  assert.equal(animation.sample(750).mouthOpen, 0.4);
  assert.equal(animation.sample(1250).headRotation, 30);
  assert.equal(animation.sample(1250).eyeY, -0.125);
  const sampled750 = animation.sample(750);
  animation.sample(1250);
  animation.sample(0);
  assert.deepEqual(animation.sample(750), sampled750);
});

test("the initial pose holds before the first key and the first key takes effect at its exact time", () => {
  const animation = createCharacterAnimation({ character: { id: "first-key", initial: { headRotation: -12 } },
    durationMs: 1000, keyframes: [{ atMs: 500, values: { headRotation: 24 } }] });
  assert.equal(animation.sample(0).headRotation, -12);
  assert.equal(animation.sample(499).headRotation, -12);
  assert.equal(animation.sample(500).headRotation, 24);
  assert.equal(animation.sample(1000).headRotation, 24);
});

test("pose channels accept documented motion limits and reject values or times outside them", () => {
  const animation = createCharacterAnimation({ character: { id: "bounds" }, durationMs: 1000, keyframes: [
    { atMs: 0, values: { headRotation: -60, eyeX: -1, eyeY: -1, blink: 0, mouthOpen: 0, bodyRotation: -30 } },
    { atMs: 1000, values: { headRotation: 60, eyeX: 1, eyeY: 1, blink: 1, mouthOpen: 1, bodyRotation: 30 } }
  ] });
  assert.deepEqual(
    (({ headRotation, eyeX, eyeY, blink, mouthOpen, bodyRotation }) =>
      ({ headRotation, eyeX, eyeY, blink, mouthOpen, bodyRotation }))(animation.sample(0)),
    { headRotation: -60, eyeX: -1, eyeY: -1, blink: 0, mouthOpen: 0, bodyRotation: -30 }
  );
  assert.deepEqual(
    (({ headRotation, eyeX, eyeY, blink, mouthOpen, bodyRotation }) =>
      ({ headRotation, eyeX, eyeY, blink, mouthOpen, bodyRotation }))(animation.sample(1000)),
    { headRotation: 60, eyeX: 1, eyeY: 1, blink: 1, mouthOpen: 1, bodyRotation: 30 }
  );
  assert.throws(() => animation.sample(-1), /sample time/);
  assert.throws(() => animation.sample(1001), /sample time/);
  for (const [channel, value] of Object.entries({
    headRotation: 60.01, eyeX: -1.01, eyeY: 1.01, blink: -0.01, mouthOpen: 1.01, bodyRotation: 30.01
  })) {
    assert.throws(() => createCharacterAnimation({ character: { id: "invalid" }, durationMs: 100,
      keyframes: [{ atMs: 0, values: { [channel]: value } }] }), new RegExp(channel));
  }
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
  wall = 100;
  assert.equal(player.timeMs, 100);
  player.pause();
  const pausedAt = player.timeMs;
  wall = 500;
  assert.equal(player.timeMs, pausedAt);
  player.resume();
  wall = 700;
  assert.equal(player.timeMs, 300);
  const at900 = player.seek(900);
  assert.deepEqual(player.sample(), at900);
  wall = 800;
  assert.equal(player.timeMs, 1000);
  player.pause();
  wall = 1000;
  player.seek(400);
  assert.equal(player.timeMs, 400);
  player.resume();
  wall = 1100;
  assert.equal(player.timeMs, 500);
  player.replay();
  assert.equal(player.timeMs, 0);
  assert.equal(player.paused, false);
  wall = 1200;
  assert.equal(player.timeMs, 100);
  player.seek(2500);
  assert.equal(player.timeMs, 2000);
  player.pause();
  player.play();
  assert.equal(player.timeMs, 0);
  player.destroy();
  assert.throws(() => player.sample(), /destroyed/);
});
