import assert from "node:assert/strict";
import test from "node:test";
import {
  addStudioSequenceScene, compileStudioSequence, createStudioSequenceV1, deleteStudioSequenceScene,
  duplicateStudioSequenceScene, legacyStudioProjectToSequence, reorderStudioSequenceScene,
  sampleStudioSequence, validateStudioSequenceV1
} from "../packages/motion-studio/index.js";

const viewport = Object.freeze({ width: 360, height: 640, fps: 24 });
const image = Object.freeze({ id: "image-a", kind: "image", name: "image-a.png", mimeType: "image/png", size: 128 });
const audio = Object.freeze({ id: "audio-a", kind: "audio", name: "audio-a.ogg", mimeType: "audio/ogg", size: 256 });

function project(durationMs = 1000, assetId = image.id, override = {}) {
  return { version: 1, durationMs, viewport: { ...viewport }, layers: [{ id: "layer-1", assetId, z: 0 }], ...override };
}

function scene(id, durationMs = 1000, overrides = {}) {
  return { id, project: project(durationMs), ...overrides };
}

function sequence(scenes = [scene("scene-a"), scene("scene-b", 2000)], assets = [image]) {
  return createStudioSequenceV1({ viewport, scenes, assets });
}

test("sequence compiles cumulative cut intervals and samples exact half-open boundaries", () => {
  const compiled = compileStudioSequence(sequence());
  assert.equal(compiled.durationMs, 3000);
  assert.deepEqual(compiled.transitions, [{ fromSceneId: "scene-a", toSceneId: "scene-b", type: "cut", durationMs: 0 }]);
  assert.deepEqual(sampleStudioSequence(compiled, 0), {
    sequenceTimeMs: 0, totalDurationMs: 3000, sceneIndex: 0, sceneId: "scene-a", sceneTimeMs: 0,
    sceneDurationMs: 1000, scene: compiled.scenes[0], transition: null
  });
  assert.equal(sampleStudioSequence(compiled, 999).sceneTimeMs, 999);
  const atCut = sampleStudioSequence(compiled, 1000);
  assert.equal(atCut.sceneId, "scene-b");
  assert.equal(atCut.sceneTimeMs, 0);
  assert.equal(atCut.transition.type, "cut");
  assert.equal(sampleStudioSequence(compiled, 2999).sceneTimeMs, 1999);
  assert.equal(sampleStudioSequence(compiled, 3000).sceneTimeMs, 2000, "the final endpoint belongs to the final scene");
  assert.equal(sampleStudioSequence(compiled, -10).sceneId, "scene-a");
  assert.equal(sampleStudioSequence(compiled, 5000).sceneTimeMs, 2000);
  assert.throws(() => sampleStudioSequence(compiled, Infinity), TypeError);
  assert.throws(() => sampleStudioSequence(sequence(), 10), TypeError);
});

test("seek and replay samples are absolute and independent of prior sampling order", () => {
  const compiled = compileStudioSequence(sequence([scene("scene-a", 800), scene("scene-b", 1200), scene("scene-c", 500)]));
  const first = sampleStudioSequence(compiled, 400);
  sampleStudioSequence(compiled, 2000);
  sampleStudioSequence(compiled, 0); // replay
  assert.deepEqual(sampleStudioSequence(compiled, 400), first);
  assert.deepEqual(sampleStudioSequence(compiled, 0), sampleStudioSequence(compiled, 0));
  assert.equal(sampleStudioSequence(compiled, 800).sceneId, "scene-b");
  assert.equal(sampleStudioSequence(compiled, 2000).sceneId, "scene-c");
  assert.equal(sampleStudioSequence(compiled, 2500).sceneTimeMs, 500);
});

test("add, duplicate, reorder, and delete are immutable transactions with regenerated Cuts", () => {
  const original = sequence([scene("scene-a"), scene("scene-b")]);
  const extra = scene("scene-c", 500);
  const added = addStudioSequenceScene(original, extra, 1);
  assert.deepEqual(original.scenes.map(item => item.id), ["scene-a", "scene-b"]);
  assert.deepEqual(added.scenes.map(item => item.id), ["scene-a", "scene-c", "scene-b"]);
  assert.equal(added.transitions.length, 2);

  const duplicated = duplicateStudioSequenceScene(added, "scene-c", { newId: "scene-c-copy" });
  assert.deepEqual(duplicated.scenes.map(item => item.id), ["scene-a", "scene-c", "scene-c-copy", "scene-b"]);
  assert.notStrictEqual(duplicated.scenes[1], duplicated.scenes[2]);
  assert.notStrictEqual(duplicated.scenes[1].project, duplicated.scenes[2].project);
  assert.notStrictEqual(duplicated.scenes[1].project.layers, duplicated.scenes[2].project.layers);
  assert.deepEqual(duplicated.assets, added.assets, "duplicate scenes share opaque asset records");

  const reordered = reorderStudioSequenceScene(duplicated, "scene-b", 0);
  assert.deepEqual(reordered.scenes.map(item => item.id), ["scene-b", "scene-a", "scene-c", "scene-c-copy"]);
  assert.deepEqual(reordered.transitions.map(item => [item.fromSceneId, item.toSceneId]), [
    ["scene-b", "scene-a"], ["scene-a", "scene-c"], ["scene-c", "scene-c-copy"]
  ]);
  const deleted = deleteStudioSequenceScene(reordered, "scene-c");
  assert.deepEqual(deleted.scenes.map(item => item.id), ["scene-b", "scene-a", "scene-c-copy"]);
  assert.equal(deleted.transitions.length, 2);
  assert.equal(deleted.assets.length, 1, "scene deletion does not delete shared assets");
  assert.deepEqual(original.scenes.map(item => item.id), ["scene-a", "scene-b"]);
  assert.deepEqual(extra, scene("scene-c", 500));
});

test("scene insertion and ordering validate bounds, IDs, and last-scene deletion", () => {
  const one = sequence([scene("only")]);
  assert.throws(() => addStudioSequenceScene(one, scene("second"), 2), RangeError);
  assert.throws(() => duplicateStudioSequenceScene(one, "only", { newId: "only" }), TypeError);
  assert.throws(() => duplicateStudioSequenceScene(one, "missing", { newId: "copy" }), RangeError);
  assert.throws(() => reorderStudioSequenceScene(one, "only", 0.5), RangeError);
  assert.throws(() => deleteStudioSequenceScene(one, "only"), RangeError);
  assert.throws(() => deleteStudioSequenceScene(one, "missing"), RangeError);
});

test("legacy StudioProjectV1 plus sidecar tracks converts without mutating its source", () => {
  const oldProject = project(2000);
  const legacyAssets = [image, audio];
  const legacyAudio = [{ id: "music", type: "music", volume: 1, clips: [
    { id: "loop", asset: audio.id, startMs: 0, durationMs: 1500, loop: true }
  ] }];
  const oldCharacterTrack = { character: { id: "hero", initial: { expression: "neutral" } }, keyframes: [] };
  const before = structuredClone({ oldProject, legacyAssets, legacyAudio, oldCharacterTrack });
  const converted = legacyStudioProjectToSequence(oldProject, { assets: legacyAssets, audioTracks: legacyAudio,
    characterTrack: oldCharacterTrack });
  assert.equal(converted.kind, "studio-sequence");
  assert.equal(converted.scenes.length, 1);
  assert.equal(converted.scenes[0].id, "legacy-scene");
  assert.equal(converted.scenes[0].project.durationMs, 2000);
  assert.deepEqual(converted.scenes[0].characterTracks, [oldCharacterTrack]);
  assert.deepEqual(converted.transitions, []);
  assert.deepEqual({ oldProject, legacyAssets, legacyAudio, oldCharacterTrack }, before);
  assert.notStrictEqual(converted.scenes[0].project, oldProject);
  assert.throws(() => legacyStudioProjectToSequence(oldProject), /missing image asset/u);
});

test("nested audio, character, and visual-effect tracks reuse the existing scene validators", () => {
  const validCharacter = { character: { id: "hero", initial: { expression: "neutral" } }, keyframes: [] };
  const validAudio = [{ id: "music", type: "music", clips: [
    { id: "loop", asset: audio.id, startMs: 0, durationMs: 1000, loop: true }
  ] }];
  const validEffects = { version: 1, seed: 42, clips: [] };
  const valid = sequence([scene("scene-a", 1000, { audioTracks: validAudio, characterTracks: [validCharacter], visualEffectsTrack: validEffects })], [image, audio]);
  assert.equal(valid.scenes[0].audioTracks[0].clips[0].asset, audio.id);
  assert.equal(valid.scenes[0].characterTracks[0].character.id, "hero");

  assert.throws(() => sequence([scene("scene-a", 1000, { audioTracks: [{ id: "bad", type: "music", clips: [
    { id: "late", asset: audio.id, startMs: 0, durationMs: 1001 }
  ] }] })], [image, audio]), /duration|scene/iu);
  assert.throws(() => sequence([scene("scene-a", 1000, { characterTracks: [{ character: { id: "hero", initial: {} },
    keyframes: [{ atMs: 2000, values: { mouthOpen: 0.5 } }] }] })]), /time|duration|range/iu);
  assert.throws(() => sequence([scene("scene-a", 1000, { visualEffectsTrack: { version: 2, seed: 1, clips: [] } })]), /version/iu);
});

test("strict sequence validation rejects malformed IDs, project data, and inconsistent viewports", () => {
  const base = sequence();
  const mutate = patch => validateStudioSequenceV1({ ...structuredClone(base), ...patch });
  assert.throws(() => mutate({ unexpected: true }), /invalid fields/iu);
  assert.throws(() => mutate({ version: 2 }), /StudioSequenceV1/iu);
  assert.throws(() => mutate({ viewport: { ...viewport, width: 360.5 } }), /integer/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), scenes: [scene("bad id")] }), /identifier/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), scenes: [scene("scene-a"), scene("scene-a")] }), /Duplicate sequence scene id/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), scenes: [scene("scene-a", 0)] }), /Duration|duration/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), scenes: [scene("scene-a", 1000, {
    project: project(1000, image.id, { viewport: { ...viewport, width: 640 } })
  })] }), /viewport/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), scenes: [scene("scene-a", 1000, {
    project: { ...project(), extra: true }
  })] }), /invalid fields/iu);
});

test("asset references, descriptors, total durations, and record-count budgets are strict", () => {
  assert.throws(() => sequence([scene("scene-a", 1000, { project: project(1000, "missing-image") })]), /missing image asset/iu);
  const noAudio = [{ id: "music", type: "music", clips: [{ id: "clip", asset: "missing-audio", startMs: 0, durationMs: 500 }] }];
  assert.throws(() => sequence([scene("scene-a", 1000, { audioTracks: noAudio })]), /missing audio asset/iu);
  assert.throws(() => createStudioSequenceV1({ viewport, scenes: [scene("scene-a")], assets: [{ ...image, size: -1 }] }), /size/iu);
  assert.throws(() => createStudioSequenceV1({ viewport, scenes: [scene("scene-a")], assets: [{ ...image, id: "bad id" }] }), /identifier/iu);
  assert.throws(() => sequence([scene("scene-a", 150_000), scene("scene-b", 150_001)]), /duration/iu);
  assert.equal(sequence([scene("scene-a", 150_000), scene("scene-b", 150_000)]).scenes.length, 2);

  const tooManyScenes = Array.from({ length: 33 }, (_, index) => scene(`scene-${index}`, 1));
  assert.throws(() => sequence(tooManyScenes), /32 scenes/iu);
  const tooManyAssets = Array.from({ length: 257 }, (_, index) => ({ ...image, id: `image-${index}` }));
  assert.throws(() => sequence([scene("scene-a")], tooManyAssets), /256 records/iu);
});

test("only adjacent zero-duration Cuts are accepted; dissolves and corrupt links reject", () => {
  const base = sequence();
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), transitions: [
    { fromSceneId: "scene-a", toSceneId: "scene-b", type: "dissolve", durationMs: 100 }
  ] }), /Cut/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), transitions: [
    { fromSceneId: "scene-b", toSceneId: "scene-a", type: "cut", durationMs: 0 }
  ] }), /adjacent scenes/iu);
  assert.throws(() => validateStudioSequenceV1({ ...structuredClone(base), transitions: [] }), /exactly one Cut/iu);
});
