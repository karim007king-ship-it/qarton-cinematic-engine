import test from "node:test";
import assert from "node:assert/strict";
import {
  createCameraTrack,
  sampleCameraTrack,
  composeCameraPose,
  toCameraCSS
} from "../src/camera/camera-track.js";

test("camera track sorts keyframes and samples endpoints deterministically", () => {
  const track = createCameraTrack([
    { atMs: 1000, x: 100, y: 20, zoom: 2 },
    { atMs: 0, x: 0, y: 0, zoom: 1 }
  ]);
  assert.equal(track.durationMs, 1000);
  assert.deepEqual(sampleCameraTrack(track, 0), { atMs: 0, x: 0, y: 0, zoom: 1, rotation: 0 });
  assert.deepEqual(sampleCameraTrack(track, 1500), { atMs: 1000, x: 100, y: 20, zoom: 2, rotation: 0 });
  assert.deepEqual(sampleCameraTrack(track, 500), { x: 50, y: 10, zoom: 1.5, rotation: 0 });
});

test("camera track validates timestamps, zoom and sample time", () => {
  assert.throws(() => createCameraTrack([]), /at least one/);
  assert.throws(() => createCameraTrack([{ atMs: -1 }]), /non-negative/);
  assert.throws(() => createCameraTrack([{ atMs: 0 }, { atMs: 0 }]), /unique/);
  assert.throws(() => createCameraTrack([{ atMs: 0, zoom: 0 }]), /positive/);
  const track = createCameraTrack([{ atMs: 0 }]);
  assert.throws(() => sampleCameraTrack(track, Infinity), /finite/);
});

test("camera pose composition adds shake without changing zoom", () => {
  const pose = Object.freeze({ x: 10, y: 5, zoom: 1.5, rotation: 2 });
  const result = composeCameraPose(pose, { x: -2, y: 3, rotation: 0.5 });
  assert.deepEqual(result, { x: 8, y: 8, zoom: 1.5, rotation: 2.5 });
  assert.deepEqual(pose, { x: 10, y: 5, zoom: 1.5, rotation: 2 });
  assert.equal(toCameraCSS(result), "translate(8px, 8px) rotate(2.5deg) scale(1.5)");
  assert.throws(() => composeCameraPose(pose, { x: NaN }), /finite/);
});
