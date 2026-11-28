import test from "node:test";
import assert from "node:assert/strict";
import { classifyViseme, compileTextVisemes } from "../src/character/text-viseme.js";
import { compileTextScene, createTextSceneModel, drawTextCinematicScene, sampleVisibleDialogueText, TEXT_SCENE_DEMOS } from "../src/character/text-cinematic-scene.js";

test("maps Tunisian and MSA letter families to mouth shapes", () => {
  assert.equal(classifyViseme("م"), "closed");
  assert.equal(classifyViseme("و"), "round");
  assert.equal(classifyViseme("ي"), "wide");
  assert.equal(classifyViseme("ف"), "teeth");
  assert.equal(classifyViseme("ع"), "open");
  assert.equal(classifyViseme("?"), "rest");
  assert.equal(classifyViseme("مُ"), "round");
  assert.equal(classifyViseme("مِ"), "wide");
  assert.equal(classifyViseme("بَ"), "open");
  assert.equal(classifyViseme("بْ"), "closed");
});

test("punctuation inserts silent holds and text completion closes the mouth", () => {
  const animation = compileTextVisemes("مرحبا، يا صديقي!", { language: "tn" });
  const comma = animation.events.find(event => event.character === "،");
  assert.equal(comma.viseme, "rest");
  assert.ok(comma.durationMs >= 250);
  assert.equal(animation.sample(animation.durationMs).active, false);
  assert.equal(animation.sample(animation.durationMs).mouthOpen, 0);
  assert.equal(animation.sample(0).expression, "neutral");
});

test("dialogue reveals letters on the same timed viseme events", () => {
  const animation = compileTextVisemes("باب؟", { startMs: 450, language: "tn" });
  assert.equal(sampleVisibleDialogueText(animation, 0), "ب");
  assert.equal(sampleVisibleDialogueText(animation, 87), "ب");
  assert.equal(sampleVisibleDialogueText(animation, 88), "با");
  assert.equal(sampleVisibleDialogueText(animation, animation.durationMs).trim(), "باب؟");
});

test("newlines hold the mouth closed without shifting subsequent reveal events", () => {
  const animation = compileTextVisemes("أهلا\nبك", { startMs: 300, language: "ar" });
  const newline = animation.events.find(event => event.character === "\n");
  assert.ok(newline);
  const before = sampleVisibleDialogueText(animation, newline.atMs - animation.startMs - 1);
  const after = sampleVisibleDialogueText(animation, newline.atMs - animation.startMs + newline.durationMs);
  assert.ok(before.includes("أهلا"));
  assert.ok(after.includes("\nب"));
  assert.equal(animation.sample(newline.atMs - animation.startMs + 50).active, false);
});

test("speed changes dialog duration and supports all dramatic expression labels", () => {
  const slow = compileTextVisemes("هذا حوارٌ مهم!", { speed: 0.5, expression: "determined", language: "ar" });
  const fast = compileTextVisemes("هذا حوارٌ مهم!", { speed: 2, expression: "determined", language: "ar" });
  assert.ok(slow.durationMs > fast.durationMs);
  assert.equal(slow.sample(0).expression, "determined");
  for (const expression of ["happy", "sad", "angry", "afraid", "surprised", "thinking"]) {
    assert.equal(compileTextVisemes("نص", { expression }).sample(0).expression, expression);
  }
});

test("rejects invalid speed, language, expression, and overlong dialogue", () => {
  assert.throws(() => compileTextVisemes("text", { speed: 3 }), RangeError);
  assert.throws(() => compileTextVisemes("text", { language: "fr" }), TypeError);
  assert.throws(() => compileTextVisemes("text", { expression: "unknown" }), TypeError);
  assert.throws(() => compileTextVisemes("x".repeat(5001)), TypeError);
});

test("all four demo scenes contain multiple timed speakers in Tunisian and MSA", () => {
  assert.equal(TEXT_SCENE_DEMOS.length, 4);
  const scenes = TEXT_SCENE_DEMOS.map(demo => compileTextScene(demo, { language: demo.language }));
  assert.equal(scenes[0].language, "tn");
  assert.equal(scenes[1].language, "ar");
  assert.equal(scenes[2].turns.length, 4);
  assert.deepEqual(scenes.map(scene => scene.characters.length), [2, 3, 2, 3]);
  for (const scene of scenes) {
    assert.ok(scene.turns.length >= 2);
    assert.ok(scene.turns.every((turn, index) => !index || turn.startMs >= scene.turns[index - 1].endMs));
    assert.equal(new Set(scene.characters.map(character => character.id)).size, scene.characters.length);
  }
});

test("a character stays unique when they have multiple dialogue roles", () => {
  const demo = TEXT_SCENE_DEMOS[0];
  const scene = compileTextScene(demo);
  const laylaTurns = scene.turns.filter(turn => turn.speakerId === "layla");
  assert.equal(laylaTurns.length, 2);
  assert.equal(scene.characters.filter(character => character.id === "layla").length, 1);
  assert.equal(laylaTurns[0].character, laylaTurns[1].character);
  assert.equal(laylaTurns[0].character.spriteKey, "layla");
});

test("a complete portrait without authored transparent face layers never gets guessed facial overlays", () => {
  const image = { width: 400, height: 900 };
  let imageDraws = 0, ellipses = 0, strokes = 0;
  const gradient = { addColorStop() {} };
  const ctx = {
    canvas: { width: 720, height: 1280 }, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    drawImage() { imageDraws += 1; }, fillRect() {}, createRadialGradient() { return gradient; },
    beginPath() {}, ellipse() { ellipses += 1; }, stroke() { strokes += 1; }
  };
  const scene = compileTextScene({ characters: [{ id: "layla", name: "ليلى", x: .5, y: .9, scale: .7 }],
    dialogue: [{ id: "line", speakerId: "layla", text: "نحكي تو" }] });
  const result = drawTextCinematicScene(ctx, scene, 650, { transparent: true, assets: new Map([["layla", image]]), drawDialogue: false });
  assert.equal(result.faceRigValid.layla, false);
  assert.equal(imageDraws, 1, "only the authored full portrait is painted");
  assert.equal(ellipses, 0, "no approximate mouth, eyes, or skin cover is layered over the portrait");
  assert.equal(strokes, 0, "no guessed facial outlines are drawn");
});

test("stable character IDs are unique and dialogue cannot reference unknown characters", () => {
  const character = { id: "nour", name: "نور" };
  assert.throws(() => createTextSceneModel({ characters: [character, character], dialogue: [{ id: "line", speakerId: "nour", text: "مرحبا" }] }), /unique stable character ID/u);
  assert.throws(() => createTextSceneModel({ characters: [character], dialogue: [{ id: "line", speakerId: "missing", text: "مرحبا" }] }), /unknown character/u);
});
