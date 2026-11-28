import test from "node:test";
import assert from "node:assert/strict";
import { CinematicRenderer } from "../src/runtime/cinematic-renderer.js";

const context = canvas => ({ canvas, drawImage() {}, setTransform() {}, clearRect() {} });

test("renderer rejects an oversized Canvas backing store instead of reporting a passive warning", () => {
  const canvas = { width: 100, height: 100 };
  assert.throws(() => new CinematicRenderer(context(canvas), { maxCanvasPixels: 9999 }), /Canvas backing budget exceeded/u);
  assert.doesNotThrow(() => new CinematicRenderer(context(canvas), { maxCanvasPixels: 10_000 }));
});

test("renderer enforces the unique decoded image budget on the actual Runtime frame", () => {
  const canvas = { width: 20, height: 20 };
  const renderer = new CinematicRenderer(context(canvas), { maxCanvasPixels: 400, maxDecodedPixels: 100 });
  const image = { width: 11, height: 10 };
  const frame = { scene: { textScene: {} }, timeMs: 0, assets: new Map([["large", image]]) };
  assert.throws(() => renderer.render(frame), /Decoded image budget exceeded/u);
  renderer.dispose();
});
