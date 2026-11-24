import { compileCinematicAudioProject } from "../../src/audio/cinematic-audio-core.js";

const CURVE_SAMPLES = 129;
const CURVE_TAU = Math.PI / 2;

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function audioBufferFor(buffers, assetId) {
  const buffer = buffers instanceof Map ? buffers.get(assetId) : buffers?.[assetId];
  if (!buffer || !Number.isSafeInteger(buffer.length) || buffer.length < 1 ||
      !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      !Number.isFinite(buffer.duration) || buffer.duration <= 0 || typeof buffer.getChannelData !== "function") {
    throw new TypeError(`Decoded audio buffer is unavailable or invalid: ${assetId}`);
  }
  return buffer;
}

function peakOf(buffer, cache) {
  if (cache.has(buffer)) return cache.get(buffer);
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]));
  }
  cache.set(buffer, peak);
  return peak;
}

function makeSceneIntervals(compiled) {
  let startMs = 0;
  return compiled.scenes.map((scene, sceneIndex) => {
    if (sceneIndex > 0) startMs = compiled.transitionIntervals[sceneIndex - 1].startMs;
    return Object.freeze({ sceneIndex, scene, startMs, endMs: startMs + scene.project.durationMs });
  });
}

function makeClipRecords(compiled, buffers) {
  const scenes = makeSceneIntervals(compiled);
  const records = [];
  const peakCache = new WeakMap();
  const peakEvents = [];
  for (const interval of scenes) {
    const audio = compileCinematicAudioProject({ durationMs: interval.scene.project.durationMs,
      tracks: interval.scene.audioTracks ?? [] });
    for (const track of audio.tracks) {
      for (const clip of track.clips) {
        if (clip.volume === 0 || track.volume === 0) continue;
        const buffer = audioBufferFor(buffers, clip.asset);
        const startMs = interval.startMs + clip.startMs;
        const endMs = Math.min(interval.endMs, interval.startMs + clip.endMs);
        if (endMs <= startMs) continue;
        const amplitudeBound = peakOf(buffer, peakCache) * clip.volume * track.volume;
        if (amplitudeBound > 0) {
          peakEvents.push([startMs, 1, amplitudeBound], [endMs, 0, -amplitudeBound]);
        }
        records.push(Object.freeze({ key: `${interval.scene.id}:${track.id}:${clip.id}`,
          sceneId: interval.scene.id, sceneIndex: interval.sceneIndex, trackId: track.id,
          trackType: track.type, clipId: clip.id, asset: clip.asset, buffer,
          localStartMs: clip.startMs, localEndMs: clip.endMs,
          startMs, endMs, volume: clip.volume, trackVolume: track.volume, loop: clip.loop }));
      }
    }
  }
  // A conservative absolute-peak bound protects against coherent overlapping clips.
  peakEvents.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // end events before starts at equal times
  let sum = 0, maximum = 0;
  for (const [, , delta] of peakEvents) { sum += delta; maximum = Math.max(maximum, sum); }
  return Object.freeze({ scenes: Object.freeze(scenes), clips: Object.freeze(records),
    peakBound: maximum, safeHeadroom: maximum > 1 ? 1 / maximum : 1 });
}

function setValue(param, value, at) {
  if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, at);
  else param.value = value;
}

function fadeGain(transition, side, timeMs) {
  const startMs = transition.startMs;
  const endMs = transition.endMs;
  const durationMs = transition.durationMs;
  if (transition.audioCrossfadeMs === 0) {
    const boundary = startMs + durationMs / 2;
    return side === "outgoing" ? (timeMs < boundary ? 1 : 0) : (timeMs < boundary ? 0 : 1);
  }
  const windowStart = startMs + (durationMs - transition.audioCrossfadeMs) / 2;
  const windowEnd = windowStart + transition.audioCrossfadeMs;
  if (timeMs <= windowStart) return side === "outgoing" ? 1 : 0;
  if (timeMs >= windowEnd) return side === "outgoing" ? 0 : 1;
  const p = (timeMs - windowStart) / transition.audioCrossfadeMs;
  return side === "outgoing" ? Math.cos(p * CURVE_TAU) : Math.sin(p * CURVE_TAU);
}

function gainAt(sampleStudioSequenceV2, compiled, sceneIndex, timeMs) {
  const sample = sampleStudioSequenceV2(compiled, timeMs);
  if (sample.kind === "scene") return sample.sceneIndex === sceneIndex ? 1 : 0;
  if (sample.outgoing.sceneIndex === sceneIndex) return sample.audioMix.outgoingGain;
  if (sample.incoming.sceneIndex === sceneIndex) return sample.audioMix.incomingGain;
  return 0;
}

function automateSceneGain(param, sampleStudioSequenceV2, compiled, sceneIndex, epoch, fromMs, toMs) {
  if (typeof param.cancelScheduledValues === "function") param.cancelScheduledValues(epoch);
  const intervals = compiled.transitionIntervals;
  const curveOwnsStart = intervals.some((transition, index) => {
    const side = index === sceneIndex || index + 1 === sceneIndex;
    if (!side || transition.audioCrossfadeMs <= 0) return false;
    const windowStart = transition.startMs + (transition.durationMs - transition.audioCrossfadeMs) / 2;
    return windowStart <= fromMs && fromMs < windowStart + transition.audioCrossfadeMs && fromMs < toMs;
  });
  // A value curve establishes its own initial value. Avoid scheduling a set event
  // at the exact same timestamp, which Web Audio treats as overlapping automation.
  if (!curveOwnsStart) setValue(param, gainAt(sampleStudioSequenceV2, compiled, sceneIndex, fromMs), epoch);
  for (let index = 0; index < intervals.length; index++) {
    const transition = intervals[index];
    const side = index === sceneIndex ? "outgoing" : index + 1 === sceneIndex ? "incoming" : null;
    if (!side || transition.durationMs <= 0) continue;
    if (transition.audioCrossfadeMs === 0) {
      const boundaryMs = transition.startMs + transition.durationMs / 2;
      if (boundaryMs > fromMs && boundaryMs <= toMs) {
        setValue(param, side === "outgoing" ? 0 : 1, epoch + (boundaryMs - fromMs) / 1000);
      }
      continue;
    }
    const windowStart = transition.startMs + (transition.durationMs - transition.audioCrossfadeMs) / 2;
    const windowEnd = windowStart + transition.audioCrossfadeMs;
    const startMs = Math.max(windowStart, fromMs);
    const endMs = Math.min(windowEnd, toMs);
    if (endMs <= startMs) continue;
    const curve = new Float32Array(CURVE_SAMPLES);
    for (let point = 0; point < CURVE_SAMPLES; point++) {
      const timeMs = startMs + (endMs - startMs) * point / (CURVE_SAMPLES - 1);
      curve[point] = fadeGain(transition, side, timeMs);
    }
    const startAt = epoch + (startMs - fromMs) / 1000;
    const duration = (endMs - startMs) / 1000;
    if (typeof param.setValueCurveAtTime === "function") {
      param.setValueCurveAtTime(curve, startAt, duration);
    } else if (typeof param.linearRampToValueAtTime === "function") {
      setValue(param, curve[0], startAt);
      for (let point = 1; point < curve.length; point++) {
        param.linearRampToValueAtTime(curve[point], startAt + duration * point / (curve.length - 1));
      }
    } else {
      setValue(param, gainAt(sampleStudioSequenceV2, compiled, sceneIndex, startMs), startAt);
      setValue(param, gainAt(sampleStudioSequenceV2, compiled, sceneIndex, endMs), startAt + duration);
    }
  }
}

/**
 * Create an audio graph for a compiled StudioSequenceV2 using the caller's shared AudioContext.
 * Clip timestamps stay scene-local in StudioSequenceV2; this mixer adds each scene's project
 * offset once when scheduling sources. Pass decoded AudioBuffers keyed by asset id.
 */
/** Inject the V2 sampler at the package boundary, keeping the audio core acyclic. */
export function createStudioSequenceAudioCrossfadeCore({ sampleStudioSequenceV2 } = {}) {
  if (typeof sampleStudioSequenceV2 !== "function") {
    throw new TypeError("Studio sequence audio requires the StudioSequenceV2 sampler");
  }
  return function createStudioSequenceAudioCrossfadeEngine(compiled, {
  audioContext, audioBuffers, destination = audioContext?.destination, masterVolume = 1, signal
} = {}) {
  if (!compiled || compiled.kind !== "compiled-studio-sequence-v2" || !Array.isArray(compiled.scenes) ||
      !Array.isArray(compiled.transitionIntervals)) throw new TypeError("A compiled StudioSequenceV2 is required");
  if (!audioContext || typeof audioContext.createGain !== "function" ||
      typeof audioContext.createBufferSource !== "function" || !destination?.connect) {
    throw new TypeError("A shared AudioContext and output node are required");
  }
  requireFinite(masterVolume, "Master volume");
  if (masterVolume < 0 || masterVolume > 1) throw new RangeError("Master volume must be between 0 and 1");
  if (signal?.aborted) throw signal.reason ?? new DOMException("Audio setup was cancelled", "AbortError");
  const { scenes, clips, peakBound, safeHeadroom } = makeClipRecords(compiled, audioBuffers);
  let master, headroom;
  try {
    master = audioContext.createGain();
    headroom = audioContext.createGain();
    setValue(master.gain, masterVolume, audioContext.currentTime);
    setValue(headroom.gain, safeHeadroom, audioContext.currentTime);
    master.connect(headroom);
    headroom.connect(destination);
  } catch (cause) {
    try { master?.disconnect(); } catch {}
    try { headroom?.disconnect(); } catch {}
    throw cause;
  }
  const sessions = new Set();
  let disposed = false;

  function stopSession(session) {
    if (session.stopped) return;
    session.stopped = true;
    for (const source of session.sources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { source.buffer = null; } catch {}
    }
    for (const node of session.nodes) { try { node.disconnect(); } catch {} }
    session.sources.clear();
    session.nodes.clear();
    sessions.delete(session);
  }

  function stop() { for (const session of [...sessions]) stopSession(session); }

  function schedule({ epoch = audioContext.currentTime + 0.05, fromMs = 0, toMs = compiled.durationMs } = {}) {
    if (disposed) throw new Error("Studio sequence audio engine has been disposed");
    requireFinite(epoch, "Audio epoch");
    requireFinite(fromMs, "Project start time");
    requireFinite(toMs, "Project end time");
    if (epoch < audioContext.currentTime || !Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) ||
        fromMs < 0 || toMs > compiled.durationMs || toMs <= fromMs) {
      throw new RangeError("Audio schedule requires a future epoch and a non-empty project time range");
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException("Audio scheduling was cancelled", "AbortError");
    // Re-scheduling is the deterministic seek/replay path; retire the previous
    // transport first so an accidental repeated Play cannot double the mix.
    stop();
    const session = { sources: new Set(), nodes: new Set(), scheduled: [], stopped: false };
    sessions.add(session);
    const sceneNodes = new Map();
    const trackNodes = new Map();
    try {
      for (const scene of scenes) {
        const node = audioContext.createGain();
        session.nodes.add(node);
        node.connect(master);
        automateSceneGain(node.gain, sampleStudioSequenceV2, compiled, scene.sceneIndex, epoch, fromMs, toMs);
        sceneNodes.set(scene.sceneIndex, node);
      }
      for (const clip of clips) {
        const startMs = Math.max(clip.startMs, fromMs);
        const endMs = Math.min(clip.endMs, toMs);
        if (endMs <= startMs) continue;
        const offsetMs = clip.localStartMs + (startMs - clip.startMs);
        const offset = offsetMs / 1000;
        if (!clip.loop && offset >= clip.buffer.duration) continue;
        const routeKey = `${clip.sceneIndex}:${clip.trackId}`;
        let trackNode = trackNodes.get(routeKey);
        if (!trackNode) {
          trackNode = audioContext.createGain();
          session.nodes.add(trackNode);
          setValue(trackNode.gain, clip.trackVolume, epoch);
          trackNode.connect(sceneNodes.get(clip.sceneIndex));
          trackNodes.set(routeKey, trackNode);
        }
        const clipNode = audioContext.createGain();
        session.nodes.add(clipNode);
        setValue(clipNode.gain, clip.volume, epoch);
        clipNode.connect(trackNode);
        const source = audioContext.createBufferSource();
        source.buffer = clip.buffer;
        source.loop = clip.loop && clip.trackType === "music";
        source.connect(clipNode);
        const when = epoch + (startMs - fromMs) / 1000;
        const endAt = epoch + (endMs - fromMs) / 1000;
        const sourceOffset = source.loop ? offset % clip.buffer.duration : offset;
        source.start(when, sourceOffset);
        source.stop(endAt);
        session.sources.add(source);
        source.onended = () => {
          session.sources.delete(source);
          try { source.disconnect(); } catch {}
          try { clipNode.disconnect(); } catch {}
          session.nodes.delete(clipNode);
        };
        session.scheduled.push(Object.freeze({ sceneId: clip.sceneId, trackId: clip.trackId, clipId: clip.clipId,
          asset: clip.asset, localStartMs: clip.localStartMs, globalStartMs: clip.startMs,
          when, endAt, offset: sourceOffset, loop: source.loop, gain: clip.volume * clip.trackVolume * masterVolume * safeHeadroom }));
      }
      return Object.freeze({ scheduled: Object.freeze(session.scheduled), stop: () => stopSession(session),
        get stopped() { return session.stopped; } });
    } catch (cause) {
      stopSession(session);
      throw cause;
    }
  }

  function sample(timeMs) {
    if (disposed) throw new Error("Studio sequence audio engine has been disposed");
    const sample = sampleStudioSequenceV2(compiled, timeMs);
    if (sample.kind === "scene") return Object.freeze({ timeMs: sample.sequenceTimeMs,
      gains: Object.freeze([{ sceneId: sample.sceneId, gain: 1 }]) });
    return Object.freeze({ timeMs: sample.sequenceTimeMs, gains: Object.freeze([
      Object.freeze({ sceneId: sample.outgoing.sceneId, gain: sample.audioMix.outgoingGain }),
      Object.freeze({ sceneId: sample.incoming.sceneId, gain: sample.audioMix.incomingGain })
    ]) });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", onAbort);
    stop();
    try { master.disconnect(); } catch {}
    try { headroom.disconnect(); } catch {}
  }
  function onAbort() { dispose(); }
  signal?.addEventListener("abort", onAbort, { once: true });

  return Object.freeze({ schedule, sample, stop, dispose,
    diagnostics: Object.freeze({ sceneCount: scenes.length, clipCount: clips.length, peakBound, safeHeadroom }) });
  };
}
