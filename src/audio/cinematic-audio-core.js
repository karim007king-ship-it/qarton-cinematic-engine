import { createTimeline } from "../motion/timeline.js";
import { createSceneClock } from "../motion/scene-clock.js";

const TRACK_TYPES = new Set(["dialogue", "music", "sfx"]);
const LANGUAGES = new Set(["ar", "tn"]);
const VISEMES = new Set(["rest", "open", "wide", "round", "closed", "teeth"]);
const MAX_DURATION_MS = 300_000;
const MAX_TRACKS = 32;
const MAX_CLIPS = 512;
const MAX_TOTAL_VISEMES = 16_384;
const MAX_VISEMES_PER_CLIP = 4096;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function volume(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} volume must be between 0 and 1`);
  }
  return value;
}

/**
 * Validate and compile scene-relative dialogue, music, SFX and prepared mouth cues.
 * Dialogue visemes are authored relative to each dialogue clip; this API does
 * not perform speech recognition or infer phonemes from audio.
 */
export function compileCinematicAudioProject({ durationMs, tracks = [] } = {}) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) {
    throw new RangeError(`Audio scene duration must be an integer in [1, ${MAX_DURATION_MS}]`);
  }
  if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS) {
    throw new TypeError(`Audio tracks must be an array of at most ${MAX_TRACKS} entries`);
  }
  const trackIds = new Set();
  const clipIds = new Set();
  let clipCount = 0;
  let visemeCount = 0;
  const normalized = tracks.map((track, trackIndex) => {
    if (!object(track) || typeof track.id !== "string" || !track.id.trim() || trackIds.has(track.id)) {
      throw new TypeError(`Audio track ${trackIndex} requires a unique id`);
    }
    if (!TRACK_TYPES.has(track.type)) throw new TypeError(`Audio track "${track.id}" has an unsupported type`);
    if (!Array.isArray(track.clips)) throw new TypeError(`Audio track "${track.id}" clips must be an array`);
    const trackVolume = volume(track.volume ?? 1, `Audio track "${track.id}"`);
    trackIds.add(track.id);
    const clips = track.clips.map((clip, clipIndex) => {
      clipCount += 1;
      if (clipCount > MAX_CLIPS) throw new TypeError(`Audio project supports at most ${MAX_CLIPS} clips`);
      if (!object(clip) || typeof clip.id !== "string" || !clip.id.trim() || clipIds.has(clip.id)) {
        throw new TypeError(`Audio clip ${clipIndex} in "${track.id}" requires a unique id`);
      }
      if (typeof clip.asset !== "string" || !clip.asset.trim()) {
        throw new TypeError(`Audio clip "${clip.id}" requires an asset key`);
      }
      if (!Number.isSafeInteger(clip.startMs) || clip.startMs < 0 || clip.startMs >= durationMs ||
          !Number.isSafeInteger(clip.durationMs) || clip.durationMs < 1 || clip.startMs + clip.durationMs > durationMs) {
        throw new RangeError(`Audio clip "${clip.id}" must fit inside the scene duration`);
      }
      const clipVolume = volume(clip.volume ?? 1, `Audio clip "${clip.id}"`);
      const loop = clip.loop === true;
      if (loop && track.type !== "music") throw new TypeError(`Only music clips may loop ("${clip.id}")`);
      let language = null;
      let visemes = Object.freeze([]);
      if (track.type === "dialogue") {
        if (!LANGUAGES.has(clip.language)) {
          throw new TypeError(`Dialogue clip "${clip.id}" language must be "ar" or "tn"`);
        }
        language = clip.language;
        if (clip.visemes !== undefined && (!Array.isArray(clip.visemes) || clip.visemes.length > MAX_VISEMES_PER_CLIP)) {
          throw new TypeError(`Dialogue clip "${clip.id}" visemes must be an array of at most ${MAX_VISEMES_PER_CLIP} cues`);
        }
        visemeCount += clip.visemes?.length ?? 0;
        if (visemeCount > MAX_TOTAL_VISEMES) {
          throw new TypeError(`Audio project supports at most ${MAX_TOTAL_VISEMES} prepared viseme cues`);
        }
        const times = new Set();
        const events = (clip.visemes ?? []).map((cue, cueIndex) => {
          if (!object(cue) || !Number.isSafeInteger(cue.atMs) || cue.atMs < 0 || cue.atMs >= clip.durationMs ||
              typeof cue.viseme !== "string" || !VISEMES.has(cue.viseme)) {
            throw new TypeError(`Dialogue clip "${clip.id}" has invalid viseme ${cueIndex}`);
          }
          if (times.has(cue.atMs)) throw new RangeError(`Dialogue clip "${clip.id}" has duplicate viseme time ${cue.atMs}`);
          if (cue.phoneme !== undefined && (typeof cue.phoneme !== "string" || !cue.phoneme.trim() || cue.phoneme.length > 24)) {
            throw new TypeError(`Dialogue clip "${clip.id}" has an invalid phoneme label`);
          }
          times.add(cue.atMs);
          return Object.freeze({ atMs: cue.atMs, viseme: cue.viseme, phoneme: cue.phoneme?.trim() ?? null });
        }).sort((a, b) => a.atMs - b.atMs);
        visemes = Object.freeze(events);
      } else if (clip.language !== undefined || clip.visemes !== undefined) {
        throw new TypeError(`Only dialogue clips may declare language or visemes ("${clip.id}")`);
      }
      clipIds.add(clip.id);
      return Object.freeze({
        id: clip.id, asset: clip.asset.trim(), startMs: clip.startMs, durationMs: clip.durationMs,
        endMs: clip.startMs + clip.durationMs, volume: clipVolume, loop, language, visemes,
        trackId: track.id, type: track.type, trackVolume
      });
    }).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    return Object.freeze({ id: track.id, type: track.type, volume: trackVolume, clips: Object.freeze(clips) });
  });

  const clips = Object.freeze(normalized.flatMap(track => track.clips));
  const timeline = createTimeline(clips.flatMap(clip => [
    { id: `${clip.id}:start`, atMs: clip.startMs, type: "audio-start", target: clip.id },
    { id: `${clip.id}:end`, atMs: clip.endMs, type: "audio-end", target: clip.id },
    ...clip.visemes.map((cue, index) => ({
      id: `${clip.id}:viseme:${index}`, atMs: clip.startMs + cue.atMs,
      type: "dialogue-viseme", target: clip.id, payload: cue
    }))
  ]));

  function lastEventAt(timeMs) {
    let low = 0;
    let high = timeline.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timeline.events[middle].atMs <= timeMs) low = middle + 1;
      else high = middle;
    }
    return timeline.events[low - 1] ?? null;
  }

  function sample(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > durationMs) {
      throw new RangeError(`Audio sample time must be in [0, ${durationMs}]`);
    }
    const active = clips.filter(clip => clip.startMs <= timeMs && timeMs < clip.endMs);
    const dialogue = active.filter(clip => clip.type === "dialogue").map(clip => {
      const elapsedMs = timeMs - clip.startMs;
      let cue = null;
      for (const item of clip.visemes) {
        if (item.atMs > elapsedMs) break;
        cue = item;
      }
      const viseme = cue?.viseme ?? "rest";
      return Object.freeze({
        clipId: clip.id, trackId: clip.trackId, language: clip.language,
        phoneme: cue?.phoneme ?? null, viseme, mouthOpen: viseme === "open" || viseme === "wide" || viseme === "teeth"
          ? 1 : viseme === "round" ? 0.65 : 0
      });
    });
    return Object.freeze({
      timeMs,
      activeClips: Object.freeze(active.map(({ id, trackId, type, asset, startMs, endMs, loop }) =>
        Object.freeze({ id, trackId, type, asset, startMs, endMs, loop }))),
      dialogue: Object.freeze(dialogue),
      lastTimelineEvent: lastEventAt(timeMs)
    });
  }

  return Object.freeze({ durationMs, tracks: Object.freeze(normalized), clips, timeline, sample });
}

/** Scene-clock transport. Adapters own decoding and platform audio resources. */
export function createCinematicAudioPlayer(project, {
  play, stop = () => {}, setVolume = () => {}, masterVolume = 1,
  now = () => performance.now()
} = {}) {
  if (!project || typeof project.sample !== "function" || !Number.isFinite(project.durationMs)) {
    throw new TypeError("A compiled cinematic audio project is required");
  }
  if (typeof play !== "function" || typeof stop !== "function" || typeof setVolume !== "function") {
    throw new TypeError("Audio play, stop and setVolume adapters must be functions");
  }
  volume(masterVolume, "Master");
  const clock = createSceneClock({ durationMs: project.durationMs, now });
  let master = masterVolume;
  let state = "paused";
  let destroyed = false;
  let destroying = false;
  let lastStableTime = 0;
  let recoveryState = "paused";
  let lastError = null;
  const trackVolumes = new Map(project.tracks.map(track => [track.id, track.volume]));
  const voices = new Map();

  function assertAlive() {
    if (destroyed || destroying) throw new Error("Cinematic audio player has been destroyed");
  }
  function effectiveVolume(clip) {
    return master * trackVolumes.get(clip.trackId) * clip.volume;
  }
  function stopVoice(id) {
    const voice = voices.get(id);
    if (voice === undefined) return;
    stop(voice);
    voices.delete(id);
  }
  function stopVoices() {
    const errors = [];
    for (const id of [...voices.keys()]) {
      try { stopVoice(id); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "One or more audio voices could not be stopped");
  }
  function reconcile(timeMs, restart = false) {
    const active = project.clips.filter(clip => clip.startMs <= timeMs && timeMs < clip.endMs);
    const activeIds = new Set(active.map(clip => clip.id));
    for (const id of [...voices.keys()]) {
      if (restart || !activeIds.has(id)) stopVoice(id);
    }
    for (const clip of active) {
      if (voices.has(clip.id)) continue;
      const voice = play(clip.asset, Object.freeze({
        id: clip.id, trackId: clip.trackId, channel: clip.type, type: clip.type,
        loop: clip.loop, offsetMs: timeMs - clip.startMs, volume: effectiveVolume(clip)
      }));
      if (voice == null || (typeof voice === "object" && typeof voice.then === "function")) {
        throw new TypeError(`Audio adapter play() must return a synchronous voice handle for "${clip.id}"`);
      }
      voices.set(clip.id, voice);
    }
  }
  function currentTime() { return clock.time(); }
  function sample(timeMs = currentTime()) { assertAlive(); return project.sample(timeMs); }
  function rollback(timeMs, previousState, cause) {
    clock.pause();
    clock.seek(timeMs);
    lastStableTime = timeMs;
    recoveryState = previousState === "ended" ? "ended" : "paused";
    let cleanupError = null;
    try { stopVoices(); } catch (error) { cleanupError = error; }
    state = voices.size ? "error" : recoveryState;
    lastError = cleanupError ? new AggregateError([cause, cleanupError], "Audio operation failed and cleanup is incomplete") : cause;
    if (cleanupError) throw lastError;
    throw cause;
  }
  function playFrom(timeMs, rollbackTime = lastStableTime, previousState = state) {
    const target = Math.max(0, Math.min(project.durationMs, timeMs));
    clock.pause();
    try {
      stopVoices();
      reconcile(target, true);
      clock.seek(target);
      clock.resume();
      state = "playing";
      lastStableTime = target;
      recoveryState = "paused";
      lastError = null;
      return sample(target);
    } catch (error) {
      return rollback(rollbackTime, previousState, error);
    }
  }
  function playNow() {
    assertAlive();
    if (state === "error") throw new Error("Audio adapter failed; call recover() before playback");
    if (state === "playing") return sample();
    if (state === "ended") return playFrom(0, lastStableTime, state);
    return playFrom(lastStableTime, lastStableTime, state);
  }
  function pause() {
    assertAlive();
    if (state === "error") throw new Error("Audio adapter failed; call recover() before pausing");
    if (state !== "playing") return sample();
    const timeMs = clock.pause();
    try {
      stopVoices();
      state = timeMs >= project.durationMs ? "ended" : "paused";
      lastStableTime = timeMs;
      recoveryState = state;
      lastError = null;
      return sample(timeMs);
    } catch (error) {
      return rollback(timeMs, timeMs >= project.durationMs ? "ended" : "paused", error);
    }
  }
  function seek(timeMs) {
    assertAlive();
    if (state === "error") throw new Error("Audio adapter failed; call recover() before seeking");
    if (!Number.isFinite(timeMs)) throw new TypeError("Seek time must be finite");
    const wasPlaying = state === "playing";
    const previousTime = wasPlaying ? clock.time() : lastStableTime;
    const previousState = state;
    const time = Math.max(0, Math.min(project.durationMs, timeMs));
    if (wasPlaying && time < project.durationMs) return playFrom(time, previousTime, previousState);
    clock.pause();
    try {
      stopVoices();
      clock.seek(time);
      lastStableTime = time;
      state = time >= project.durationMs ? "ended" : "paused";
      recoveryState = state;
      lastError = null;
      return sample(time);
    } catch (error) {
      return rollback(previousTime, previousState, error);
    }
  }
  function tick() {
    assertAlive();
    if (state === "error") return sample(lastStableTime);
    if (state !== "playing") return sample();
    const previousTime = lastStableTime;
    const timeMs = currentTime();
    try {
      reconcile(timeMs);
      if (timeMs >= project.durationMs) {
        clock.pause();
        stopVoices();
        state = "ended";
        lastStableTime = project.durationMs;
        recoveryState = "ended";
      }
      else lastStableTime = timeMs;
      lastError = null;
    } catch (error) {
      return rollback(previousTime, "playing", error);
    }
    return sample(timeMs);
  }
  function setMasterVolume(next) {
    assertAlive(); volume(next, "Master"); master = next;
    for (const clip of project.clips) if (voices.has(clip.id)) setVolume(voices.get(clip.id), effectiveVolume(clip));
    return master;
  }
  function setTrackVolume(trackId, next) {
    assertAlive();
    if (!trackVolumes.has(trackId)) throw new TypeError(`Unknown audio track "${trackId}"`);
    volume(next, `Audio track "${trackId}"`); trackVolumes.set(trackId, next);
    for (const clip of project.clips) if (clip.trackId === trackId && voices.has(clip.id)) {
      setVolume(voices.get(clip.id), effectiveVolume(clip));
    }
    return next;
  }
  function replay() {
    assertAlive();
    if (state === "error") throw new Error("Audio adapter failed; call recover() before replay");
    const previousTime = state === "playing" ? clock.time() : lastStableTime;
    return playFrom(0, previousTime, state);
  }
  function recover() {
    assertAlive();
    if (state !== "error") return sample(lastStableTime);
    clock.pause();
    clock.seek(lastStableTime);
    try {
      stopVoices();
      state = recoveryState;
      lastError = null;
      return sample(lastStableTime);
    } catch (error) {
      lastError = error;
      throw error;
    }
  }
  function destroy() {
    if (destroyed) return false;
    if (state === "playing") lastStableTime = clock.time();
    clock.pause();
    clock.seek(lastStableTime);
    state = "destroying";
    destroying = true;
    stopVoices();
    destroyed = true;
    destroying = false;
    state = "destroyed";
    return true;
  }

  return Object.freeze({
    play: playNow, pause, resume: playNow, seek, replay, tick, sample, recover,
    setMasterVolume, setTrackVolume, destroy,
    get timeMs() { assertAlive(); return currentTime(); },
    get state() { return state; },
    get activeVoiceCount() { return voices.size; },
    get error() { return lastError; }
  });
}
