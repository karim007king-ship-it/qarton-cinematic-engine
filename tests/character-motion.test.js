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

test("timeline snapshots and freezes nested JSON-like payload data", () => {
  const source = { camera: { zoom: 1.2 }, tags: ["opening", "impact"] };
  const timeline = createTimeline([
    { id: "scene", atMs: 10, type: "camera", payload: source }
  ]);

  source.camera.zoom = 9;
  source.tags.push("mutated");
  assert.deepEqual(timeline.events[0].payload, {
    camera: { zoom: 1.2 },
    tags: ["opening", "impact"]
  });
  assert.equal(Object.isFrozen(timeline.events[0].payload), true);
  assert.equal(Object.isFrozen(timeline.events[0].payload.camera), true);
  assert.equal(Object.isFrozen(timeline.events[0].payload.tags), true);
  assert.throws(() => { timeline.events[0].payload.camera.zoom = 2; }, TypeError);
  assert.throws(() => { timeline.events[0].payload.tags.push("late"); }, TypeError);
});

test("timeline safely snapshots an own __proto__ payload key", () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const timeline = createTimeline([
    { id: "prototype-key", atMs: 0, type: "metadata", payload: source }
  ]);
  const payload = timeline.events[0].payload;

  assert.equal(Object.getPrototypeOf(payload), Object.prototype);
  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.deepEqual(payload.__proto__, { polluted: true });
  assert.equal(Object.isFrozen(payload.__proto__), true);
  assert.equal(payload.polluted, undefined);
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

test("character and motion identifiers are normalized and unique", () => {
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const character = createCharacterController({
    id: "  hero  ",
    motions: [{ id: "  walk  ", path, startMs: 0, durationMs: 100 }]
  });
  assert.equal(character.id, "hero");
  assert.equal(character.update(100).id, "hero");
  assert.throws(() => createCharacterController({
    id: "hero",
    motions: [
      { id: "walk", path, startMs: 0, durationMs: 100 },
      { id: " walk ", path, startMs: 100, durationMs: 100 }
    ]
  }), /Duplicate character motion id/);
  assert.throws(() => createCharacterController({ id: "hero", initial: null }), /initial state/);
});

test("character controller snapshots mutable motion paths and rejects overflowing end times", () => {
  const mutablePath = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const character = createCharacterController({
    id: "hero",
    motions: [{ id: "walk", path: mutablePath, startMs: 0, durationMs: 100 }]
  });
  mutablePath.points[1].x = 999;
  assert.equal(character.update(100).x, 10);
  assert.throws(() => createCharacterController({
    id: "hero",
    motions: [{
      id: "overflow",
      path: createMotionPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
      startMs: Number.MAX_VALUE,
      durationMs: Number.MAX_VALUE
    }]
  }), /valid startMs/);
});
