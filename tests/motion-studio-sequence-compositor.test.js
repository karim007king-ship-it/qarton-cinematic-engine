import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSequenceCompositor } from "../packages/motion-studio/index.js";

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.fillStyle = "#000";
    this.calls = [];
    this.stack = [];
  }
  save() { this.stack.push([this.globalAlpha, this.globalCompositeOperation, this.fillStyle]); }
  restore() {
    const state = this.stack.pop();
    if (state) [this.globalAlpha, this.globalCompositeOperation, this.fillStyle] = state;
  }
  setTransform() {}
  clearRect(...args) { this.calls.push(["clearRect", ...args]); }
  fillRect(...args) { this.calls.push(["fillRect", this.fillStyle, this.globalAlpha, this.globalCompositeOperation, ...args]); }
  drawImage(...args) { this.calls.push(["drawImage", this.globalAlpha, this.globalCompositeOperation, ...args]); }
}

class FakeCanvas {
  constructor(width, height) { this.width = width; this.height = height; this.context = new FakeContext(this); }
  getContext() { return this.context; }
}

function sample(type, progress, outgoingOpacity = 1 - progress, incomingOpacity = progress) {
  return { kind: "transition", progress, transition: { type },
    outgoing: { scene: { id: "out" }, sceneTimeMs: 400, opacity: outgoingOpacity },
    incoming: { scene: { id: "in" }, sceneTimeMs: 200, opacity: incomingOpacity } };
}

test("shared compositor handles scene samples and keeps each scene's local time for full-scene drawing", () => {
  const target = new FakeCanvas(64, 64);
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => new FakeCanvas(w, h) });
  const observed = [];
  compositor.draw(target.context, { kind: "scene", scene: { id: "solo" }, sceneTimeMs: 912 }, (_ctx, scene, time) => {
    observed.push([scene.id, time]);
  });
  compositor.draw(target.context, sample("dissolve", 0.25), (_ctx, scene, time) => observed.push([scene.id, time]));
  assert.deepEqual(observed, [["solo", 912], ["out", 400], ["in", 200]]);
});

test("Dissolve uses one premultiplied additive overlay and reuses one scratch surface", () => {
  const target = new FakeCanvas(64, 64);
  let created = 0;
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => { created++; return new FakeCanvas(w, h); } });
  const callbacks = [];
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    compositor.draw(target.context, sample("dissolve", progress), (_ctx, scene) => callbacks.push(scene.id));
  }
  assert.equal(created, 1);
  assert.deepEqual(compositor.getDiagnostics(), { surfaceCreations: 1, liveSurfaces: 1,
    scratchWidth: 64, scratchHeight: 64, scratchBytes: 64 * 64 * 4 });
  assert.deepEqual(callbacks, ["out", "in", "out", "in", "out", "in", "out", "in", "out", "in"]);
  assert.ok(target.context.calls.some(call => call[0] === "drawImage" && call[2] === "lighter"));
  assert.ok(target.context.calls.some(call => call[0] === "fillRect" && call[3] === "destination-in"));
  const resized = new FakeCanvas(128, 32);
  compositor.draw(resized.context, sample("dissolve", 0.5), () => {});
  assert.equal(created, 1, "dimension changes resize the same Canvas object");
  assert.equal(compositor.getDiagnostics().scratchBytes, 128 * 32 * 4);
  compositor.release();
  assert.deepEqual(compositor.getDiagnostics(), { surfaceCreations: 1, liveSurfaces: 0,
    scratchWidth: 0, scratchHeight: 0, scratchBytes: 0 });
});

test("Fade uses black as its explicit backing and only draws the visible side", () => {
  const target = new FakeCanvas(8, 8);
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => new FakeCanvas(w, h) });
  const observed = [];
  compositor.draw(target.context, sample("fade", 0.25, 0.5, 0), (_ctx, scene) => observed.push(scene.id));
  assert.deepEqual(observed, ["out"]);
  assert.ok(target.context.calls.some(call => call[0] === "fillRect" && call[1] === "#000"));
  assert.equal(compositor.getDiagnostics().liveSurfaces, 1);
  compositor.draw(target.context, sample("fade", 0.5, 0, 0), (_ctx, scene) => observed.push(scene.id));
  assert.deepEqual(observed, ["out"], "the black midpoint requires no scene render");
});

test("compositor restores Canvas state and reports unsupported asynchronous scene painters", () => {
  const target = new FakeCanvas(10, 10);
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => new FakeCanvas(w, h) });
  target.context.globalAlpha = 0.37;
  target.context.globalCompositeOperation = "multiply";
  assert.throws(() => compositor.draw(target.context, { kind: "scene", scene: {}, sceneTimeMs: 0 }, () => Promise.resolve()), /synchronous/iu);
  assert.equal(target.context.globalAlpha, 0.37);
  assert.equal(target.context.globalCompositeOperation, "multiply");
  assert.throws(() => compositor.draw(target.context, { kind: "transition", transition: { type: "wipe" },
    progress: 0.5, outgoing: { scene: {}, sceneTimeMs: 0 }, incoming: { scene: {}, sceneTimeMs: 0 } }, () => {}), /valid StudioSequenceV2/iu);
});
