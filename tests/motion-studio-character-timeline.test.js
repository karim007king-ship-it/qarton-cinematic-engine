import assert from "node:assert/strict";
import test from "node:test";
import { addCharacterKeyframe, compileCharacterTrack, deleteCharacterKeyframe, makeCharacterTrack,
  moveCharacterKeyframe, updateCharacterKeyframe } from "../examples/motion-studio-lab/studio-character-track.js";
import { makeProject, makeProjectFile, parseProjectFile } from "../examples/motion-studio-lab/studio-model.js";

const duration = 12000;
function seeded() {
  let track = makeCharacterTrack();
  track = addCharacterKeyframe(track, { atMs: 0, values: { headRotation: -10, expression: "neutral" } }, duration);
  track = addCharacterKeyframe(track, { atMs: 6000, values: { headRotation: 30, eyeX: .8, blink: 1, mouthOpen: .7, expression: "happy", gesture: "wave" } }, duration);
  track = addCharacterKeyframe(track, { atMs: duration, values: { headRotation: 0, eyeX: 0, blink: 0, mouthOpen: 0 } }, duration);
  return track;
}

test("character key operations are immutable, sorted, and keep distinct keys", () => {
  const source = seeded();
  const moved = moveCharacterKeyframe(source, 6000, 8000, duration);
  assert.deepEqual(moved.keyframes.map(key => key.atMs), [0, 8000, duration]);
  assert.deepEqual(source.keyframes.map(key => key.atMs), [0, 6000, duration]);
  const edited = updateCharacterKeyframe(moved, 8000, { mouthOpen: .9 }, duration);
  assert.equal(edited.keyframes[1].values.mouthOpen, .9);
  const deleted = deleteCharacterKeyframe(edited, 8000, duration);
  assert.deepEqual(deleted.keyframes.map(key => key.atMs), [0, duration]);
});

test("character keys reject collisions, invalid channels, ranges, and times atomically", () => {
  const track = seeded();
  assert.throws(() => moveCharacterKeyframe(track, 6000, duration, duration), /يوجد مفتاح/);
  assert.throws(() => moveCharacterKeyframe(track, 6000, duration + 1, duration), RangeError);
  assert.throws(() => addCharacterKeyframe(track, { atMs: 1000, values: { blink: 2 } }, duration), RangeError);
  assert.throws(() => updateCharacterKeyframe(track, 6000, { mystery: 1 }, duration), /unsupported/);
  assert.equal(track.keyframes[1].values.blink, 1);
});

test("L7-A sampling makes repeated seeks deterministic and inherits partial values", () => {
  const animation = compileCharacterTrack(seeded(), duration);
  const first = animation.sample(3000);
  animation.sample(9000);
  const repeated = animation.sample(3000);
  assert.deepEqual(first, repeated);
  assert.equal(first.headRotation, 10);
  assert.equal(first.expression, "neutral");
  assert.equal(animation.sample(6000).gesture, "wave");
  assert.equal(animation.sample(0).headRotation, -10);
  assert.equal(animation.sample(duration).headRotation, 0);
});

test("character tracks round-trip in Studio JSON and legacy JSON receives an empty track", () => {
  const project = makeProject({ durationMs: duration, startZoom: 1, endZoom: 1.2, startX: 0, endX: 0, startY: 0, endY: 0 });
  const track = seeded();
  const encoded = JSON.stringify(makeProjectFile(project, null, { aspectPreset: "original", fitMode: "fit" }, track));
  assert.deepEqual(parseProjectFile(encoded).characterTrack, track);
  const legacy = makeProjectFile(project); delete legacy.settings;
  const parsedLegacy = parseProjectFile(JSON.stringify(legacy));
  assert.deepEqual(parsedLegacy.characterTrack.keyframes, []);
  assert.equal(parsedLegacy.settings, null);
});
