import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSequenceV1 } from "../packages/motion-studio/index.js";
import { compileCinematicAudioProject } from "../src/audio/cinematic-audio-core.js";
import { prepareStudioSequenceExport, sampleStudioSequenceExport } from "../examples/motion-studio-lab/studio-sequence-export.js";

const viewport = { width: 360, height: 640, fps: 24 };
const image = { id: "image-a", kind: "image", name: "image-a.png", mimeType: "image/png", size: 64 };
const audio = { id: "audio-a", kind: "audio", name: "audio-a.wav", mimeType: "audio/wav", size: 128 };
function scene(id, durationMs, { clipId, clipAt = 0, cameraX = 0 } = {}) {
  const project = { version: 1, durationMs, viewport: { ...viewport },
    layers: [{ id: `layer-${id}`, assetId: image.id, z: 0 }],
    camera: [{ atMs: 0, value: { x: cameraX, y: 0, zoom: 1, rotation: 0 } }] };
  const audioTracks = [{ id: "music", type: "music", volume: 0.5, clips: clipId
    ? [{ id: clipId, asset: audio.id, startMs: clipAt, durationMs: 500, volume: 0.8, loop: false }]
    : [] }];
  return { id, project, audioTracks, characterTracks: [],
    visualEffectsTrack: { version: 1, seed: 1, clips: [] } };
}

test("sequence export freezes ordered scenes and uses one cumulative clock for 3+4+3 seconds", () => {
  const sequence = createStudioSequenceV1({ viewport, assets: [image, audio], scenes: [
    scene("scene-a", 3000, { clipId: "music-a", clipAt: 2000, cameraX: 1 }),
    scene("scene-b", 4000, { clipId: "music-b", clipAt: 1000, cameraX: 2 }),
    scene("scene-c", 3000, { clipId: "music-c", clipAt: 500, cameraX: 3 })
  ] });
  const prepared = prepareStudioSequenceExport(sequence, {
    audioAssetInfo: [{ id: audio.id, durationMs: 5000, channels: 1, sampleRate: 48_000 }], audioMasterVolume: 0.75
  });

  assert.equal(prepared.compiledSequence.durationMs, 10_000);
  assert.equal(prepared.snapshot.project.durationMs, 10_000);
  assert.equal(prepared.snapshot.audioMasterVolume, 0.75);
  assert.ok(Object.isFrozen(prepared.compiledSequence.sequence.scenes[0].project));
  const musicTrack = prepared.snapshot.audioTracks.find(track => track.type === "music");
  assert.ok(Object.isFrozen(musicTrack.clips));
  assert.deepEqual(musicTrack.clips.map(({ id, startMs, volume }) => ({ id, startMs, volume })), [
    { id: "scene-a--music--music-a", startMs: 2000, volume: 0.4 },
    { id: "scene-b--music--music-b", startMs: 4000, volume: 0.4 },
    { id: "scene-c--music--music-c", startMs: 7500, volume: 0.4 }
  ]);

  const frameSamples = [0, 2999, 3000, 6999, 7000, 9999].map(timeMs => {
    const sample = sampleStudioSequenceExport(prepared, timeMs);
    return [sample.sceneId, sample.sceneIndex, sample.sceneTimeMs];
  });
  assert.deepEqual(frameSamples, [
    ["scene-a", 0, 0], ["scene-a", 0, 2999], ["scene-b", 1, 0],
    ["scene-b", 1, 3999], ["scene-c", 2, 0], ["scene-c", 2, 2999]
  ]);
  const audioProject = compileCinematicAudioProject({ durationMs: prepared.compiledSequence.durationMs,
    tracks: prepared.snapshot.audioTracks });
  const activeIdsAt = timeMs => audioProject.sample(timeMs).activeClips.map(clip => clip.id);
  assert.deepEqual(activeIdsAt(1999), []);
  assert.deepEqual(activeIdsAt(2000), ["scene-a--music--music-a"]);
  assert.deepEqual(activeIdsAt(2999), []);
  assert.deepEqual(activeIdsAt(4000), ["scene-b--music--music-b"]);
  assert.deepEqual(activeIdsAt(7000), []);
  assert.deepEqual(activeIdsAt(7500), ["scene-c--music--music-c"]);
});

test("sequence export rejects an unsupported audio master level before recording", () => {
  const sequence = createStudioSequenceV1({ viewport, scenes: [scene("scene-a", 1000)], assets: [image] });
  assert.throws(() => prepareStudioSequenceExport(sequence, { audioMasterVolume: 1.1 }), /master volume/iu);
});
