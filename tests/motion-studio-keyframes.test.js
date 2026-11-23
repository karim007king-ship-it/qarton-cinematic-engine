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
import { makeProject, makeProjectFile, parseProjectFile, prepareProjectUpdate, setCameraEndpoints, VIEWPORT } from "../examples/motion-studio-lab/studio-model.js";
import { exportViewportFor, projectForRaster } from "../examples/motion-studio-lab/studio-export-core.js";

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
  assert.throws(() => addCameraKeyframe(project, { atMs: 1500, value: project.camera[0].value, ignored: true }), /only atMs and value/);
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

test("boundary keys can move and delete without replacing neighbors or changing endpoint rules", () => {
  const original = fixture();
  const movedFirst = moveCameraKeyframe(original, 0, 100);
  assert.deepEqual(movedFirst.camera.map(({ atMs }) => atMs), [100, 6000]);
  assert.deepEqual(sampleFrame(compileProject(movedFirst, { get: () => ({}) }), 0).camera,
    { x: 0, y: 0, zoom: 1, rotation: 0 });

  const deletedFirst = deleteCameraKeyframe(movedFirst, 100);
  assert.deepEqual(deletedFirst.camera.map(({ atMs }) => atMs), [6000]);
  const oneKey = moveCameraKeyframe(deletedFirst, 6000, 5500);
  assert.deepEqual(oneKey.camera.map(({ atMs }) => atMs), [5500]);
  const noCamera = deleteCameraKeyframe(oneKey, 5500);
  assert.equal(Object.hasOwn(noCamera, "camera"), false);

  const movedLast = moveCameraKeyframe(original, 6000, 5500);
  assert.deepEqual(sampleFrame(compileProject(movedLast, { get: () => ({}) }), 6000).camera,
    movedLast.camera[1].value, "the moved final key holds to project end");
  const deletedLast = deleteCameraKeyframe(original, 6000);
  assert.deepEqual(deletedLast.camera.map(({ atMs }) => atMs), [0]);
  assert.deepEqual(sampleFrame(compileProject(deletedLast, { get: () => ({}) }), 6000).camera,
    deletedLast.camera[0].value, "the preceding key holds after deleting the final key");
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
  const identity = { x: 0, y: 0, zoom: 1, rotation: 0 };
  assert.deepEqual(sampleFrame(compiled, 0).camera, identity);
  assert.deepEqual(sampleFrame(compiled, 999).camera, identity, "just before the first key holds identity");
  assert.deepEqual(sampleFrame(compiled, 1000).camera, project.camera[0].value, "the first pose is exact at its timestamp");
  assert.deepEqual(sampleFrame(compiled, 5000).camera, project.camera[1].value, "the last pose is exact at its timestamp");
  assert.deepEqual(sampleFrame(compiled, 6000).camera, project.camera[1].value, "the last key holds through project end");
  assert.deepEqual(sampleFrame(compiled, 8000).camera, project.camera[1].value, "sampling beyond project end clamps to the held pose");
  const firstSamples = [250, 1200, 3200, 5800].map((time) => sampleFrame(compiled, time).camera);
  const secondSamples = [250, 1200, 3200, 5800].map((time) => sampleFrame(compiled, time).camera);
  assert.deepEqual(secondSamples, firstSamples);
});

test("shortening duration retimes only the final key; a middle-key collision fails without data loss", () => {
  const project = { ...makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.5, startX: 0, endX: 60, startY: 0, endY: 30 }), camera: [
    { atMs: 0, value: { x: 0, y: 0, zoom: 1, rotation: 0 } },
    { atMs: 3000, value: { x: 17, y: 6, zoom: 1.1, rotation: 2 } },
    { atMs: 9000, value: { x: 60, y: 30, zoom: 1.5, rotation: 0 } }
  ] };
  const shortened = setCameraEndpoints(project, {
    durationMs: 6000,
    start: project.camera[0].value,
    end: project.camera[2].value
  });
  assert.deepEqual(shortened.camera.map(({ atMs }) => atMs), [0, 3000, 6000]);
  assert.deepEqual(shortened.camera[1].value, project.camera[1].value);
  assert.deepEqual(shortened.camera[2].value, project.camera[2].value);

  const collision = structuredClone(project);
  collision.camera.splice(2, 0, { atMs: 6000, value: { x: 44, y: 20, zoom: 1.3, rotation: -5 } });
  const before = JSON.stringify(collision);
  assert.throws(() => setCameraEndpoints(collision, {
    durationMs: 6000,
    start: collision.camera[0].value,
    end: collision.camera.at(-1).value
  }), /Keyframe وسيطًا سيصل إلى نقطة النهاية/);
  assert.equal(JSON.stringify(collision), before, "the source project and colliding middle key remain untouched");
});

test("multi-key JSON survives the slider update and L5 raster export preparation", () => {
  const source = { ...fixture(), camera: [
    { atMs: 0, value: { x: 0, y: 0, zoom: 1, rotation: 0 } },
    { atMs: 2000, value: { x: 16, y: 8, zoom: 1.2, rotation: 8 } },
    { atMs: 4500, value: { x: 38, y: 14, zoom: 1.35, rotation: 20 } },
    { atMs: 6000, value: { x: 60, y: 30, zoom: 1.5, rotation: 0 } }
  ] };
  const imported = parseProjectFile(JSON.stringify(makeProjectFile(source, null, { aspectPreset: "original", fitMode: "fill" })));
  const update = prepareProjectUpdate(imported.project, {
    durationMs: imported.project.durationMs,
    viewport: imported.project.viewport,
    start: { x: -3, y: 2, zoom: 0.95 },
    end: { x: 64, y: 24, zoom: 1.6 },
    prepare: (candidate) => compileProject(projectForRaster(candidate, candidate.viewport), { get: () => ({}) })
  });
  assert.deepEqual(update.project.camera.map(({ atMs }) => atMs), [0, 2000, 4500, 6000]);
  assert.deepEqual(update.project.camera.slice(1, -1), imported.project.camera.slice(1, -1));
  assert.deepEqual(sampleFrame(update.prepared, 2000).camera, imported.project.camera[1].value);

  const saved = parseProjectFile(JSON.stringify(makeProjectFile(update.project, imported.image, imported.settings)));
  const exportProject = projectForRaster(saved.project, exportViewportFor(saved.project.viewport, "standard"));
  const exportCompiled = compileProject(exportProject, { get: () => ({}) });
  assert.deepEqual(exportCompiled.camera.keyframes.map(({ atMs }) => atMs), [0, 2000, 4500, 6000]);
  assert.deepEqual(sampleFrame(exportCompiled, 4500).camera, saved.project.camera[2].value);
});

test("project update preparation is failure-atomic when compilation rejects the candidate", () => {
  const original = fixture();
  const active = { project: original, compiled: { marker: "currently-active" } };
  const originalJson = JSON.stringify(original);
  assert.throws(() => {
    const { project, prepared } = prepareProjectUpdate(original, {
      durationMs: 6000,
      viewport: VIEWPORT,
      start: { x: 0, y: 0, zoom: 1 },
      end: { x: 80, y: 40, zoom: 1.8 },
      prepare: () => { throw new Error("synthetic compile failure"); }
    });
    active.project = project;
    active.compiled = prepared;
  }, /synthetic compile failure/);
  assert.equal(active.project, original);
  assert.equal(active.compiled.marker, "currently-active");
  assert.equal(JSON.stringify(original), originalJson);
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
