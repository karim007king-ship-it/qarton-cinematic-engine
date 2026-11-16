import test from "node:test";
import assert from "node:assert/strict";
import { buildLayerPlan, createSceneDefinition, resolveQualityProfile } from "../src/index.js";

const scene = createSceneDefinition({ id: "test-scene", layers: [
  { id: "sky", role: "background", asset: "sky", depth: 0 },
  { id: "mountains", role: "background", asset: "mountains", depth: 1 },
  { id: "mist", role: "midground", asset: "mist", depth: 2 },
  { id: "hero", role: "character", asset: "hero", depth: 3 },
  { id: "dust", role: "foreground", asset: "dust", depth: 4 },
  { id: "ui", role: "overlay", asset: "ui", depth: 5 }
] });

test("low quality caps background layers but preserves characters and overlays", () => {
  const plan = buildLayerPlan(scene, resolveQualityProfile({ quality: "low" }));
  assert.deepEqual(plan.map(layer => layer.id), ["sky", "mountains", "hero", "dust", "ui"]);
});

test("high quality retains all layers in deterministic depth order", () => {
  const plan = buildLayerPlan(scene, resolveQualityProfile({ quality: "high" }));
  assert.deepEqual(plan.map(layer => layer.id), ["sky", "mountains", "mist", "hero", "dust", "ui"]);
});

test("layer planner rejects invalid budgets", () => {
  assert.throws(() => buildLayerPlan(scene, { maxBackgroundLayers: -1 }), /non-negative integer/);
});


test("layer planner rejects malformed layer entries", () => {
  assert.throws(() => buildLayerPlan({ layers: [null] }, { maxBackgroundLayers: 2 }), /must be an object/);
  assert.throws(() => buildLayerPlan({ layers: [[]] }, { maxBackgroundLayers: 2 }), /must be an object/);
});

test("layer planner rejects unsupported roles instead of silently misordering them", () => {
  assert.throws(() => buildLayerPlan({
    layers: [{ id: "unknown", role: "parallax", asset: "x", depth: 0 }]
  }, { maxBackgroundLayers: 2 }), /unsupported role/);
});

test("layer planner rejects non-finite depths instead of producing unstable ordering", () => {
  for (const depth of [NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => buildLayerPlan({
      layers: [{ id: "invalid-depth", role: "background", asset: "x", depth }]
    }, { maxBackgroundLayers: 2 }), /finite depth/);
  }
});

test("layer planner returns immutable empty plans for empty scenes", () => {
  const plan = buildLayerPlan({ layers: [] }, { maxBackgroundLayers: 0 });
  assert.deepEqual(plan, []);
  assert.equal(Object.isFrozen(plan), true);
});
