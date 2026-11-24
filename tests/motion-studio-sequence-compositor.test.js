import assert from "node:assert/strict";
import test from "node:test";
import { compileProject, createStudioSequenceCompositor, createStudioSequenceV2, compileStudioSequenceV2,
  sampleFrame, sampleStudioSequenceV2 } from "../packages/motion-studio/index.js";
import { createCharacterAnimation } from "../src/character/animation-core.js";
import { compileCinematicEffects, sampleCinematicEffects } from "../src/effects/cinematic-effects.js";

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.fillStyle = "#000";
    this.filter = "none";
    this.shadowColor = "rgba(0, 0, 0, 0)";
    this.shadowBlur = 0;
    this.shadowOffsetX = 0;
    this.shadowOffsetY = 0;
    this.calls = [];
    this.stack = [];
  }
  save() { this.stack.push([this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.filter,
    this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY]); }
  restore() {
    const state = this.stack.pop();
    if (state) [this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.filter,
      this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY] = state;
  }
  setTransform() {}
  clearRect(...args) { this.calls.push(["clearRect", ...args]); }
  fillRect(...args) { this.calls.push(["fillRect", this.fillStyle, this.globalAlpha, this.globalCompositeOperation, ...args,
    this.filter, this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY]); }
  drawImage(...args) { this.calls.push(["drawImage", this.globalAlpha, this.globalCompositeOperation, ...args,
    this.filter, this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY]); }
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

test("compositor isolates filters, shadows, alpha, and compositing state for each scene", () => {
  const target = new FakeCanvas(10, 10);
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => new FakeCanvas(w, h) });
  Object.assign(target.context, { filter: "blur(3px)", shadowColor: "gold", shadowBlur: 9,
    shadowOffsetX: 5, shadowOffsetY: 4, globalAlpha: 0.37, globalCompositeOperation: "multiply" });
  const sceneState = [];
  compositor.draw(target.context, sample("dissolve", 0.5), context => {
    sceneState.push([context.filter, context.shadowColor, context.shadowBlur, context.shadowOffsetX,
      context.shadowOffsetY, context.globalAlpha, context.globalCompositeOperation]);
    Object.assign(context, { filter: "blur(20px)", shadowColor: "red", shadowBlur: 20,
      shadowOffsetX: 20, shadowOffsetY: 20, globalAlpha: 0.1, globalCompositeOperation: "copy" });
  });
  assert.deepEqual(sceneState, Array(2).fill(["none", "rgba(0, 0, 0, 0)", 0, 0, 0, 1, "source-over"]));
  const imageDraws = target.context.calls.filter(call => call[0] === "drawImage");
  assert.equal(imageDraws.at(-1)[2], "lighter");
  assert.equal(imageDraws.at(-1)[8], "none");
  assert.equal(imageDraws.at(-1)[9], "rgba(0, 0, 0, 0)");
  assert.equal(imageDraws.at(-1)[10], 0);
  assert.deepEqual([target.context.filter, target.context.shadowColor, target.context.shadowBlur,
    target.context.shadowOffsetX, target.context.shadowOffsetY, target.context.globalAlpha,
    target.context.globalCompositeOperation], ["blur(3px)", "gold", 9, 5, 4, 0.37, "multiply"]);
});

test("render errors and AbortSignal cancellation release the reusable surface", () => {
  const target = new FakeCanvas(10, 10);
  let allocations = 0;
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => { allocations++; return new FakeCanvas(w, h); } });
  assert.throws(() => compositor.draw(target.context, sample("dissolve", 0.5), (_context, scene) => {
    if (scene.id === "in") throw new Error("scene painter failed");
  }), /scene painter failed/iu);
  assert.equal(allocations, 1);
  assert.equal(compositor.getDiagnostics().liveSurfaces, 0);
  assert.equal(compositor.getDiagnostics().scratchBytes, 0);

  compositor.draw(target.context, sample("dissolve", 0.5), () => {});
  assert.equal(compositor.getDiagnostics().liveSurfaces, 1);
  const controller = new AbortController();
  assert.throws(() => compositor.draw(target.context, sample("dissolve", 0.5), (_context, scene) => {
    if (scene.id === "in") controller.abort();
  }, { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(compositor.getDiagnostics().liveSurfaces, 0, "cancellation inside a scene painter frees its surface");

  compositor.draw(target.context, sample("dissolve", 0.5), () => {});
  assert.equal(compositor.getDiagnostics().liveSurfaces, 1);
  const preAborted = new AbortController();
  preAborted.abort();
  assert.throws(() => compositor.draw(target.context, sample("dissolve", 0.5), () => {}, { signal: preAborted.signal }),
    error => error.name === "AbortError");
  assert.equal(compositor.getDiagnostics().liveSurfaces, 0);
  assert.equal(compositor.getDiagnostics().scratchBytes, 0);
  compositor.release();
  assert.equal(compositor.getDiagnostics().liveSurfaces, 0, "release remains idempotent");
});

test("compositor samples real per-scene camera, character, and effect tracks", () => {
  const viewport = { width: 2, height: 2, fps: 30 };
  const image = { id: "poster", kind: "image", name: "poster.png", mimeType: "image/png", size: 4 };
  const makeRealScene = (id, x) => ({ id, project: { version: 1, durationMs: 1000, viewport,
    camera: [{ atMs: 0, value: { x, y: 0, zoom: 1, rotation: 0 } },
      { atMs: 1000, value: { x: x + 10, y: 4, zoom: 2, rotation: 5 } }],
    layers: [{ id: `layer-${id}`, assetId: image.id, z: 0 }] }, audioTracks: [],
    characterTracks: [{ character: { id: `hero-${id}`, initial: { mouthOpen: 0 } },
      keyframes: [{ atMs: 0, values: { mouthOpen: 0 } }, { atMs: 1000, values: { mouthOpen: 1 } }] }],
    visualEffectsTrack: { version: 1, seed: 7, clips: [{ id: `tint-${id}`, type: "tint", atMs: 0, durationMs: 1000,
      from: { strength: 0, color: "#000000" }, to: { strength: 1, color: "#ffffff" }, easing: "linear" }] } });
  const sequence = createStudioSequenceV2({ viewport, scenes: [makeRealScene("a", 0), makeRealScene("b", 20)],
    assets: [image], transitions: [{ fromSceneId: "a", toSceneId: "b", type: "dissolve", durationMs: 200, audioCrossfadeMs: 0 }] });
  const compiled = compileStudioSequenceV2(sequence);
  const target = new FakeCanvas(2, 2);
  const compositor = createStudioSequenceCompositor({ createSurface: (w, h) => new FakeCanvas(w, h) });
  const seen = [];
  compositor.draw(target.context, sampleStudioSequenceV2(compiled, 900), (_context, scene, localTimeMs) => {
    const project = compileProject(scene.project, { get: () => ({ width: 2, height: 2 }) });
    const frame = sampleFrame(project, localTimeMs);
    const characterTrack = scene.characterTracks[0];
    const character = createCharacterAnimation({ character: characterTrack.character,
      durationMs: scene.project.durationMs, keyframes: characterTrack.keyframes }).sample(localTimeMs);
    const effects = compileCinematicEffects({ version: "CinematicEffectsV1", width: 2, height: 2,
      durationMs: scene.project.durationMs, seed: scene.visualEffectsTrack.seed, layers: [],
      clips: scene.visualEffectsTrack.clips });
    const effect = sampleCinematicEffects(effects, localTimeMs);
    seen.push({ id: scene.id, localTimeMs, cameraX: frame.camera.x, mouthOpen: character.mouthOpen,
      tint: effect.tint.strength });
  });
  assert.deepEqual(seen, [
    { id: "a", localTimeMs: 900, cameraX: 9.96, mouthOpen: 0.996, tint: 0.9 },
    { id: "b", localTimeMs: 100, cameraX: 20.04, mouthOpen: 0.004000000000000001, tint: 0.1 }
  ]);
  compositor.release();
});
