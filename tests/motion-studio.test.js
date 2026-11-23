import assert from "node:assert/strict";
import test from "node:test";
import { compileProject, drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";

const key = (atMs, pose = {}) => ({ atMs, value: { x: 0, y: 0, zoom: 1, rotation: 0, ...pose } });
const project = () => ({
  version: 1, durationMs: 1000, viewport: { width: 100, height: 200, fps: 24 },
  layers: [
    { id: "front", assetId: "actor", z: 5, track: [key(200, { x: 10 }), key(800, { x: 42 })] },
    { id: "back", assetId: "wall", z: -5 },
    { id: "overlay", assetId: "actor", z: 5 }
  ],
  camera: [key(0), key(1000, { x: 32, y: 16, zoom: 3, rotation: 90 })]
});
const images = new Map([["actor", {}], ["wall", {}]]);

test("samples cubic pan and zoom identically after forward and backward seeks", () => {
  const input = project();
  const compiled = compileProject(input, images);
  const quarter = sampleFrame(compiled, 250);
  assert.deepEqual(quarter.camera, { x: 2, y: 1, zoom: 1.125, rotation: 5.625 });
  assert.equal(sampleFrame(compiled, 350).layers[1].pose.x, 12);
  assert.equal(sampleFrame(compiled, 199).layers[1].pose.x, 0);
  assert.equal(sampleFrame(compiled, 200).layers[1].pose.x, 10);
  assert.equal(sampleFrame(compiled, 950).layers[1].pose.x, 42);
  assert.deepEqual(sampleFrame(compiled, -10), sampleFrame(compiled, 0));
  assert.deepEqual(sampleFrame(compiled, 5000), sampleFrame(compiled, 1000));
  input.camera[1].value.zoom = 60;
  input.layers.reverse();
  assert.deepEqual(sampleFrame(compiled, 250), quarter);
  assert.deepEqual(quarter.layers.map(layer => layer.id), ["back", "front", "overlay"]);
  assert.throws(() => sampleFrame(compiled, Infinity), TypeError);
});

test("validates the entire schema before resolving images and binds each image once", () => {
  const calls = [];
  const provider = { get(id) { calls.push(id); return images.get(id); } };
  const invalid = project();
  invalid.layers.at(-1).assetId = "../actor";
  assert.throws(() => compileProject(invalid, provider), /opaque ASCII/);
  assert.deepEqual(calls, []);
  const frame = sampleFrame(compileProject(project(), provider), 0);
  assert.deepEqual(calls, ["wall", "actor"]);
  assert.equal(frame.layers[1].image, frame.layers[2].image);
  assert.throws(() => compileProject(project(), new Map()), /Missing decoded image/);
});

test("rejects unsupported versions, sizes, durations, IDs and filesystem or URL references", () => {
  const invalid = [
    p => { p.version = 2; },
    p => { p.viewport.width = 0; },
    p => { p.viewport.height = 200.5; },
    p => { p.viewport.width = p.viewport.height = 4096; },
    p => { p.viewport.fps = 61; },
    p => { p.durationMs = 300001; },
    p => { p.durationMs = NaN; },
    p => { p.layers[0].z = Infinity; },
    p => { p.layers[0].id = p.layers[1].id; },
    p => { p.layers[0].assetId = "images\\actor"; },
    p => { p.layers[0].assetId = "%2e%2e"; },
    p => { p.layers[0].assetId = "https://example.org/image"; },
    p => { p.layers[0].src = "/tmp/actor.png"; },
    p => { p.layers[0].assetId = "actor\n"; }
  ];
  for (const mutate of invalid) {
    const input = project();
    mutate(input);
    assert.throws(() => compileProject(input, images));
  }
});

test("rejects out-of-range, duplicate and unordered keys for camera and layers", () => {
  const invalidTracks = [
    [key(-1)], [key(1001)], [key(1.5)], [key(0), key(0)], [key(2), key(1)],
    [key(0, { zoom: 0 })], [key(0, { x: Infinity })], [], Array(1), null
  ];
  for (const track of invalidTracks) {
    const input = project();
    assert.throws(() => compileProject({ ...input, camera: track }, images));
    input.layers[0].track = track;
    assert.throws(() => compileProject(input, images));
  }
});

function recordingContext() {
  const calls = [];
  const ctx = { canvas: { width: 100, height: 200 } };
  for (const name of ["save", "restore", "setTransform", "clearRect", "translate", "rotate", "scale", "drawImage"]) {
    ctx[name] = (...args) => calls.push([name, ...args]);
  }
  return { ctx, calls };
}

test("draws with camera outside the layer transforms, using scene center as the pivot", () => {
  const frames = compileProject(project(), images);
  const { ctx, calls } = recordingContext();
  const frame = sampleFrame(frames, 1000);
  drawFrame(ctx, frame);
  assert.deepEqual(calls.slice(0, 7), [
    ["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 100, 200],
    ["translate", 82, 116], ["rotate", Math.PI / 2], ["scale", 3, 3], ["translate", -50, -100]
  ]);
  assert.deepEqual(calls.slice(14, 21), [
    ["save"], ["translate", 92, 100], ["rotate", 0], ["scale", 1, 1], ["translate", -50, -100],
    ["drawImage", images.get("actor"), 0, 0, 100, 200], ["restore"]
  ]);
  assert.deepEqual(calls.filter(([name]) => name === "drawImage").map(([, image]) => image),
    [images.get("wall"), images.get("actor"), images.get("actor")]);
  const firstDraw = calls.splice(0);
  drawFrame(ctx, sampleFrame(frames, 500));
  calls.length = 0;
  drawFrame(ctx, sampleFrame(frames, 1000));
  assert.deepEqual(calls, firstDraw);
});

test("preserves saved Canvas state when drawing throws and rejects a mismatched viewport", () => {
  const frame = sampleFrame(compileProject(project(), images), 0);
  const { ctx, calls } = recordingContext();
  ctx.drawImage = () => { throw new Error("broken image"); };
  assert.throws(() => drawFrame(ctx, frame), /broken image/);
  assert.deepEqual(calls.slice(-2), [["restore"], ["restore"]]);
  ctx.canvas.width = 1;
  assert.throws(() => drawFrame(ctx, frame), /dimensions/);
});
