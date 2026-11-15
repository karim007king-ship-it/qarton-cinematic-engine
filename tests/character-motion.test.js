import test from "node:test";
import assert from "node:assert/strict";
import { createMotionPath, sampleMotionPath } from "../src/motion/path.js";
import { createTimeline, getTimelineEvents } from "../src/motion/timeline.js";
import { createCharacterController } from "../src/character/character-controller.js";

test("motion paths validate points and sample endpoints and segments", () => {
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }]);
  assert.deepEqual(sampleMotionPath(path, 0), { x: 0, y: 0 });
  assert.deepEqual(sampleMotionPath(path, 0.5), { x: 10, y: 20 });
  assert.deepEqual(sampleMotionPath(path, 1), { x: 20, y: 0 });
  assert.deepEqual(sampleMotionPath(path, 2), { x: 20, y: 0 });
  assert.throws(() => createMotionPath([{ x: 0, y: 0 }]), /at least two/);
  assert.throws(() => createMotionPath([{ x: 0, y: 0 }, { x: NaN, y: 1 }]), /finite/);
});

test("timeline sorts events stably and returns the forward time window", () => {
  const timeline = createTimeline([
    { id: "late", atMs: 900, type: "sound" },
    { id: "pose", atMs: 250, type: "expression", target: "hero", payload: { name: "surprised" } },
    { id: "camera", atMs: 250, type: "camera" }
  ]);
  assert.deepEqual(timeline.events.map(event => event.id), ["pose", "camera", "late"]);
  assert.deepEqual(getTimelineEvents(timeline, { fromMs: 250, toMs: 900 }).map(event => event.id), ["late"]);
  assert.throws(() => createTimeline([{ id: "x", atMs: -1, type: "x" }]), /atMs/);
  assert.throws(() => createTimeline([
    { id: "x", atMs: 0, type: "x" }, { id: "x", atMs: 1, type: "y" }
  ]), /unique id/);
});

test("character controller samples movement and expression without DOM dependencies", () => {
  const path = createMotionPath([{ x: 5, y: 10 }, { x: 105, y: 10 }]);
  const character = createCharacterController({
    id: "hero",
    initial: { x: 5, y: 10, expression: "neutral" },
    motions: [{ id: "walk", path, startMs: 100, durationMs: 1000, expression: "focused" }]
  });
  assert.deepEqual(
    (({ x, y, expression, state }) => ({ x, y, expression, state }))(character.update(0)),
    { x: 5, y: 10, expression: "neutral", state: "idle" }
  );
  const moving = character.update(600);
  assert.equal(moving.x, 55);
  assert.equal(moving.expression, "focused");
  assert.equal(moving.state, "moving");
  const finished = character.update(1200);
  assert.equal(finished.x, 105);
  assert.equal(finished.state, "idle");
  assert.throws(() => character.update(-1), /timeMs/);
});

test("character controller rejects overlapping or malformed motions", () => {
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.throws(() => createCharacterController({
    id: "hero",
    motions: [
      { id: "a", path, startMs: 0, durationMs: 100 },
      { id: "b", path, startMs: 50, durationMs: 100 }
    ]
  }), /overlap/);
  assert.throws(() => createCharacterController({ id: "hero", motions: [{ id: "bad" }] }), /valid path/);
});

test("character dialogue cues deterministically animate speech and expression transitions", () => {
  const character = createCharacterController({
    id: "speaker",
    initial: { expression: "neutral" },
    dialogue: [{
      startMs: 100,
      endMs: 700,
      expression: "happy",
      transitionMs: 240
    }]
  });
  const before = character.update(99);
  assert.equal(before.speaking, false);
  assert.equal(before.expression, "neutral");

  const start = character.update(100);
  assert.equal(start.speaking, true);
  assert.equal(start.expression, "happy");
  assert.equal(start.mouthFrame, 0);
  assert.equal(start.expressionTransition, 0);

  const mid = character.update(220);
  assert.equal(mid.speaking, true);
  assert.equal(mid.mouthFrame, 1);
  assert.equal(mid.expressionTransition, 0.5);

  const later = character.update(340);
  assert.equal(later.mouthFrame, 0);
  assert.equal(later.expressionTransition, 1);

  const after = character.update(700);
  assert.equal(after.speaking, false);
  assert.equal(after.mouthFrame, 0);
  assert.equal(after.expression, "neutral");
});

test("character dialogue cues reject invalid and overlapping intervals", () => {
  assert.throws(() => createCharacterController({
    id: "speaker",
    dialogue: [{ startMs: 100, endMs: 100 }]
  }), /valid startMs and endMs/);
  assert.throws(() => createCharacterController({
    id: "speaker",
    dialogue: [
      { startMs: 100, endMs: 300 },
      { startMs: 250, endMs: 400 }
    ]
  }), /cannot overlap/);
});


test("facial motion is deterministic, subtle, and supports reduced-motion profiles", () => {
  const character = createCharacterController({ id: "hero" });
  const first = character.update(900);
  const repeated = character.update(900);
  assert.deepEqual(
    { breathOffsetY: first.breathOffsetY, headRotation: first.headRotation, eyeFrame: first.eyeFrame },
    { breathOffsetY: repeated.breathOffsetY, headRotation: repeated.headRotation, eyeFrame: repeated.eyeFrame }
  );
  assert.ok(Math.abs(first.breathOffsetY) <= 1.25);
  assert.ok(Math.abs(first.headRotation) <= 0.2);
  assert.equal(character.update(0).eyeFrame, 1);
  assert.equal(character.update(200).eyeFrame, 0);

  const reduced = createCharacterController({
    id: "hero",
    facialMotion: { reducedMotion: true }
  }).update(0);
  assert.deepEqual(
    { breathOffsetY: reduced.breathOffsetY, headRotation: reduced.headRotation, eyeFrame: reduced.eyeFrame },
    { breathOffsetY: 0, headRotation: 0, eyeFrame: 0 }
  );

  const lowPower = createCharacterController({
    id: "hero",
    facialMotion: { motionScale: 0 }
  }).update(0);
  assert.equal(lowPower.breathOffsetY, 0);
  assert.equal(lowPower.headRotation, 0);
  assert.equal(lowPower.eyeFrame, 0);
});

test("facial motion follows speaking state and validates its configuration", () => {
  const character = createCharacterController({
    id: "speaker",
    dialogue: [{ startMs: 0, endMs: 1000 }]
  });
  assert.ok(Math.abs(character.update(300).headRotation) <= 0.65);
  assert.throws(() => createCharacterController({
    id: "hero",
    facialMotion: null
  }), /facialMotion/);
});

test("pose clips interpolate arm and leg layer transforms deterministically", () => {
  const character = createCharacterController({
    id: "hero",
    poseClips: [{
      id: "walk-cycle",
      pose: "walk",
      startMs: 100,
      durationMs: 1000,
      loop: true,
      layers: {
        "left-arm": [
          { at: 0, rotation: -30, translateY: 0 },
          { at: 0.5, rotation: 30, translateY: 4 },
          { at: 1, rotation: -30, translateY: 0 }
        ],
        "right-leg": [
          { at: 0, translateX: -8 },
          { at: 0.5, translateX: 8 },
          { at: 1, translateX: -8 }
        ]
      }
    }]
  });
  assert.equal(character.update(99).pose, "idle");
  const quarter = character.update(350);
  assert.equal(quarter.pose, "walk");
  assert.equal(quarter.poseProgress, 0.25);
  assert.equal(quarter.layerTransforms["left-arm"].rotation, 0);
  assert.equal(quarter.layerTransforms["left-arm"].translateY, 2);
  assert.equal(quarter.layerTransforms["right-leg"].translateX, 0);
  assert.deepEqual(character.update(350).layerTransforms, quarter.layerTransforms);
  assert.equal(character.update(600).layerTransforms["left-arm"].rotation, 30);
  assert.equal(character.update(1350).poseProgress, 0.25);
});

test("pose motion scale and reduced-motion settings limit animated transforms", () => {
  const poseClips = [{
    id: "hit",
    startMs: 0,
    durationMs: 1000,
    layers: {
      torso: [
        { at: 0, rotation: 0, translateY: 0 },
        { at: 1, rotation: 40, translateY: 20 }
      ]
    }
  }];
  const scaled = createCharacterController({
    id: "hero", poseClips, poseMotion: { motionScale: 0.5 }
  }).update(1000);
  assert.equal(scaled.layerTransforms.torso.rotation, 20);
  assert.equal(scaled.layerTransforms.torso.translateY, 10);

  const reduced = createCharacterController({
    id: "hero", poseClips, poseMotion: { reducedMotion: true }
  }).update(800);
  assert.equal(reduced.poseProgress, 0);
  assert.equal(reduced.layerTransforms.torso.rotation, 0);
  assert.equal(reduced.layerTransforms.torso.translateY, 0);
});

test("pose clips reject malformed keyframes and overlapping clips", () => {
  assert.throws(() => createCharacterController({
    id: "hero",
    poseClips: [{
      id: "bad", startMs: 0, durationMs: 100,
      layers: { arm: [{ at: 0.2, rotation: 0 }, { at: 1, rotation: 10 }] }
    }]
  }), /cover 0..1/);
  assert.throws(() => createCharacterController({
    id: "hero",
    poseClips: [
      { id: "a", startMs: 0, durationMs: 200, layers: { arm: [{ at: 0 }, { at: 1 }] } },
      { id: "b", startMs: 100, durationMs: 200, layers: { arm: [{ at: 0 }, { at: 1 }] } }
    ]
  }), /cannot overlap/);
});
