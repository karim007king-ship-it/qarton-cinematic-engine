import assert from "node:assert/strict";
import test from "node:test";
import {
  addStudioSequenceScene, addStudioSequenceSceneV2, compileStudioSequence, compileStudioSequenceV2,
  createStudioSequenceV1, createStudioSequenceV2, deleteStudioSequenceScene, deleteStudioSequenceSceneV2,
  duplicateStudioSequenceScene, duplicateStudioSequenceSceneV2, legacyStudioProjectToSequence,
  migrateStudioSequenceV1ToV2, migrateStudioSequenceV2ToV1, reorderStudioSequenceScene,
  parseStudioSequenceV2, reorderStudioSequenceSceneV2, sampleStudioSequence, sampleStudioSequenceV2,
  serializeStudioSequenceV2,
  validateStudioSequenceV1, validateStudioSequenceV2
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

  const fiftyScenes = Array.from({ length: 50 }, (_, index) => scene(`perf-${index}`, 1));
  assert.equal(sequence(fiftyScenes).scenes.length, 50);
  const tooManyScenes = Array.from({ length: 65 }, (_, index) => scene(`scene-${index}`, 1));
  assert.throws(() => sequence(tooManyScenes), /64 scenes/iu);
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

function sequenceV2(scenes, transitions) {
  return createStudioSequenceV2({ viewport, scenes, assets: [image, audio], transitions });
}

function transition(fromSceneId, toSceneId, type = "cut", durationMs = 0, audioCrossfadeMs = 0) {
  return { fromSceneId, toSceneId, type, durationMs, audioCrossfadeMs };
}

test("V1 migration preserves local scene and asset data and round-trips Cut projects", () => {
  const legacy = sequence([scene("scene-a", 1000, { audioTracks: [{ id: "music", type: "music", clips: [
    { id: "song", asset: audio.id, startMs: 200, durationMs: 300, loop: false }
  ] }] }), scene("scene-b", 1200)], [image, audio]);
  const before = structuredClone(legacy);
  const migrated = migrateStudioSequenceV1ToV2(legacy);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.transitions, [transition("scene-a", "scene-b")]);
  assert.deepEqual(migrated.scenes, legacy.scenes);
  assert.deepEqual(migrated.assets, legacy.assets);
  assert.equal(migrated.scenes[0].audioTracks[0].clips[0].startMs, 200, "local audio timestamps are unchanged");
  const savedAndRestored = parseStudioSequenceV2(serializeStudioSequenceV2(migrated));
  assert.deepEqual(savedAndRestored, migrated, "V2 save/parse preserves scene and asset metadata");
  assert.equal(savedAndRestored.scenes[0].project.layers[0].assetId, image.id);
  assert.equal(savedAndRestored.assets.find(asset => asset.id === audio.id).size, audio.size);
  assert.deepEqual(legacy, before, "migration does not mutate the source project or its asset records");
  assert.throws(() => parseStudioSequenceV2("{"), /JSON is invalid/iu);
  assert.deepEqual(migrateStudioSequenceV2ToV1(migrated), legacy);
});

test("V2 overlap timeline samples both scenes and centered short audio crossfade deterministically", () => {
  const compiled = compileStudioSequenceV2(sequenceV2([scene("scene-a", 1000), scene("scene-b", 1000)], [
    transition("scene-a", "scene-b", "dissolve", 400, 100)
  ]));
  assert.equal(compiled.durationMs, 1600);
  assert.deepEqual(compiled.transitionIntervals.map(({ startMs, endMs }) => [startMs, endMs]), [[600, 1000]]);
  const start = sampleStudioSequenceV2(compiled, 600);
  assert.equal(start.kind, "transition");
  assert.equal(start.progress, 0);
  assert.equal(start.outgoing.sceneTimeMs, 600);
  assert.equal(start.incoming.sceneTimeMs, 0);
  assert.equal(start.outgoing.opacity, 1);
  assert.equal(start.incoming.opacity, 0);
  assert.equal(start.audioMix.phase, "before");
  assert.deepEqual([start.audioMix.outgoingGain, start.audioMix.incomingGain], [1, 0]);
  const audioStart = sampleStudioSequenceV2(compiled, 750).audioMix;
  assert.equal(audioStart.phase, "crossfade");
  assert.equal(audioStart.progress, 0);
  assert.equal(audioStart.outgoingGain, 1);
  assert.equal(audioStart.incomingGain, 0);
  const audioMiddle = sampleStudioSequenceV2(compiled, 800).audioMix;
  assert.ok(Math.abs(audioMiddle.outgoingGain - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(audioMiddle.incomingGain - Math.SQRT1_2) < 1e-12);
  const audioEnd = sampleStudioSequenceV2(compiled, 850).audioMix;
  assert.equal(audioEnd.phase, "after", "the crossfade window is half-open");
  assert.deepEqual([audioEnd.outgoingGain, audioEnd.incomingGain], [0, 1]);
  const end = sampleStudioSequenceV2(compiled, 1000);
  assert.equal(end.kind, "scene");
  assert.equal(end.sceneId, "scene-b");
  assert.equal(end.sceneTimeMs, 400, "incoming local time advances through the overlap");
  assert.equal(sampleStudioSequenceV2(compiled, 1600).sceneTimeMs, 1000, "final endpoint remains inclusive");
  assert.deepEqual(sampleStudioSequenceV2(compiled, 800), sampleStudioSequenceV2(compiled, 800));
});

test("zero-duration audio crossfade is a hard cut and Fade has a defined black midpoint", () => {
  const cut = compileStudioSequenceV2(sequenceV2([scene("a", 1000), scene("b", 1000)], [transition("a", "b")]));
  assert.equal(cut.durationMs, 2000);
  assert.equal(sampleStudioSequenceV2(cut, 1000).kind, "scene");
  const fade = compileStudioSequenceV2(sequenceV2([scene("a", 1000), scene("b", 1000)], [
    transition("a", "b", "fade", 400, 0)
  ]));
  const middle = sampleStudioSequenceV2(fade, 800);
  assert.equal(middle.progress, 0.5);
  assert.equal(middle.outgoing.opacity, 0);
  assert.equal(middle.incoming.opacity, 0);
  assert.equal(middle.blackOpacity, 1);
  assert.equal(middle.audioMix.phase, "hard-cut");
  assert.deepEqual([middle.audioMix.outgoingGain, middle.audioMix.incomingGain], [0, 1],
    "a zero-length audio crossfade switches at the visual transition midpoint");
  assert.deepEqual([sampleStudioSequenceV2(fade, 799).audioMix.outgoingGain,
    sampleStudioSequenceV2(fade, 799).audioMix.incomingGain], [1, 0]);
  assert.equal(sampleStudioSequenceV2(fade, 600).blackOpacity, 0);
  assert.equal(sampleStudioSequenceV2(fade, 1000).kind, "scene");
});

test("V2 rejects malformed transitions, out-of-scene overlaps, and triple-scene overlap", () => {
  const scenes = [scene("a", 1000), scene("b", 500), scene("c", 1000)];
  const valid = sequenceV2(scenes, [transition("a", "b", "dissolve", 200, 100), transition("b", "c")]);
  assert.equal(compileStudioSequenceV2(valid).durationMs, 2300);
  assert.throws(() => sequenceV2(scenes, [transition("a", "b", "dissolve", 200, 201), transition("b", "c")]), /audioCrossfadeMs/iu);
  assert.throws(() => sequenceV2(scenes, [transition("a", "b", "fade", 501, 0), transition("b", "c")]), /longer than an adjacent scene/iu);
  assert.throws(() => sequenceV2([scene("a", 1000), scene("b", 300), scene("c", 1000)], [
    transition("a", "b", "fade", 200), transition("b", "c", "dissolve", 101)
  ]), /overlap inside scene b/iu);
  assert.throws(() => validateStudioSequenceV2({ ...structuredClone(valid), version: 1 }), /StudioSequenceV2/iu);
  assert.throws(() => validateStudioSequenceV2({ ...structuredClone(valid), unexpected: true }), /invalid fields/iu);
  assert.throws(() => sequenceV2([scene("a"), scene("b")], [transition("a", "b", "wipe", 100)]), /unsupported type/iu);
  assert.throws(() => sequenceV2([scene("a"), scene("b")], [transition("b", "a")]), /adjacent scenes/iu);
  assert.throws(() => sequenceV2([scene("a"), scene("b")], [transition("a", "b", "cut", 10)]), /Cut transitions/iu);
  assert.throws(() => sequenceV2([scene("a"), scene("b")], [transition("a", "b", "fade", 0)]), /positive duration/iu);
  assert.throws(() => sampleStudioSequenceV2(compileStudioSequenceV2(valid), Infinity), TypeError);
});

test("V2 rejects sparse arrays and null or undefined entries at every nested level", () => {
  const baseScenes = [scene("a", 1000), scene("b", 1000)];
  const sparseScenes = [baseScenes[0], , baseScenes[1]];
  assert.throws(() => createStudioSequenceV2({ viewport, scenes: sparseScenes, assets: [image] }), /sparse or empty array entry/iu);
  assert.throws(() => sequenceV2([baseScenes[0], null], [transition("a", "b")]), /sparse or empty array entry/iu);
  const sparseAssets = [image, , audio];
  assert.throws(() => createStudioSequenceV2({ viewport, scenes: baseScenes, assets: sparseAssets,
    transitions: [transition("a", "b")] }), /sparse or empty array entry/iu);
  const sparseTransitions = new Array(1);
  assert.throws(() => createStudioSequenceV2({ viewport, scenes: baseScenes, assets: [image],
    transitions: sparseTransitions }), /sparse or empty array entry/iu);
  const nested = scene("a", 1000, { audioTracks: new Array(1) });
  assert.throws(() => sequenceV2([nested], []), /sparse or empty array entry/iu);
  const emptyEntry = scene("a", 1000, { characterTracks: [undefined] });
  assert.throws(() => sequenceV2([emptyEntry], []), /sparse or empty array entry/iu);
});

test("V2 consecutive transitions meet at one exact timestamp without a gap or triple sample", () => {
  const compiled = compileStudioSequenceV2(sequenceV2([scene("a", 1000), scene("b", 1000), scene("c", 1000)], [
    transition("a", "b", "dissolve", 400), transition("b", "c", "fade", 600)
  ]));
  assert.equal(compiled.durationMs, 2000);
  assert.deepEqual(compiled.transitionIntervals.map(({ startMs, endMs }) => [startMs, endMs]), [[600, 1000], [1000, 1600]]);
  const before = sampleStudioSequenceV2(compiled, 999.999);
  const exact = sampleStudioSequenceV2(compiled, 1000);
  const after = sampleStudioSequenceV2(compiled, 1000.001);
  assert.equal(before.kind, "transition");
  assert.equal(before.transition.type, "dissolve");
  assert.equal(before.outgoing.sceneId, "a");
  assert.equal(before.incoming.sceneId, "b");
  assert.equal(before.incoming.sceneTimeMs, 399.999);
  assert.equal(exact.kind, "transition");
  assert.equal(exact.transition.type, "fade", "the next half-open transition owns the shared boundary");
  assert.equal(exact.outgoing.sceneId, "b");
  assert.equal(exact.incoming.sceneId, "c");
  assert.equal(exact.outgoing.sceneTimeMs, 400);
  assert.equal(exact.incoming.sceneTimeMs, 0);
  assert.equal(after.outgoing.sceneTimeMs, 400.001);
  assert.deepEqual(sampleStudioSequenceV2(compiled, 1000), exact);
});

test("V2 validates local scene durations against the overlap-adjusted project limit", () => {
  const project = sequenceV2([scene("long-a", 151_500), scene("long-b", 151_500)], [
    transition("long-a", "long-b", "dissolve", 3_000, 0)
  ]);
  assert.equal(compileStudioSequenceV2(project).durationMs, 300_000);
});

test("V2 rejects duplicate scene IDs and freezes the scenes collection and cloned data", () => {
  assert.throws(() => sequenceV2([scene("reused"), scene("reused")], [transition("reused", "reused")]),
    /Duplicate sequence scene id: reused/iu);

  const sourceTracks = [{ character: { id: "hero", initial: { mouthOpen: 0 } }, keyframes: [] }];
  const sourceScenes = [scene("immutable-a", 1000, { characterTracks: sourceTracks }), scene("immutable-b")];
  const snapshot = sequenceV2(sourceScenes, [transition("immutable-a", "immutable-b", "dissolve", 200)]);
  const compiled = compileStudioSequenceV2(snapshot);
  assert.ok(Object.isFrozen(snapshot.scenes));
  assert.ok(Object.isFrozen(snapshot.scenes[0]));
  assert.ok(Object.isFrozen(snapshot.scenes[0].project.layers));
  assert.ok(Object.isFrozen(snapshot.scenes[0].characterTracks));
  assert.ok(Object.isFrozen(snapshot.scenes[0].characterTracks[0].character.initial));
  assert.ok(Object.isFrozen(compiled.scenes));

  sourceScenes[0].project.layers[0].z = 12;
  sourceTracks[0].character.initial.mouthOpen = 1;
  sourceScenes.push(scene("later"));
  assert.equal(snapshot.scenes.length, 2);
  assert.equal(snapshot.scenes[0].project.layers[0].z, 0);
  assert.equal(snapshot.scenes[0].characterTracks[0].character.initial.mouthOpen, 0);
  assert.throws(() => snapshot.scenes.push(scene("forbidden")), TypeError);
});

test("V2 migrate-down rejects lossy transitions", () => {
  const dissolve = sequenceV2([scene("a", 1000), scene("b", 1000)], [transition("a", "b", "dissolve", 200, 100)]);
  assert.throws(() => migrateStudioSequenceV2ToV1(dissolve), /cannot represent/iu);
});

test("V2 scene edits preserve unchanged edges and make new adjacency a hard Cut", () => {
  const original = sequenceV2([scene("a", 1000), scene("b", 1000), scene("c", 1000), scene("d", 1000)], [
    transition("a", "b", "dissolve", 100, 50), transition("b", "c", "fade", 100, 0), transition("c", "d")
  ]);
  const copy = duplicateStudioSequenceSceneV2(original, "b", { newId: "b-copy" });
  assert.deepEqual(copy.scenes.map(item => item.id), ["a", "b", "b-copy", "c", "d"]);
  assert.deepEqual(copy.transitions, [transition("a", "b", "dissolve", 100, 50), transition("b", "b-copy"),
    transition("b-copy", "c"), transition("c", "d")]);
  assert.deepEqual(original.transitions[0], transition("a", "b", "dissolve", 100, 50));

  const deleted = deleteStudioSequenceSceneV2(original, "b");
  assert.deepEqual(deleted.scenes.map(item => item.id), ["a", "c", "d"]);
  assert.deepEqual(deleted.transitions, [transition("a", "c"), transition("c", "d")]);

  const reordered = reorderStudioSequenceSceneV2(original, "d", 2);
  assert.deepEqual(reordered.scenes.map(item => item.id), ["a", "b", "d", "c"]);
  assert.deepEqual(reordered.transitions, [transition("a", "b", "dissolve", 100, 50), transition("b", "d"), transition("d", "c")]);
  const added = addStudioSequenceSceneV2(original, scene("x", 1000), 2);
  assert.deepEqual(added.scenes.map(item => item.id), ["a", "b", "x", "c", "d"]);
  assert.deepEqual(added.transitions, [transition("a", "b", "dissolve", 100, 50), transition("b", "x"),
    transition("x", "c"), transition("c", "d")]);
  assert.equal(added.assets.length, original.assets.length, "scene edits retain asset records for registry cleanup later");
  assert.deepEqual(original.scenes.map(item => item.id), ["a", "b", "c", "d"], "edits never mutate the source");
});
