import test from "node:test";
import assert from "node:assert/strict";
import { resolveQualityProfile, clamp, lerp, easeInOutCubic, scaleDuration, createSceneDefinition } from "../src/index.js";

test("adaptive profile respects reduced motion and save-data, even with a high manual request", () => {
  assert.equal(resolveQualityProfile({ reducedMotion: true }).tier, "low");
  assert.equal(resolveQualityProfile({ saveData: true }).tier, "low");
  assert.equal(resolveQualityProfile({ quality: "high", reducedMotion: true }).tier, "low");
  assert.equal(resolveQualityProfile({ quality: "high", reducedMotion: true }).reason, "reduced-motion");
  assert.equal(resolveQualityProfile({ quality: "high", saveData: true }).tier, "low");
  assert.equal(resolveQualityProfile({ quality: "high", saveData: true }).reason, "save-data");
});
test("adaptive profile selects manual and capability tiers", () => {
  assert.equal(resolveQualityProfile({ quality: "medium" }).reason, "manual");
  assert.equal(resolveQualityProfile({ hardwareConcurrency: 8, deviceMemory: 8, averageFps: 60 }).tier, "high");
  assert.equal(resolveQualityProfile({ hardwareConcurrency: 2 }).tier, "low");
});
test("motion helpers clamp progress and preserve endpoints", () => {
  assert.equal(clamp(2), 1);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(scaleDuration(1000, { animationScale: 0.5 }), 500);
});
test("scene definitions validate and freeze background layers", () => {
  const scene = createSceneDefinition({ id: "wall-collapse", durationMs: 5000, layers: [
    { id: "sky", role: "background", asset: "bg.sky", depth: 0 },
    { id: "dust", role: "foreground", asset: "fx.dust", opacity: 1.4 }
  ] });
  assert.equal(scene.layers.length, 2);
  assert.equal(scene.layers[1].opacity, 1);
  assert.ok(Object.isFrozen(scene.layers));
});
test("scene definitions normalize scene, layer, and asset identifiers", () => {
  const scene = createSceneDefinition({
    id: "  intro  ",
    layers: [
      { id: " sky ", role: "background", asset: " images/sky " },
      { id: " hero ", role: "character", asset: " images/hero " }
    ]
  });

  assert.equal(scene.id, "intro");
  assert.deepEqual(scene.layers.map(layer => [layer.id, layer.asset]), [
    ["sky", "images/sky"],
    ["hero", "images/hero"]
  ]);
  assert.throws(() => createSceneDefinition({
    id: "duplicate",
    layers: [
      { id: "sky", role: "background", asset: "a" },
      { id: " sky ", role: "foreground", asset: "b" }
    ]
  }), /unique id/);
});
test("scene definitions reject duplicate ids and invalid roles", () => {
  assert.throws(() => createSceneDefinition({ id: "broken", layers: [
    { id: "x", role: "background", asset: "a" }, { id: "x", role: "foreground", asset: "b" }
  ] }), /unique id/);
  assert.throws(() => createSceneDefinition({ id: "broken", layers: [
    { id: "x", role: "unknown", asset: "a" }
  ] }), /unsupported role/);
});
