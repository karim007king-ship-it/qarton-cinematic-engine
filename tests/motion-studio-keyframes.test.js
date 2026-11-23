import assert from "node:assert/strict";
import test from "node:test";
import {
  addCameraKeyframe,
  compileProject,
  deleteCameraKeyframe,
  moveCameraKeyframe,
  sampleFrame,
  updateCameraKeyframe,
  validateCameraKeyframes
} from "../packages/motion-studio/index.js";
import { makeProject } from "../examples/motion-studio-lab/studio-model.js";

function fixture() {
  return makeProject({ durationMs: 6000, startZoom: 1, endZoom: 1.5, startX: 0, endX: 60, startY: 0, endY: 30 });
}

test("add, update, move, and delete camera keyframes return ordered fresh projects", () => {
  const original = fixture();
  const before = structuredClone(original);
  const added = addCameraKeyframe(original, { atMs: 3000, value: { x: 22, y: 8, zoom: 1.2, rotation: 12 } });
  assert.deepEqual(added.camera.map(({ atMs }) => atMs), [0, 3000, 6000]);
  assert.deepEqual(original, before, "adding does not mutate the source");

  const updated = updateCameraKeyframe(added, 3000, { zoom: 1.4, rotation: -15 });
  assert.deepEqual(updated.camera[1].value, { x: 22, y: 8, zoom: 1.4, rotation: -15 });
  assert.deepEqual(added.camera[1].value, { x: 22, y: 8, zoom: 1.2, rotation: 12 }, "editing leaves prior versions intact");

  const moved = moveCameraKeyframe(updated, 3000, 4500);
  assert.deepEqual(moved.camera.map(({ atMs }) => atMs), [0, 4500, 6000]);
  assert.deepEqual(moved.camera[1].value, updated.camera[1].value);

  const deleted = deleteCameraKeyframe(moved, 4500);
  assert.deepEqual(deleted.camera.map(({ atMs }) => atMs), [0, 6000]);
  assert.deepEqual(moved.camera.map(({ atMs }) => atMs), [0, 4500, 6000]);
});

test("keyframe APIs reject duplicate, missing, out-of-range, and malformed edits", () => {
  const project = fixture();
  assert.throws(() => addCameraKeyframe(project, { atMs: 0, value: project.camera[0].value }), /already exists/);
  assert.throws(() => addCameraKeyframe(project, { atMs: 6001, value: project.camera[0].value }), /integer in/);
  assert.throws(() => addCameraKeyframe(project, { atMs: 1500, value: { ...project.camera[0].value, zoom: 65 } }), /zoom/);
  assert.throws(() => updateCameraKeyframe(project, 0, { zoom: 0 }), /zoom/);
  assert.throws(() => updateCameraKeyframe(project, 250, { alpha: 1 }), /x, y, zoom, or rotation/);
  assert.throws(() => updateCameraKeyframe(project, 250, { x: 1 }), /No keyframe/);
  assert.throws(() => moveCameraKeyframe(project, 0, 6000), /already exists/);
  assert.throws(() => moveCameraKeyframe(project, 0, 6001), /integer in/);
  assert.throws(() => deleteCameraKeyframe(project, 250), /No keyframe/);
  assert.throws(() => validateCameraKeyframes([
    { atMs: 0, value: project.camera[0].value },
    { atMs: 0, value: project.camera[0].value }
  ], 6000), /unique|duplicate/i);
});

test("deleting the final key removes the optional track and samples identity", () => {
  const single = { ...fixture(), camera: [{ atMs: 2500, value: { x: 40, y: -10, zoom: 2, rotation: 90 } }] };
  const withoutTrack = deleteCameraKeyframe(single, 2500);
  assert.equal(Object.hasOwn(withoutTrack, "camera"), false);
  const compiled = compileProject(withoutTrack, { get: () => ({}) });
  assert.deepEqual(sampleFrame(compiled, 0).camera, { x: 0, y: 0, zoom: 1, rotation: 0 });
  assert.deepEqual(sampleFrame(compiled, 6000).camera, { x: 0, y: 0, zoom: 1, rotation: 0 });
});

test("first pose holds before its key, last pose holds through the project end, repeated seeks are deterministic", () => {
  const project = { ...fixture(), camera: [
    { atMs: 1000, value: { x: 12, y: 6, zoom: 1.2, rotation: 15 } },
    { atMs: 5000, value: { x: 24, y: 12, zoom: 1.25, rotation: 45 } }
  ] };
  const compiled = compileProject(project, { get: () => ({}) });
  const early = sampleFrame(compiled, 0).camera;
  assert.deepEqual(sampleFrame(compiled, 500).camera, early, "before first key is the engine identity pose");
  const end = sampleFrame(compiled, 6000).camera;
  assert.deepEqual(sampleFrame(compiled, 8000).camera, end, "sampleFrame clamps to project end and holds its last pose");
  const firstSamples = [250, 1200, 3200, 5800].map((time) => sampleFrame(compiled, time).camera);
  const secondSamples = [250, 1200, 3200, 5800].map((time) => sampleFrame(compiled, time).camera);
  assert.deepEqual(secondSamples, firstSamples);
});

test("timeline sorting and camera interpolation remain owned by engine APIs", () => {
  const project = fixture();
  delete project.camera;
  const three = addCameraKeyframe(project, { atMs: 5000, value: { x: 50, y: 0, zoom: 2, rotation: 0 } });
  const two = addCameraKeyframe(three, { atMs: 1000, value: { x: 10, y: 0, zoom: 1.2, rotation: 0 } });
  assert.deepEqual(two.camera.map(({ atMs }) => atMs), [1000, 5000]);
  const compiled = compileProject(two, { get: () => ({}) });
  assert.deepEqual(sampleFrame(compiled, 1000).camera, two.camera[0].value);
  assert.deepEqual(sampleFrame(compiled, 5000).camera, two.camera[1].value);
});
