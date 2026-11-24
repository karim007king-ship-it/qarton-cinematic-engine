import {
  compileStudioSequenceV2, createStudioSequenceCompositor,
  migrateStudioSequenceV1ToV2, sampleStudioSequenceV2,
  createStudioSequenceAudioCrossfadeEngine, EXPORT_LIMITS, ExportError
} from "@qarton/cinematic-engine/motion-studio";

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
    if (signal?.aborted) { onAbort(); return; }
    Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
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
  channels = EXPORT_LIMITS.audioChannels, timeoutMs = 30_000
} = {}) {
  if (!audioContext?.decodeAudioData || typeof resolveAudio !== "function") {
    throw new TypeError("Audio decoding requires a shared AudioContext and local asset resolver");
  }
  const referenced = new Map();
  for (const scene of compiled.scenes) for (const track of scene.audioTracks ?? []) {
    if (!(track.volume > 0)) continue;
    for (const clip of track.clips) if ((clip.volume ?? 1) > 0) referenced.set(clip.asset, true);
  }
  const buffers = new Map();
  const metadata = new Map(audioInfo.map(item => [item.id, item]));
  let pcmBytes = 0, compressedBytes = 0;
  const release = () => {
    for (const buffer of buffers.values()) for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      try { buffer.getChannelData(channel).fill(0); } catch {}
    }
    buffers.clear();
  };
  try {
    let reservedPcmBytes = 0;
    for (const assetId of referenced.keys()) {
      const info = metadata.get(assetId);
      if (!info || !Number.isFinite(info.durationMs) || info.durationMs <= 0) {
        throw new ExportError("DECODE_FAILED", `Audio memory metadata is unavailable: ${assetId}`);
      }
      const reservation = Math.ceil(info.durationMs / 1000 * (info.channels ?? channels) *
        (info.sampleRate ?? sampleRate) * EXPORT_LIMITS.audioBytesPerSample);
      if (!Number.isSafeInteger(reservation) || reservation < 1 || reservation > pcmBudgetBytes ||
          reservedPcmBytes > pcmBudgetBytes - reservation) {
        throw new ExportError("BUDGET_EXCEEDED", "Expected decoded audio exceeds the 32 MiB PCM budget", {
          assetId, expectedPcmBytes: reservedPcmBytes + reservation, pcmBudgetBytes
        });
      }
      reservedPcmBytes += reservation;
    }
    for (const assetId of referenced.keys()) {
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
        const actual = buffer.length * buffer.numberOfChannels * EXPORT_LIMITS.audioBytesPerSample;
        if (!Number.isSafeInteger(actual) || actual < 1 || actual > pcmBudgetBytes || pcmBytes > pcmBudgetBytes - actual) {
          releaseBuffer(buffer);
          throw new ExportError("BUDGET_EXCEEDED", "Decoded audio assets exceed the 32 MiB PCM budget", { assetId, pcmBudgetBytes });
        }
        pcmBytes += actual;
        buffers.set(assetId, buffer);
        onProgress?.(Object.freeze({ phase: "preparing-audio", elapsedMs: 0, targetMs: compiled.durationMs,
          decodedAssets: buffers.size, totalAssets: referenced.size, decodedBytes: pcmBytes }));
      } finally { encoded = null; }
    }
    return Object.freeze({ buffers, decodedBytes: pcmBytes, release });
  } catch (error) {
    release();
    throw error;
  }
}
