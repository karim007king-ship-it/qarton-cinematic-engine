import { compileStudioSequence, sampleStudioSequence } from "../../packages/motion-studio/index.js";

const AUDIO_TYPES = Object.freeze(["dialogue", "music", "sfx"]);
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

/** Freeze one StudioSequenceV1 and map its scene-local audio tracks onto the project clock. */
export function prepareStudioSequenceExport(sequence, { audioAssetInfo = [], audioMasterVolume = 1 } = {}) {
  const compiledSequence = compileStudioSequence(sequence);
  const snapshotSequence = compiledSequence.sequence;
  const audioTracks = AUDIO_TYPES.map(type => ({ id: `sequence-audio-${type}`, type, volume: 1, clips: [] }));
  const byType = new Map(audioTracks.map(track => [track.type, track]));
  let startMs = 0;
  for (const scene of snapshotSequence.scenes) {
    for (const sourceTrack of scene.audioTracks) {
      const target = byType.get(sourceTrack.type);
      for (const clip of sourceTrack.clips) {
        target.clips.push({ ...structuredClone(clip), id: `${scene.id}--${sourceTrack.id}--${clip.id}`,
          startMs: startMs + clip.startMs, volume: (clip.volume ?? 1) * (sourceTrack.volume ?? 1) });
      }
    }
    startMs += scene.project.durationMs;
  }
  if (!Number.isFinite(audioMasterVolume) || audioMasterVolume < 0 || audioMasterVolume > 1) {
    throw new RangeError("Sequence export master volume must be between 0 and 1");
  }
  const audioAssets = snapshotSequence.assets.filter(asset => asset.kind === "audio").map(asset => ({
    id: asset.id, name: asset.name, type: asset.mimeType, size: asset.size
  }));
  const firstProject = snapshotSequence.scenes[0].project;
  const snapshot = freeze({
    project: structuredClone({ ...firstProject, durationMs: compiledSequence.durationMs }),
    audioTracks: structuredClone(audioTracks), audioAssets,
    audioAssetInfo: structuredClone(audioAssetInfo), audioMasterVolume
  });
  return Object.freeze({ compiledSequence, snapshot });
}

/** Resolve the exact active scene and scene-local time for one absolute project timestamp. */
export function sampleStudioSequenceExport(prepared, projectTimeMs) {
  if (!prepared?.compiledSequence || prepared.compiledSequence.kind !== "compiled-studio-sequence") {
    throw new TypeError("Expected a prepared StudioSequenceV1 export");
  }
  return sampleStudioSequence(prepared.compiledSequence, projectTimeMs);
}
