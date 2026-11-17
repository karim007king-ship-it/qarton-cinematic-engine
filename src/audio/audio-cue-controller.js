/**
 * Timeline-driven audio cue controller.
 * All audio playback is injected by the host (Web Audio, HTMLAudio, native,
 * or game engine). This module owns deterministic cue timing, not decoding.
 */
export function createAudioCueController({
  cues = [],
  play,
  stop = () => {},
  pauseVoice = () => {},
  resumeVoice = () => {},
  setVolume = () => {},
  masterVolume = 1
} = {}) {
  if (!Array.isArray(cues)) throw new TypeError("Audio cues must be an array");
  if (typeof play !== "function" || typeof stop !== "function" || typeof pauseVoice !== "function"
    || typeof resumeVoice !== "function" || typeof setVolume !== "function") {
    throw new TypeError("Audio play, stop, pause, resume and setVolume adapters must be functions");
  }
  if (!Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 1) {
    throw new TypeError("Master volume must be between 0 and 1");
  }

  const ids = new Set();
  const normalized = cues.map((cue, index) => {
    if (!cue || typeof cue !== "object" || typeof cue.id !== "string" || !cue.id.trim() || ids.has(cue.id)) {
      throw new TypeError(`Audio cue ${index} requires a unique id`);
    }
    if (!Number.isFinite(cue.atMs) || cue.atMs < 0 || typeof cue.asset !== "string" || !cue.asset.trim()) {
      throw new TypeError(`Audio cue "${cue.id}" requires non-negative atMs and an asset key`);
    }
    if (cue.volume !== undefined && (!Number.isFinite(cue.volume) || cue.volume < 0 || cue.volume > 1)) {
      throw new TypeError(`Audio cue "${cue.id}" volume must be between 0 and 1`);
    }
    ids.add(cue.id);
    return Object.freeze({
      id: cue.id, atMs: cue.atMs, asset: cue.asset,
      channel: typeof cue.channel === "string" ? cue.channel : "sfx",
      loop: cue.loop === true, volume: cue.volume ?? 1
    });
  }).sort((a, b) => a.atMs - b.atMs);

  let cursor = -1;
  let paused = false;
  let destroyed = false;
  let volume = masterVolume;
  const voices = new Map();
  const firedIds = new Set();

  function assertAlive() {
    if (destroyed) throw new Error("Audio cue controller has been destroyed");
  }

  function invokeForVoices(adapter, message) {
    const errors = [];
    for (const voice of voices.values()) {
      try { adapter(voice); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, message);
  }

  function update(timeMs) {
    assertAlive();
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs < cursor) {
      throw new TypeError("Audio timeline time must be finite, non-negative and monotonic");
    }
    if (paused) {
      for (const cue of normalized) if (cue.atMs <= timeMs) firedIds.add(cue.id);
      cursor = timeMs;
      return Object.freeze([]);
    }
    const fired = [];
    for (const cue of normalized) {
      if (firedIds.has(cue.id) || cue.atMs > timeMs) continue;
      let voice;
      let endedBeforeRegistration = false;
      const onEnded = () => {
        // A very short one-shot may finish before play() returns. Defer the
        // registry decision until its returned voice has been registered.
        if (voice === undefined) {
          endedBeforeRegistration = true;
          return;
        }
        if (voices.get(cue.id) === voice) voices.delete(cue.id);
      };
      voice = play(cue.asset, {
        id: cue.id, channel: cue.channel, loop: cue.loop, volume: cue.volume * volume,
        onEnded: cue.loop ? undefined : onEnded
      });
      if (voice != null && !endedBeforeRegistration) voices.set(cue.id, voice);
      firedIds.add(cue.id);
      fired.push(cue.id);
    }
    cursor = timeMs;
    return Object.freeze(fired);
  }

  function pause(timeMs = cursor) {
    assertAlive();
    if (timeMs !== cursor && (!Number.isFinite(timeMs) || timeMs < cursor)) {
      throw new TypeError("Pause time must be finite and not earlier than the audio cursor");
    }
    if (Number.isFinite(timeMs) && timeMs >= cursor) cursor = timeMs;
    // A previous pause may have failed for one or more voices. Keep the
    // controller paused, but retry every voice so a failed host pause can be
    // recovered without requiring an unrelated resume/pause cycle.
    if (paused) {
      invokeForVoices(pauseVoice, "One or more audio voices could not be paused");
      return;
    }
    paused = true;
    invokeForVoices(pauseVoice, "One or more audio voices could not be paused");
  }

  function resume(timeMs = cursor) {
    assertAlive();
    if (!Number.isFinite(timeMs) || timeMs < cursor) {
      throw new TypeError("Resume time must be finite and not earlier than the audio cursor");
    }
    invokeForVoices(resumeVoice, "One or more audio voices could not be resumed");
    // Advancing the cursor skips cues that elapsed while playback was paused.
    for (const cue of normalized) if (cue.atMs <= timeMs) firedIds.add(cue.id);
    cursor = timeMs;
    paused = false;
  }

  function setMasterVolume(nextVolume) {
    assertAlive();
    if (!Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Master volume must be between 0 and 1");
    }
    volume = nextVolume;
    for (const [id, voice] of voices) {
      const cue = normalized.find(item => item.id === id);
      if (voice != null) setVolume(voice, cue.volume * volume);
    }
    return volume;
  }

  function stopVoices() {
    const errors = [];
    for (const [id, voice] of voices) {
      try { stop(voice); voices.delete(id); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "One or more audio voices could not be stopped");
  }

  function stopAll({ reset = false } = {}) {
    assertAlive();
    paused = false;
    stopVoices();
    if (reset) { cursor = -1; firedIds.clear(); }
  }

  function destroy() {
    destroyed = true;
    stopVoices();
  }

  return Object.freeze({
    update, pause, resume, setMasterVolume, stopAll, destroy,
    getState: () => Object.freeze({ cursor, paused, destroyed, volume, activeVoices: voices.size })
  });
}
