import test from "node:test";
import assert from "node:assert/strict";
import { classifyViseme, compileTextVisemes } from "../src/character/text-viseme.js";
import { compileTextScene, sampleVisibleDialogueText, TEXT_SCENE_DEMOS } from "../src/character/text-cinematic-scene.js";

test("maps Tunisian and MSA letter families to mouth shapes", () => {
  assert.equal(classifyViseme("م"), "closed");
  assert.equal(classifyViseme("و"), "round");
  assert.equal(classifyViseme("ي"), "wide");
  assert.equal(classifyViseme("ف"), "teeth");
  assert.equal(classifyViseme("ع"), "open");
  assert.equal(classifyViseme("?"), "rest");
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

test("all three demo scenes contain multiple timed speakers in Tunisian and MSA", () => {
  assert.equal(TEXT_SCENE_DEMOS.length, 3);
  const scenes = TEXT_SCENE_DEMOS.map(demo => compileTextScene(demo.dialogue, { language: demo.language }));
  assert.equal(scenes[0].language, "tn");
  assert.equal(scenes[1].language, "ar");
  assert.equal(scenes[2].turns.length, 3);
  for (const scene of scenes) {
    assert.ok(scene.turns.length >= 2);
    assert.ok(scene.turns.every((turn, index) => !index || turn.startMs >= scene.turns[index - 1].endMs));
  }
});
