import {
  compileStudioSequenceV2, createStudioSequenceCompositor,
  migrateStudioSequenceV1ToV2, sampleStudioSequenceV2,
  createStudioSequenceAudioCrossfadeEngine, EXPORT_LIMITS, ExportError
} from "@qarton/cinematic-engine/motion-studio";
import { audioRangePcmBytes, collectAudioSourceRanges, cropAudioBuffer, measureAudioBufferRange } from "../../packages/motion-studio/export/audio-source-ranges.js";
import { compileCinematicAudioProject } from "../../src/audio/cinematic-audio-core.js";

function releaseBuffer(buffer) {
  if (!buffer || typeof buffer.getChannelData !== "function") return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    try { buffer.getChannelData(channel).fill(0); } catch {}
  }
}

function awaitAudioWork(work, { signal, timeoutMs = 30_000, onLateValue } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(reject, new ExportError("DECODE_FAILED", "Audio preparation timed out")), timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
    const finish = (callback, value) => {
      if (settled) { if (callback === resolve) { try { onLateValue?.(value); } catch {} } return; }
      settled = true; cleanup(); callback(value);
    };
    const onAbort = () => finish(reject, signal.reason ?? new DOMException("Audio preparation cancelled", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) onAbort();
  });
}

/** A single absolute project clock shared by scene sampling, composition and audio. */
export function createStudioSequenceRuntime(sequence, options = {}) {
  const source = sequence?.version === 2
    ? sequence
    : migrateStudioSequenceV1ToV2(sequence);
  const compiled = compileStudioSequenceV2(source);
  const compositor = createStudioSequenceCompositor(options);
  let released = false;
  return Object.freeze({
    compiled,
    durationMs: compiled.durationMs,
    sample(timeMs) {
      if (released) throw new Error("Studio sequence runtime has been released");
      return sampleStudioSequenceV2(compiled, timeMs);
    },
    draw(context, timeMs, drawScene, drawOptions) {
      if (released) throw new Error("Studio sequence runtime has been released");
      return compositor.draw(context, sampleStudioSequenceV2(compiled, timeMs), drawScene, drawOptions);
    },
    createAudio(options) {
      if (released) throw new Error("Studio sequence runtime has been released");
      return createStudioSequenceAudioCrossfadeEngine(compiled, options);
    },
    release() {
      if (released) return;
      released = true;
      compositor.release();
    }
  });
}

/** Decode unique project audio sequentially, reserving PCM before each browser decode. */
export async function decodeStudioSequenceAudio(compiled, {
  audioContext, resolveAudio, audioInfo = [], signal, onProgress, pcmBudgetBytes = EXPORT_LIMITS.pcmBytes,
  compressedBudgetBytes = 20 * 1024 * 1024, sampleRate = EXPORT_LIMITS.audioSampleRate,
  channels = EXPORT_LIMITS.audioChannels, timeoutMs = 30_000,
  range = { startMs: 0, endMs: compiled?.durationMs ?? 0 }, masterVolume = 1
} = {}) {
  if (!audioContext?.decodeAudioData || typeof resolveAudio !== "function") {
    throw new TypeError("Audio decoding requires a shared AudioContext and local asset resolver");
  }
  const sceneRanges = [];
  let sceneStartMs = 0;
  for (let index = 0; index < compiled.scenes.length; index++) {
    if (index > 0) sceneStartMs = compiled.transitionIntervals[index - 1].startMs;
    const scene = compiled.scenes[index];
    const sceneEndMs = sceneStartMs + scene.project.durationMs;
    const audio = compileCinematicAudioProject({ durationMs: scene.project.durationMs, tracks: scene.audioTracks ?? [] });
    for (const track of audio.tracks) for (const clip of track.clips) {
      sceneRanges.push({ asset: clip.asset, startMs: sceneStartMs + clip.startMs,
        endMs: Math.min(sceneEndMs, sceneStartMs + clip.endMs), offsetMs: clip.offsetMs ?? 0,
        volume: clip.volume, trackVolume: track.volume,
        loop: clip.loop === true, type: track.type });
    }
  }
  const ranges = collectAudioSourceRanges(sceneRanges, audioInfo, { range, masterVolume });
  const referenced = [...ranges.keys()].sort((left, right) => {
    const a = metadataValue(audioInfo, left, channels, sampleRate);
    const b = metadataValue(audioInfo, right, channels, sampleRate);
    return expectedFullBytes(b) - expectedFullBytes(a);
  });
  const buffers = new Map();
  const sourceOffsets = new Map();
  const loopableAssets = new Set();
  let pcmBytes = 0, compressedBytes = 0;
  const release = () => {
    for (const buffer of buffers.values()) releaseBuffer(buffer);
    buffers.clear();
  };
  try {
    let expectedRetainedBytes = 0, plannedPeakBytes = 0;
    for (const assetId of referenced) {
      const info = metadataValue(audioInfo, assetId, channels, sampleRate);
      const retained = audioRangePcmBytes(info, ranges.get(assetId));
      const full = expectedFullBytes(info);
      expectedRetainedBytes += retained;
      plannedPeakBytes = Math.max(plannedPeakBytes, expectedRetainedBytes + (ranges.get(assetId).full ? 0 : full));
      if (!Number.isSafeInteger(expectedRetainedBytes) || expectedRetainedBytes > pcmBudgetBytes ||
          !Number.isSafeInteger(plannedPeakBytes) || plannedPeakBytes > pcmBudgetBytes) {
        throw new ExportError("BUDGET_EXCEEDED", "Requested audio ranges and the temporary full-file decoder buffer exceed the 32 MiB PCM working budget. Shorten the selected audio range or export at a lower project duration.", {
          assetId, expectedRetainedBytes, plannedPeakBytes, pcmBudgetBytes
        });
      }
    }
    for (const assetId of referenced) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Audio preparation cancelled", "AbortError");
      const blob = await awaitAudioWork(resolveAudio(assetId, signal), { signal, timeoutMs });
      if (!blob || typeof blob.arrayBuffer !== "function" || !Number.isSafeInteger(blob.size) || blob.size < 1) {
        throw new ExportError("ASSET_MISSING", `Local audio asset is unavailable: ${assetId}`);
      }
      if (blob.size > compressedBudgetBytes || compressedBytes > compressedBudgetBytes - blob.size) {
        throw new ExportError("BUDGET_EXCEEDED", "Compressed audio assets exceed the 20 MiB input budget", {
          compressedBudgetBytes, assetId
        });
      }
      compressedBytes += blob.size;
      // Reserve a conservative stereo PCM estimate from the decoded duration metadata
      // carried by the local File when available; actual AudioBuffer bytes are checked too.
      let encoded;
      try {
        encoded = await awaitAudioWork(blob.arrayBuffer(), { signal, timeoutMs });
        const buffer = await awaitAudioWork(audioContext.decodeAudioData(encoded), { signal, timeoutMs, onLateValue: releaseBuffer });
        const actualSourceBytes = buffer.length * buffer.numberOfChannels * EXPORT_LIMITS.audioBytesPerSample;
        const measurement = measureAudioBufferRange(buffer, ranges.get(assetId));
        const peakBytes = pcmBytes + actualSourceBytes + (measurement.full ? 0 : measurement.bytes);
        if (!Number.isSafeInteger(actualSourceBytes) || actualSourceBytes < 1 ||
            !Number.isSafeInteger(peakBytes) || peakBytes > pcmBudgetBytes) {
          throw new ExportError("BUDGET_EXCEEDED", "The source decode and requested audio range exceed the 32 MiB PCM working budget. Shorten the selected audio range or trim the source file.", {
            assetId, decodedBytes: peakBytes, sourceBytes: actualSourceBytes,
            retainedBytes: pcmBytes, requestedRangeBytes: measurement.bytes, pcmBudgetBytes
          });
        }
        const cropped = cropAudioBuffer(audioContext, buffer, ranges.get(assetId), measurement);
        if (cropped.buffer !== buffer) releaseBuffer(buffer);
        pcmBytes += cropped.bytes;
        buffers.set(assetId, cropped.buffer);
        sourceOffsets.set(assetId, cropped.startOffsetSeconds);
        if (cropped.full) loopableAssets.add(assetId);
        onProgress?.(Object.freeze({ phase: "preparing-audio", elapsedMs: 0, targetMs: compiled.durationMs,
          decodedAssets: buffers.size, totalAssets: referenced.length, decodedBytes: pcmBytes }));
      } finally { encoded = null; }
    }
    return Object.freeze({ buffers, sourceOffsets, loopableAssets, decodedBytes: pcmBytes, release });
  } catch (error) {
    release();
    throw error;
  }
}

function metadataValue(audioInfo, assetId, defaultChannels, defaultSampleRate) {
  const info = audioInfo.find(item => item.id === assetId);
  if (!info || !Number.isFinite(info.durationMs) || info.durationMs <= 0) {
    throw new ExportError("DECODE_FAILED", `Audio memory metadata is unavailable: ${assetId}`);
  }
  return { id: assetId, durationMs: info.durationMs, channels: info.channels ?? defaultChannels,
    sampleRate: info.sampleRate ?? defaultSampleRate };
}

function expectedFullBytes(info) {
  return Math.ceil(info.durationMs / 1000 * info.channels * info.sampleRate * EXPORT_LIMITS.audioBytesPerSample);
}
