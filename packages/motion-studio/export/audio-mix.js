import { EXPORT_LIMITS, ExportError } from "./export-plan.js";

const MAX_COMPRESSED_AUDIO_BYTES = 20 * 1024 * 1024;

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The export was cancelled", "AbortError");
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function fail(code, message, cause) {
  const error = new ExportError(code, message);
  if (cause !== undefined) error.cause = cause;
  throw error;
}

function awaitAudioWork(work, timeoutMs, signal, code, message, discardLateValue) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    const finish = callback => value => {
      if (settled) {
        if (callback === resolve) { try { discardLateValue?.(value); } catch {} }
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const aborted = () => finish(reject)(abortError(signal));
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    timer = setTimeout(() => finish(reject)(new ExportError(code, message)), timeoutMs);
    Promise.resolve(work).then(finish(resolve), finish(reject));
  });
}

function audioBytes(buffer) {
  return buffer.length * buffer.numberOfChannels * EXPORT_LIMITS.audioBytesPerSample;
}

function releaseAudioBuffer(buffer) {
  if (!buffer || typeof buffer.getChannelData !== "function") return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    try { buffer.getChannelData(channel).fill(0); } catch {}
  }
}

function releaseBuffers(buffers) {
  for (const buffer of buffers.values()) releaseAudioBuffer(buffer);
  buffers.clear();
}

function estimatePcmBytes(info) {
  return Math.ceil(info.durationMs / 1000 * (info.channels ?? EXPORT_LIMITS.audioChannels) *
    (info.sampleRate ?? EXPORT_LIMITS.audioSampleRate) * EXPORT_LIMITS.audioBytesPerSample);
}

function setGain(param, value, atTime) {
  if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, atTime);
  else param.value = value;
}

function rampClipGain(param, gain, startAt, endAt) {
  if (typeof param.setValueAtTime !== "function" || typeof param.linearRampToValueAtTime !== "function") {
    param.value = gain;
    return;
  }
  const fadeMs = Math.min(5, (endAt - startAt) * 500);
  const fadeSeconds = fadeMs / 1000;
  param.setValueAtTime(0, startAt);
  param.linearRampToValueAtTime(gain, startAt + fadeSeconds);
  param.setValueAtTime(gain, endAt - fadeSeconds);
  param.linearRampToValueAtTime(0, endAt);
}

function makeGain(context, value, atTime) {
  const node = context.createGain();
  setGain(node.gain, value, atTime);
  return node;
}

/** Decode each unique local asset once, then schedule every clip against the recorder's shared epoch. */
export async function prepareAudioMix(plan, { audioContext, resolveAudio } = {}, { signal, onProgress, decodeTimeoutMs = 30_000 } = {}) {
  if (!plan || plan.audio !== "mix") return Object.freeze({ stream: null, schedule: () => {}, stop: () => {}, decodedBytes: 0 });
  if (!audioContext || typeof audioContext.decodeAudioData !== "function" ||
      typeof audioContext.createMediaStreamDestination !== "function" || typeof resolveAudio !== "function") {
    throw new TypeError("Audio export requires an AudioContext and resolveAudio(assetId, signal)");
  }
  checkAbort(signal);
  if (audioContext.state !== "running") fail("CAPTURE_FAILED", "AudioContext must be running before export preparation");

  const clips = plan.audioClips;
  const assets = [...new Set(clips.filter(clip => clip.volume > 0 && clip.trackVolume > 0 && plan.audioMasterVolume > 0).map(clip => clip.asset))];
  const buffers = new Map();
  let decodedBytes = 0;
  let compressedBytes = 0;
  const assetInfo = new Map((plan.snapshot?.audioAssetInfo ?? []).map(info => [info.id, info]));
  try {
    // Reserve the full declared PCM footprint before asking the browser to allocate decode output.
    // The actual AudioBuffer sizes are checked again below because file metadata can be stale.
    let expectedPcmBytes = 0;
    for (const assetId of assets) {
      const info = assetInfo.get(assetId);
      if (!info) fail("DECODE_FAILED", `Audio memory metadata is unavailable: ${assetId}`);
      expectedPcmBytes += estimatePcmBytes(info);
      if (!Number.isSafeInteger(expectedPcmBytes) || expectedPcmBytes > plan.pcmBudgetBytes) {
        throw new ExportError("BUDGET_EXCEEDED", "Expected decoded audio exceeds the PCM memory budget", {
          expectedPcmBytes, pcmBudgetBytes: plan.pcmBudgetBytes, assetId
        });
      }
    }

    for (let index = 0; index < assets.length; index++) {
      checkAbort(signal);
      const assetId = assets[index];
      let blob;
      try { blob = await resolveAudio(assetId, signal); }
      catch (error) {
        checkAbort(signal);
        fail("ASSET_MISSING", `Unable to resolve local audio asset: ${assetId}`, error);
      }
      checkAbort(signal);
      if (!blob || typeof blob.arrayBuffer !== "function" || !Number.isSafeInteger(blob.size) || blob.size <= 0) {
        fail("ASSET_MISSING", `Local audio asset is unavailable: ${assetId}`);
      }
      if (blob.size > MAX_COMPRESSED_AUDIO_BYTES || compressedBytes > MAX_COMPRESSED_AUDIO_BYTES - blob.size) {
        throw new ExportError("BUDGET_EXCEEDED", "Compressed audio assets exceed the 20 MiB input budget", {
          compressedBytes: compressedBytes + blob.size, compressedBudgetBytes: MAX_COMPRESSED_AUDIO_BYTES, assetId
        });
      }
      compressedBytes += blob.size;

      let encoded = null;
      let buffer = null;
      try {
        encoded = await awaitAudioWork(blob.arrayBuffer(), decodeTimeoutMs, signal, "DECODE_FAILED",
          `Reading audio asset timed out: ${assetId}`);
        checkAbort(signal);
        if (!(encoded instanceof ArrayBuffer) || encoded.byteLength !== blob.size) {
          fail("DECODE_FAILED", `Audio asset bytes are invalid: ${assetId}`);
        }
        buffer = await awaitAudioWork(audioContext.decodeAudioData(encoded), decodeTimeoutMs, signal, "DECODE_FAILED",
          `Audio decode timed out for asset: ${assetId}`, releaseAudioBuffer);
      } catch (error) {
        checkAbort(signal);
        fail("DECODE_FAILED", `Unable to decode audio asset: ${assetId}`, error);
      } finally {
        encoded = null;
      }

      try {
        checkAbort(signal);
        if (!buffer || !Number.isSafeInteger(buffer.length) || buffer.length < 1 ||
            !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
            !Number.isSafeInteger(buffer.sampleRate) || buffer.sampleRate < 8_000 ||
            !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
          fail("DECODE_FAILED", `Decoded audio asset is invalid: ${assetId}`);
        }
        const assetPcmBytes = audioBytes(buffer);
        if (!Number.isSafeInteger(assetPcmBytes) || assetPcmBytes < 1 || decodedBytes > plan.pcmBudgetBytes - assetPcmBytes) {
          const attemptedBytes = decodedBytes + assetPcmBytes;
          throw new ExportError("BUDGET_EXCEEDED", "Decoded audio assets exceed the PCM memory budget", {
            decodedBytes: attemptedBytes, pcmBudgetBytes: plan.pcmBudgetBytes, assetId
          });
        }
        decodedBytes += assetPcmBytes;
        buffers.set(assetId, buffer);
        buffer = null;
      } catch (error) {
        releaseAudioBuffer(buffer);
        throw error;
      }
      onProgress?.(Object.freeze({ phase: "preparing-audio", elapsedMs: 0, targetMs: plan.durationMs,
        renderedFrames: 0, droppedFrames: 0, decodedAssets: index + 1, totalAssets: assets.length, decodedBytes }));
    }
  } catch (error) {
    releaseBuffers(buffers);
    throw error;
  }

  checkAbort(signal);
  let destination;
  let master;
  let headroom;
  try {
    destination = audioContext.createMediaStreamDestination();
    if (!destination?.stream || typeof destination.stream.getAudioTracks !== "function" || !destination.stream.getAudioTracks().length) {
      fail("CAPTURE_FAILED", "AudioContext did not provide a destination audio track");
    }
    const timeOrigin = audioContext.currentTime;
    master = makeGain(audioContext, plan.audioMasterVolume, timeOrigin);
    headroom = makeGain(audioContext, plan.headroomGain, timeOrigin);
    master.connect(headroom);
    headroom.connect(destination);
  } catch (error) {
    try { master?.disconnect(); } catch {}
    try { headroom?.disconnect(); } catch {}
    try { destination?.disconnect?.(); } catch {}
    for (const track of destination?.stream?.getTracks?.() ?? []) { try { track.stop(); } catch {} }
    releaseBuffers(buffers);
    throw error;
  }
  const trackGains = new Map();
  const sources = new Set();
  const clipGains = new Set();
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const source of sources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { source.buffer = null; } catch {}
    }
    sources.clear();
    for (const node of trackGains.values()) { try { node.disconnect(); } catch {} }
    trackGains.clear();
    for (const node of clipGains) { try { node.disconnect(); } catch {} }
    clipGains.clear();
    try { master.disconnect(); } catch {}
    try { headroom.disconnect(); } catch {}
    try { destination.disconnect?.(); } catch {}
    for (const track of destination.stream.getTracks?.() ?? []) { try { track.stop(); } catch {} }
    releaseBuffers(buffers);
  }

  function schedule(epoch) {
    if (stopped) throw new Error("Audio mix has been stopped");
    if (!Number.isFinite(epoch) || epoch < audioContext.currentTime) throw new RangeError("Audio epoch must be a finite future AudioContext time");
    const scheduled = [];
    try {
      const zeroTime = Math.max(audioContext.currentTime, epoch);
      for (const clip of clips) {
        const buffer = buffers.get(clip.asset);
        if (!buffer || clip.startMs >= clip.endMs) continue;
        let trackGain = trackGains.get(clip.trackId);
        if (!trackGain) {
          trackGain = makeGain(audioContext, clip.trackVolume, zeroTime);
          trackGain.connect(master);
          trackGains.set(clip.trackId, trackGain);
        }
        const when = epoch + (clip.startMs - plan.range.startMs) / 1000;
        const endAt = epoch + (clip.endMs - plan.range.startMs) / 1000;
        if (endAt <= when) continue;
        const startOffset = clip.offsetMs / 1000;
        const shouldLoop = clip.loop === true && clip.type === "music";
        if (!shouldLoop && startOffset >= buffer.duration) continue;
        const source = audioContext.createBufferSource();
        const clipGain = makeGain(audioContext, 0, Math.max(zeroTime, when));
        rampClipGain(clipGain.gain, clip.volume, when, endAt);
        clipGains.add(clipGain);
        source.buffer = buffer;
        source.loop = shouldLoop;
        if (clip.type === "music" && clip.loop !== true) source.loop = false;
        source.connect(clipGain);
        clipGain.connect(trackGain);
        const offset = source.loop ? startOffset % buffer.duration : startOffset;
        sources.add(source);
        source.onended = () => { sources.delete(source); try { source.disconnect(); } catch {} try { clipGain.disconnect(); } catch {} clipGains.delete(clipGain); };
        source.start(when, offset);
        source.stop(endAt);
        scheduled.push(Object.freeze({ clipId: clip.id, when, endAt, offset, loop: source.loop,
          effectiveGain: clip.volume * clip.trackVolume * plan.audioMasterVolume * plan.headroomGain }));
      }
      return Object.freeze(scheduled);
    } catch (error) {
      for (const source of sources) { try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
      sources.clear();
      for (const node of clipGains) { try { node.disconnect(); } catch {} }
      clipGains.clear();
      throw error;
    }
  }

  return Object.freeze({ stream: destination.stream, schedule, stop, decodedBytes, assetCount: buffers.size });
}
