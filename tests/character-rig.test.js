import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterRig, composeRigTransforms } from "../src/character/rig-hierarchy.js";

test("character rig validates unique ids and parent references", () => {
  assert.throws(() => createCharacterRig([{ id: "head" }, { id: "head" }]), /unique/);
  assert.throws(() => createCharacterRig([{ id: "eyes", parent: "head" }]), /missing parent/);
  assert.throws(() => createCharacterRig([{ id: "head", parent: "head" }]), /parent itself/);
});

test("character rig rejects parent cycles, including indirect cycles", () => {
  assert.throws(() => createCharacterRig([
    { id: "torso", parent: "head" },
    { id: "head", parent: "torso" }
  ]), /cycle/);
  assert.throws(() => createCharacterRig([
    { id: "a", parent: "b" },
    { id: "b", parent: "c" },
    { id: "c", parent: "a" }
  ]), /cycle/);
});

test("character rig validates finite transforms and non-negative scales", () => {
  assert.throws(() => createCharacterRig([{ id: "root", transform: { rotation: Infinity } }]), /invalid rotation/);
  assert.throws(() => createCharacterRig([{ id: "root", transform: { scaleX: -1 } }]), /invalid scaleX/);
});

test("child transforms inherit parent translation, rotation, and scale", () => {
  const rig = createCharacterRig([
    { id: "torso", transform: { translateX: 10, translateY: 20, rotation: 90, scaleX: 2, scaleY: 2 } },
    { id: "head", parent: "torso", transform: { translateX: 0, translateY: -5 } },
    { id: "eyes", parent: "head", transform: { translateX: 2, translateY: 0 } }
  ]);
  const world = composeRigTransforms(rig);
  assert.ok(Math.abs(world.head.translateX - 20) < 1e-9);
  assert.ok(Math.abs(world.head.translateY - 20) < 1e-9);
  assert.ok(Math.abs(world.eyes.translateX - 20) < 1e-9);
  assert.ok(Math.abs(world.eyes.translateY - 24) < 1e-9);
  assert.equal(world.eyes.scaleX, 2);
  assert.equal(world.eyes.matrix.length, 6);
});

test("animated local transforms compose deterministically without mutating the rig", () => {
  const rig = createCharacterRig([
    { id: "body", transform: { translateX: 4 } },
    { id: "arm", parent: "body", transform: { translateY: 2 } }
  ]);
  const animated = { body: { translateX: 6 }, arm: { rotation: 30, scaleX: 1.5 } };
  const first = composeRigTransforms(rig, animated);
  const second = composeRigTransforms(rig, animated);
  assert.deepEqual(first, second);
  assert.equal(first.body.translateX, 10);
  assert.equal(first.arm.translateX, 10);
  assert.equal(first.arm.translateY, 2);
  assert.equal(first.arm.scaleX, 1.5);
  assert.equal(rig.layers[0].transform.translateX, 4);
});

test("animated rig transforms reject malformed values", () => {
  const rig = createCharacterRig([{ id: "body" }]);
  assert.throws(() => composeRigTransforms(rig, { body: { rotation: NaN } }), /invalid rotation/);
  assert.throws(() => composeRigTransforms(rig, null), /object/);
});

test("world matrices preserve nested non-uniform scale and rotation without lossy decomposition", () => {
  const rig = createCharacterRig([
    { id: "root", transform: { scaleX: 2, scaleY: 1 } },
    { id: "child", parent: "root", transform: { rotation: 45 } }
  ]);
  const world = composeRigTransforms(rig);
  assert.equal(world.child.matrix.length, 6);
  assert.ok(Math.abs(world.child.matrix[1] - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(world.child.matrix[2] + 2 * Math.SQRT1_2) < 1e-9);
});

test("animated transforms cannot target unknown rig layers", () => {
  const rig = createCharacterRig([{ id: "body" }]);
  assert.throws(() => composeRigTransforms(rig, { typo: { rotation: 10 } }), /unknown layer/);
});

test("explicit null parent is accepted as a root layer", () => {
  const rig = createCharacterRig([
    { id: "body", parent: null },
    { id: "head", parent: "body" }
  ]);
  assert.deepEqual(rig.roots, ["body"]);
  assert.equal(rig.layers[0].parent, null);
  assert.equal(composeRigTransforms(rig).head.translateX, 0);
});
