import test from "node:test";
import assert from "node:assert/strict";
import { countCharacterPixels, drawLayeredCharacter, MAX_IMPORTED_CHARACTER_PIXELS, normalizeCharacterLayer, parseCharacterLayerFilename, selectCharacterLayers } from "../src/character/sprite-character.js";

test("PNG and WebP names resolve a stable character ID, part and variant", () => {
  assert.deepEqual(parseCharacterLayerFilename("layla__mouth__round.webp", "layla"), { characterId: "layla", role: "mouth", variant: "round" });
  assert.deepEqual(parseCharacterLayerFilename("layla__brows__angry.png", "layla"), { characterId: "layla", role: "brows", variant: "angry" });
  assert.deepEqual(parseCharacterLayerFilename("portrait.png", "layla"), { characterId: "layla", role: "full", variant: "neutral" });
  assert.throws(() => parseCharacterLayerFilename("layla__mouth__glowing.png", "layla"), /Unsupported sprite variant/u);
  assert.throws(() => parseCharacterLayerFilename("portrait.jpg", "layla"), /Use PNG or WebP/u);
});

test("normalized layer layout validates sizes, anchors, pivots and z order", () => {
  const texture = { width: 100, height: 100 };
  const layer = normalizeCharacterLayer({ role: "head", image: texture, layout: { x: .5, y: .25, width: .4, height: .3, pivotX: .5, pivotY: .9, z: 4 } });
  assert.equal(layer.z, 4);
  assert.equal(layer.pivotY, .9);
  assert.throws(() => normalizeCharacterLayer({ role: "head", image: texture, layout: { x: 1.5 } }), RangeError);
});

test("character texture memory accounting deduplicates shared bitmaps and enforces a mobile budget", () => {
  const texture = { width: 2000, height: 2000 };
  assert.equal(countCharacterPixels({ portrait: texture, layers: [{ image: texture }] }), 4_000_000);
  assert.equal(MAX_IMPORTED_CHARACTER_PIXELS, 12_000_000);
  assert.ok(countCharacterPixels({ portrait: texture, layers: [{ image: { width: 2000, height: 3000 } }] }) <= MAX_IMPORTED_CHARACTER_PIXELS);
});

test("expression and mouth layer variants replace neutral layers deterministically", () => {
  const make = (role, variant, z) => ({ role, variant, z, image: { id: `${role}-${variant}` } });
  const selected = selectCharacterLayers([
    make("body", "neutral", 0), make("head", "neutral", 1), make("mouth", "neutral", 2),
    make("mouth", "round", 3), make("brows", "neutral", 4), make("brows", "angry", 5)
  ], { expression: "angry", viseme: "round" });
  assert.deepEqual(selected.map(item => `${item.role}:${item.variant}`), ["body:neutral", "head:neutral", "mouth:round", "brows:angry"]);
});

test("layer renderer sorts z-order and applies the authored pivot and movement", () => {
  const events = [];
  const ctx = {
    save() { events.push(["save"]); }, restore() { events.push(["restore"]); },
    translate(...args) { events.push(["translate", ...args]); }, rotate(value) { events.push(["rotate", value]); },
    drawImage(image, ...args) { events.push(["draw", image.id, ...args]); }
  };
  const layers = [
    { role: "head", image: { id: "head" }, layout: { z: 4, x: .5, y: .25, width: .4, height: .3, pivotX: .5, pivotY: .9 } },
    { role: "body", image: { id: "body" }, layout: { z: 0, x: .5, y: .65, width: .8, height: .7, pivotX: .5, pivotY: .1 } }
  ];
  const result = drawLayeredCharacter(ctx, layers, { x: 200, top: 100, width: 100, height: 300, headRotation: .2, armMotion: .15 });
  assert.deepEqual(result.drawnLayers, ["body", "head"]);
  assert.deepEqual(events.filter(item => item[0] === "draw").map(item => item[1]), ["body", "head"]);
  assert.ok(events.some(item => item[0] === "rotate" && item[1] === .2));
});
