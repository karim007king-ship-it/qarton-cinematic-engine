export function normalizeAudioCues(cues) {
  if (!Array.isArray(cues)) throw new TypeError("Audio cues must be an array");
  const ids = new Set();
  return cues.map((cue, index) => {
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
      id: cue.id,
      atMs: cue.atMs,
      asset: cue.asset,
      channel: typeof cue.channel === "string" ? cue.channel : "sfx",
      loop: cue.loop === true,
      volume: cue.volume ?? 1
    });
  }).sort((a, b) => a.atMs - b.atMs);
}

/**
 * Timeline-driven audio cue controller.
 * All audio playback is injected by the host (Web Audio, HTMLAudio, native,
 * or game engine). This module owns deterministic cue timing, not decoding.
 */
export function createAudioCueController({
  cues = [],
  play,
  stop = () => {},
  setVolume = () => {},
  masterVolume = 1
} = {}) {
  if (typeof play !== "function" || typeof stop !== "function" || typeof setVolume !== "function") {
    throw new TypeError("Audio play, stop and setVolume adapters must be functions");
  }
  if (!Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 1) {
    throw new TypeError("Master volume must be between 0 and 1");
  }

  const normalized = normalizeAudioCues(cues);

  let cursor = -1;
  let paused = false;
  let destroyed = false;
  let volume = masterVolume;
  const voices = new Map();
  const firedIds = new Set();

  function assertAlive() {
    if (destroyed) throw new Error("Audio cue controller has been destroyed");
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
      const voice = play(cue.asset, {
        id: cue.id,
        channel: cue.channel,
        loop: cue.loop,
        volume: cue.volume * volume
      });
      if (voice != null) voices.set(cue.id, voice);
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
    paused = true;
  }

  function resume(timeMs = cursor) {
    assertAlive();
    if (!Number.isFinite(timeMs) || timeMs < cursor) {
      throw new TypeError("Resume time must be finite and not earlier than the audio cursor");
    }
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
      try {
        stop(voice);
        voices.delete(id);
      } catch (error) {
        // Keep ownership of failed voices so stopAll()/destroy() can retry.
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more audio voices could not be stopped");
    }
  }

  function stopAll({ reset = false } = {}) {
    assertAlive();
    paused = false;
    // Do not rewind the timeline until every currently owned voice is stopped.
    // Otherwise a failed stop could be followed by a duplicate cue playback.
    stopVoices();
    if (reset) {
      cursor = -1;
      firedIds.clear();
    }
  }

  function destroy() {
    // Close playback immediately, but retain failed voices for a later retry.
    destroyed = true;
    stopVoices();
  }

  return Object.freeze({
    update,
    pause,
    resume,
    setMasterVolume,
    stopAll,
    destroy,
    getState: () => Object.freeze({ cursor, paused, destroyed, volume, activeVoices: voices.size })
  });
}
