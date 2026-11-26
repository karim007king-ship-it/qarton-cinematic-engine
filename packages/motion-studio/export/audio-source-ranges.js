const DEFAULT_AUDIO_CHANNELS = 2;
const DEFAULT_AUDIO_SAMPLE_RATE = 48_000;
const FLOAT32_BYTES = 4;

/**
 * Plan the source-time spans needed by clips that overlap the requested export.
 * AudioBuffer decoding still decodes one complete compressed asset at a time;
 * callers must account for that temporary buffer before retaining a cropped copy.
 */
export function collectAudioSourceRanges(clips, audioInfo, {
  range = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER }, masterVolume = 1
} = {}) {
  if (!Array.isArray(clips) || !Array.isArray(audioInfo)) throw new TypeError("Audio range planning requires clips and asset metadata");
  if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.startMs < 0 || range.endMs <= range.startMs) {
    throw new TypeError("Audio range planning requires a non-empty finite range");
  }
  if (!Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 1) throw new TypeError("Audio master volume must be in [0, 1]");
  if (masterVolume === 0) return new Map();

  const metadata = new Map(audioInfo.map(item => [item.id, item]));
  const ranges = new Map();
  for (const clip of clips) {
    if (!clip || typeof clip.asset !== "string" || clip.volume <= 0 || clip.trackVolume <= 0) continue;
    const activeStartMs = Math.max(clip.startMs, range.startMs);
    const activeEndMs = Math.min(clip.endMs, range.endMs);
    if (!(activeEndMs > activeStartMs)) continue;
    const info = metadata.get(clip.asset);
    if (!info || !Number.isFinite(info.durationMs) || info.durationMs <= 0) {
      throw new TypeError(`Audio memory metadata is unavailable: ${clip.asset}`);
    }
    const sourceStartMs = Math.max(0, (clip.offsetMs ?? 0) + activeStartMs - clip.startMs);
    const sourceEndMs = sourceStartMs + activeEndMs - activeStartMs;
    const assetDurationMs = info.durationMs;
    const loops = clip.loop === true && (clip.type ?? clip.trackType) === "music";
    const wraps = loops && (sourceStartMs >= assetDurationMs || sourceEndMs > assetDurationMs);
    let startMs = wraps ? 0 : Math.min(sourceStartMs, assetDurationMs);
    let endMs = wraps ? assetDurationMs : Math.min(sourceEndMs, assetDurationMs);
    if (endMs <= startMs) continue;
    const previous = ranges.get(clip.asset);
    if (!previous) ranges.set(clip.asset, { id: clip.asset, startMs, endMs,
      durationMs: assetDurationMs, full: wraps || (startMs === 0 && endMs >= assetDurationMs) });
    else {
      previous.startMs = Math.min(previous.startMs, startMs);
      previous.endMs = Math.max(previous.endMs, endMs);
      previous.full ||= wraps || (previous.startMs === 0 && previous.endMs >= assetDurationMs);
    }
  }
  for (const item of ranges.values()) {
    if (item.full) { item.startMs = 0; item.endMs = item.durationMs; }
    Object.freeze(item);
  }
  return ranges;
}

export function audioRangePcmBytes(info, sourceRange) {
  const startMs = sourceRange?.full ? 0 : sourceRange?.startMs;
  const endMs = sourceRange?.full ? info?.durationMs : sourceRange?.endMs;
  const channels = info?.channels ?? DEFAULT_AUDIO_CHANNELS;
  const sampleRate = info?.sampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs ||
      !Number.isSafeInteger(channels) || channels < 1 || !Number.isSafeInteger(sampleRate) || sampleRate < 1) {
    throw new TypeError("Audio source range metadata is invalid");
  }
  const bytes = Math.ceil((endMs - startMs) / 1000 * channels * sampleRate * FLOAT32_BYTES);
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError("Audio source range exceeds safe integer limits");
  return bytes;
}

export function measureAudioBufferRange(sourceBuffer, sourceRange) {
  if (!sourceBuffer || !Number.isSafeInteger(sourceBuffer.length) || !Number.isSafeInteger(sourceBuffer.numberOfChannels)) {
    throw new TypeError("A valid decoded AudioBuffer is required");
  }
  const sampleRate = Number.isSafeInteger(sourceBuffer.sampleRate) && sourceBuffer.sampleRate > 0
    ? sourceBuffer.sampleRate : Math.round(sourceBuffer.length / sourceBuffer.duration);
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) throw new TypeError("Decoded audio sample rate is invalid");
  if (typeof sourceBuffer.getChannelData !== "function") {
    const bytes = sourceBuffer.length * sourceBuffer.numberOfChannels * FLOAT32_BYTES;
    return Object.freeze({ startFrame: 0, endFrame: sourceBuffer.length, sampleRate,
      startOffsetSeconds: 0, full: true, bytes, sourceDurationSeconds: sourceBuffer.duration });
  }
  const startFrame = sourceRange.full ? 0 : Math.max(0, Math.min(sourceBuffer.length,
    Math.floor(sourceRange.startMs / 1000 * sampleRate)));
  const endFrame = sourceRange.full ? sourceBuffer.length : Math.max(startFrame, Math.min(sourceBuffer.length,
    Math.ceil(sourceRange.endMs / 1000 * sampleRate)));
  const length = endFrame - startFrame;
  if (!length) throw new RangeError(`Audio source range contains no samples: ${sourceRange.id}`);
  const bytes = length * sourceBuffer.numberOfChannels * FLOAT32_BYTES;
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError(`Cropped audio exceeds safe integer limits: ${sourceRange.id}`);
  const full = startFrame === 0 && endFrame === sourceBuffer.length;
  return Object.freeze({ startFrame, endFrame, sampleRate, startOffsetSeconds: startFrame / sampleRate,
    full, bytes, sourceDurationSeconds: sourceBuffer.duration });
}

/** Copy only the planned source window; the caller must release the decoded buffer. */
export function cropAudioBuffer(audioContext, sourceBuffer, sourceRange, measurement = measureAudioBufferRange(sourceBuffer, sourceRange)) {
  if (!audioContext || typeof audioContext.createBuffer !== "function") {
    // Minimal host shims may not expose AudioContext.createBuffer. Preserve the
    // source only when its full PCM footprint has already been accounted for.
    const bytes = sourceBuffer.length * sourceBuffer.numberOfChannels * FLOAT32_BYTES;
    return Object.freeze({ buffer: sourceBuffer, startOffsetSeconds: 0, full: true,
      sourceDurationSeconds: sourceBuffer.duration, bytes });
  }
  if (measurement.full) return Object.freeze({ buffer: sourceBuffer, ...measurement });
  const { startFrame, endFrame, bytes } = measurement;
  const length = endFrame - startFrame;
  const cropped = audioContext.createBuffer(sourceBuffer.numberOfChannels, length, measurement.sampleRate);
  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const samples = sourceBuffer.getChannelData(channel).subarray(startFrame, endFrame);
    if (typeof cropped.copyToChannel === "function") cropped.copyToChannel(samples, channel);
    else cropped.getChannelData(channel).set(samples);
  }
  return Object.freeze({ buffer: cropped, startOffsetSeconds: startFrame / sourceBuffer.sampleRate,
    full: false, sourceDurationSeconds: sourceBuffer.duration, bytes });
}
