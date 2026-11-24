import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSequenceV1 } from "../packages/motion-studio/index.js";
import { createStudioSequenceEditor, parseStudioSequenceFile, serializeStudioSequenceFile } from "../examples/motion-studio-lab/studio-sequence-editor.js";

const viewport = { width: 360, height: 640, fps: 24 };
const asset = { id: "image", kind: "image", name: "image.png", mimeType: "image/png", size: 0 };
const makeScene = (id, durationMs = 3000) => ({ id, project: { version: 1, durationMs, viewport,
  layers: [{ id: "background", assetId: "image", z: 0 }],
  camera: [{ atMs: 0, value: { x: 0, y: 0, zoom: 1, rotation: 0 } },
    { atMs: durationMs, value: { x: 0, y: 0, zoom: 1, rotation: 0 } }] } });
const base = () => createStudioSequenceV1({ viewport, assets: [asset], scenes: [makeScene("a"), makeScene("b", 5000)] });

test("editor names, active selection, thumbnails order and Cut timeline are stable", () => {
  const editor = createStudioSequenceEditor(base(), { names: { a: "Opening", b: "Ending" } });
  assert.equal(editor.nameOf("a"), "Opening");
  assert.equal(editor.activeSceneId, "a");
  assert.deepEqual(editor.scenes.map(({ id, startMs, endMs }) => [id, startMs, endMs]), [["a", 0, 3000], ["b", 3000, 8000]]);
  assert.equal(editor.sample(3000).sceneId, "b");
  assert.equal(editor.timeFor("b", 1200), 4200);
  const cachedView = editor.snapshot();
  assert.equal(editor.snapshot().compiled, cachedView.compiled, "read-only snapshots reuse the compiled sequence");
  assert.equal(editor.scenes[0], cachedView.scenes[0], "read-only timeline queries reuse interval summaries");
  editor.activate("b");
  assert.equal(editor.activeSceneId, "b");
  editor.rename("b", "Finale");
  assert.equal(editor.nameOf("b"), "Finale");
});

test("editor add, duplicate, remove and reorder operations preserve names and immutable sequence", () => {
  const editor = createStudioSequenceEditor(base());
  const original = editor.sequence;
  const added = editor.add(makeScene("c"), 1, "Middle");
  assert.deepEqual(added.scenes.map(scene => scene.id), ["a", "c", "b"]);
  const duplicate = editor.duplicate("c", "c-copy");
  assert.equal(duplicate.activeSceneId, "c-copy");
  assert.equal(editor.nameOf("c-copy"), "Middle — نسخة");
  editor.reorder("b", 0);
  assert.deepEqual(editor.scenes.map(scene => scene.id), ["b", "a", "c", "c-copy"]);
  editor.remove("c-copy");
  assert.deepEqual(editor.scenes.map(scene => scene.id), ["b", "a", "c"]);
  assert.equal(editor.nameOf("c"), "Middle");
  assert.equal(original.scenes.length, 2);
  const longName = createStudioSequenceEditor(base(), { names: { a: "x".repeat(80), b: "Ending" } });
  assert.equal(longName.duplicate("a", "a-copy").scenes[1].name.length, 80);
  assert.ok(longName.nameOf("a-copy").endsWith(" — نسخة"));
});

test("scene duration editing moves endpoint key and rejects invalid or sequence-overflow durations", () => {
  const editor = createStudioSequenceEditor(base());
  editor.setDuration("a", 4000);
  assert.equal(editor.scenes[0].project.durationMs, 4000);
  assert.equal(editor.scenes[0].project.camera.at(-1).atMs, 4000);
  assert.equal(editor.durationMs, 9000);
  assert.throws(() => editor.setDuration("a", 2000), RangeError);
  const long = createStudioSequenceV1({ viewport, assets: [asset], scenes: [makeScene("long", 60_000), makeScene("long2", 60_000), makeScene("long3", 60_000), makeScene("long4", 60_000), makeScene("long5", 60_000)] });
  const bounded = createStudioSequenceEditor(long);
  assert.throws(() => bounded.setDuration("long", 60_001), RangeError);
});

test("names reject empty and oversized values without changing saved metadata", () => {
  const editor = createStudioSequenceEditor(base());
  assert.throws(() => editor.rename("a", "   "), TypeError);
  assert.throws(() => editor.rename("a", "x".repeat(81)), TypeError);
  assert.equal(editor.nameOf("a"), "المشهد 1");
});

test("sequence files round-trip per-scene Fit/Fill settings and preserve earlier sequence-file defaults", () => {
  const editor = createStudioSequenceEditor(base(), { names: { a: "Opening", b: "Ending" } });
  const text = serializeStudioSequenceFile(editor, { projectId: "local-project", aspectPreset: "portrait", fitMode: "fill", audioMasterVolume: 0.75,
    sceneSettings: { a: { aspectPreset: "square", fitMode: "fit" }, b: { aspectPreset: "portrait", fitMode: "fill" } } });
  const parsed = parseStudioSequenceFile(text);
  assert.equal(parsed.editor.nameOf("b"), "Ending");
  assert.equal(parsed.editor.durationMs, 8000);
  assert.deepEqual(parsed.settings, { aspectPreset: "portrait", fitMode: "fill" });
  assert.deepEqual(parsed.sceneSettings, { a: { aspectPreset: "square", fitMode: "fit" }, b: { aspectPreset: "portrait", fitMode: "fill" } });
  assert.equal(parsed.audioMasterVolume, 0.75);
  const broken = JSON.parse(text); broken.sceneNames.missing = "Wrong";
  assert.throws(() => parseStudioSequenceFile(JSON.stringify(broken)), /names do not match/iu);
  const earlierFile = JSON.parse(text); delete earlierFile.sceneSettings;
  const compatible = parseStudioSequenceFile(JSON.stringify(earlierFile));
  assert.deepEqual(compatible.sceneSettings, { a: { aspectPreset: "portrait", fitMode: "fill" }, b: { aspectPreset: "portrait", fitMode: "fill" } });
  const invalidSettings = JSON.parse(text); invalidSettings.sceneSettings.a.fitMode = "stretch";
  assert.throws(() => parseStudioSequenceFile(JSON.stringify(invalidSettings)), /scene image settings/iu);
});
