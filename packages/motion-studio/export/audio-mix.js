import { EXPORT_LIMITS, ExportError } from "./export-plan.js";

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

function awaitAudioWork(work, timeoutMs, signal, code, message) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    const finish = callback => value => { cleanup(); callback(value); };
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
    if (!blob || typeof blob.arrayBuffer !== "function" || blob.size === 0) fail("ASSET_MISSING", `Local audio asset is unavailable: ${assetId}`);
    let buffer;
    try { buffer = await awaitAudioWork(audioContext.decodeAudioData(await blob.arrayBuffer()), decodeTimeoutMs,
      signal, "DECODE_FAILED", `Audio decode timed out for asset: ${assetId}`); }
    catch (error) { checkAbort(signal); fail("DECODE_FAILED", `Unable to decode audio asset: ${assetId}`, error); }
    checkAbort(signal);
    if (!buffer || !Number.isSafeInteger(buffer.length) || buffer.length < 1 ||
        !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
        !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8_000 || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      fail("DECODE_FAILED", `Decoded audio asset is invalid: ${assetId}`);
    }
    decodedBytes += audioBytes(buffer);
    if (decodedBytes > plan.pcmBudgetBytes) throw new ExportError("BUDGET_EXCEEDED", "Decoded audio assets exceed the PCM memory budget", { decodedBytes, pcmBudgetBytes: plan.pcmBudgetBytes });
    buffers.set(assetId, buffer);
    onProgress?.(Object.freeze({ phase: "preparing-audio", elapsedMs: 0, targetMs: plan.durationMs,
      renderedFrames: 0, droppedFrames: 0, decodedAssets: index + 1, totalAssets: assets.length, decodedBytes }));
  }

  checkAbort(signal);
  const destination = audioContext.createMediaStreamDestination();
  if (!destination?.stream || typeof destination.stream.getAudioTracks !== "function" || !destination.stream.getAudioTracks().length) {
    fail("CAPTURE_FAILED", "AudioContext did not provide a destination audio track");
  }
  const timeOrigin = audioContext.currentTime;
  const master = makeGain(audioContext, plan.audioMasterVolume, timeOrigin);
  const headroom = makeGain(audioContext, plan.headroomGain, timeOrigin);
  master.connect(headroom);
  headroom.connect(destination);
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
    buffers.clear();
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
