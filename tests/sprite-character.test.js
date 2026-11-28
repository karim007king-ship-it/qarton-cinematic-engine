import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_LAYER_LAYOUTS, countCharacterPixels, drawLayeredCharacter, isCalibratedFaceRig, MAX_IMPORTED_CHARACTER_PIXELS, normalizeCharacterLayer, parseCharacterLayerFilename, selectCharacterLayers } from "../src/character/sprite-character.js";

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

test("default layered rig joins the head to the torso and anchors hands at the wrists", () => {
  const layers = ["body", "head", "hand_left", "hand_right", "hair_back", "hair_front", "eyes", "brows", "mouth"]
    .map(role => ({ role, image: { id: role } }));
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {} };
  const result = drawLayeredCharacter(ctx, layers, { x: 250, top: 80, width: 200, height: 400 });
  const byRole = Object.fromEntries(result.geometry.map(layer => [layer.role, layer]));
  const bodyTop = byRole.body.anchorY - byRole.body.height * byRole.body.pivotY;
  const headBottom = byRole.head.anchorY + byRole.head.height * (1 - byRole.head.pivotY);
  assert.ok(headBottom > bodyTop, `head/torso overlap should be positive, got ${headBottom - bodyTop}`);
  assert.ok(headBottom - bodyTop < byRole.head.height * 0.15, "head should connect without sinking deep into the torso");
  const bodyArmTip = byRole.body.anchorY + byRole.body.height * (0.344 - byRole.body.pivotY);
  assert.ok(Math.abs(byRole.hand_left.anchorY - bodyArmTip) < 400 * 0.02, "left wrist anchor should meet the sleeve endpoint");
  assert.ok(Math.abs(byRole.hand_right.anchorY - bodyArmTip) < 400 * 0.02, "right wrist anchor should meet the sleeve endpoint");
  assert.equal(byRole.hand_left.pivotY, 0.9, "hand rotation pivots around the wrist");
  assert.ok(["hair_back", "hair_front", "eyes", "brows", "mouth"].every(role => byRole[role].headAttached));
  const roles = result.geometry.map(layer => layer.role);
  for (const [before, after] of [["body", "hair_back"], ["hair_back", "head"], ["head", "hand_left"], ["hand_left", "hair_front"], ["hair_front", "eyes"], ["eyes", "brows"], ["brows", "mouth"]]) {
    assert.ok(roles.indexOf(before) < roles.indexOf(after), `${before} must be behind ${after}`);
  }
  assert.equal(CHARACTER_LAYER_LAYOUTS.mouth.y, 0.22);
});

test("head rotation is shared by facial and hair layers and mirrors anchor positions", () => {
  const layers = ["head", "hair_front", "eyes", "brows", "mouth"].map(role => ({
    role, image: { id: role }, layout: role === "eyes" ? { x: 0.34 } : undefined
  }));
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {} };
  const right = drawLayeredCharacter(ctx, layers, { x: 300, top: 40, width: 180, height: 360, headRotation: 0.2 });
  const left = drawLayeredCharacter(ctx, layers, { x: 300, top: 40, width: 180, height: 360, headRotation: 0.2, facing: "left" });
  const eyeRight = right.geometry.find(layer => layer.role === "eyes");
  const eyeLeft = left.geometry.find(layer => layer.role === "eyes");
  assert.equal(eyeRight.anchorX + eyeLeft.anchorX, 600, "face anchors mirror around the character center");
  for (const result of [right, left]) {
    for (const role of ["hair_front", "eyes", "brows", "mouth"]) {
      const layer = result.geometry.find(item => item.role === role);
      assert.equal(layer.headAttached, true);
      assert.equal(layer.rotation, result === right ? 0.2 : -0.2);
    }
  }
});

test("resting layered dialogue selects the closed mouth variant", () => {
  const selected = selectCharacterLayers([
    { role: "mouth", variant: "closed", image: { id: "closed" } },
    { role: "mouth", variant: "open", image: { id: "open" } }
  ], { viseme: "rest" });
  assert.deepEqual(selected.map(layer => layer.variant), ["closed"]);
});

test("face animation requires independent authored anchors and all five mouth poses per view", () => {
  const anchor = { x: .5, y: .2, width: .1, height: .08, pivotX: .5, pivotY: .5 };
  const roles = ["eye_left", "eye_right", "brow_left", "brow_right"];
  const rig = [
    { role: "head", view: "front", layout: { ...anchor }, image: { width: 10, height: 10 } },
    ...roles.map(role => ({ role, view: "front", layout: { ...anchor }, image: { width: 10, height: 10 } })),
    ...["closed", "open", "round", "wide", "teeth"].map(variant => ({ role: "mouth", variant, view: "front", layout: { ...anchor }, image: { width: 10, height: 10 } }))
  ];
  assert.equal(isCalibratedFaceRig(rig, "front"), true);
  assert.equal(isCalibratedFaceRig(rig, "side"), false, "a front rig cannot be guessed onto a profile face");
  assert.equal(isCalibratedFaceRig(rig.filter(layer => !(layer.role === "mouth" && layer.variant === "teeth")), "front"), false);
  assert.equal(isCalibratedFaceRig(rig.map(layer => layer.role === "eye_left" ? { ...layer, layout: undefined } : layer), "front"), false);
  const side = rig.map(layer => ({ ...layer, view: "side", layout: { ...layer.layout, x: .46 } }));
  assert.equal(isCalibratedFaceRig(side, "side"), true);
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

test("left-facing layered characters mirror sprite anchors, art, and rotation", () => {
  const events = [];
  const ctx = {
    save() {}, restore() {}, translate(...args) { events.push(["translate", ...args]); }, scale(...args) { events.push(["scale", ...args]); },
    rotate(value) { events.push(["rotate", value]); }, drawImage(image) { events.push(["draw", image.id]); }
  };
  const result = drawLayeredCharacter(ctx, [{ role: "head", image: { id: "head" }, layout: { x: .3, y: .25, width: .4, height: .3, pivotX: .5, pivotY: .8, z: 1 } }],
    { x: 200, top: 100, width: 100, height: 300, headRotation: .2, facing: "left" });
  assert.equal(result.geometry[0].anchorX, 220, "the authored x anchor is reflected around the character center");
  assert.ok(events.some(event => event[0] === "scale" && event[1] === -1 && event[2] === 1));
  assert.ok(events.some(event => event[0] === "rotate" && event[1] === -.2));
});
