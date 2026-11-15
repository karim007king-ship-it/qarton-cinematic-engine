import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisualTreatment } from "../src/effects/visual-treatment.js";

test("visual treatment returns stable CSS filter values and bounded overlays", () => {
  const result = resolveVisualTreatment({
    exposure: 0.5, contrast: 1.2, saturation: 1.1,
    warmth: 0.6, vignette: 0.8, bloom: 0.5, grain: 0.4
  });
  assert.equal(result.filter, "brightness(1.175) contrast(1.200) saturate(1.100) sepia(0.132)");
  assert.equal(result.warmthTint, "warm");
  assert.equal(result.vignetteOpacity, 0.8);
  assert.equal(result.grainAnimated, true);
  assert.ok(Object.isFrozen(result));
});

test("visual treatment scales expensive overlays for adaptive quality tiers", () => {
  const low = resolveVisualTreatment({
    vignette: 1, bloom: 1, grain: 1, profile: { tier: "low" }
  });
  const medium = resolveVisualTreatment({
    vignette: 1, bloom: 1, grain: 1, profile: { tier: "medium" }
  });
  assert.equal(low.vignetteOpacity, 0.25);
  assert.equal(medium.bloomOpacity, 0.65);
  assert.equal(low.grainAnimated, false);
  assert.equal(resolveVisualTreatment({ grain: 1, reducedMotion: true }).grainAnimated, false);
});

test("visual treatment clamps out-of-range values and rejects non-finite input", () => {
  const result = resolveVisualTreatment({
    exposure: 5, contrast: -2, saturation: 8, warmth: -4,
    vignette: 3, bloom: -1, grain: 2
  });
  assert.equal(result.filter, "brightness(1.350) contrast(0.000) saturate(2.000) sepia(0.220)");
  assert.equal(result.warmthTint, "cool");
  assert.equal(result.vignetteOpacity, 1);
  assert.equal(result.bloomOpacity, 0);
  assert.throws(() => resolveVisualTreatment({ bloom: Infinity }), /finite/);
});
