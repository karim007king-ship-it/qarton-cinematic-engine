/**
 * Browser/Android WebView HTMLAudio adapter for createAudioCueController.
 * Audio construction is lazy and injectable, so importing this module is safe
 * in Node and non-browser runtimes.
 */
export function createHTMLAudioAdapter({
  resolveAsset,
  createAudio = () => {
    if (typeof Audio !== "function") throw new Error("HTMLAudio is unavailable; provide createAudio()");
    return new Audio();
  },
  masterVolume = 1,
  onPlaybackError = () => {}
} = {}) {
  if (typeof resolveAsset !== "function" || typeof createAudio !== "function"
    || typeof onPlaybackError !== "function") {
    throw new TypeError("HTMLAudio adapter requires resolveAsset, createAudio and onPlaybackError functions");
  }
  if (!Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 1) {
    throw new TypeError("Master volume must be between 0 and 1");
  }
  let volume = masterVolume;
  let destroyed = false;
  const active = new Map();

  function releaseFailedPlayback(audio, { retainOwnership = false } = {}) {
    // A synchronous failure has no returned handle, so release it when possible.
    // For async rejection the controller already owns the returned handle; keep
    // it registered until stop()/destroy() releases that same voice.
    try {
      audio.pause();
      try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
      if (!retainOwnership) active.delete(audio);
    } catch {
      // Retain the voice for a later stop()/destroy() cleanup attempt.
    }
  }

  function reportPlaybackError(error, asset, audio, retainOwnership = false) {
    if (active.has(audio)) releaseFailedPlayback(audio, { retainOwnership });
    try {
      onPlaybackError(error, { asset, audio });
    } catch {
      // Error reporting must not create an unhandled rejection of its own.
    }
  }

  function play(asset, options = {}) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    const url = resolveAsset(asset);
    if (typeof url !== "string" || !url.trim()) throw new TypeError("Audio asset resolver must return a URL");
    const baseVolume = options.volume ?? 1;
    if (!Number.isFinite(baseVolume) || baseVolume < 0 || baseVolume > 1) {
      throw new TypeError("Audio voice volume must be between 0 and 1");
    }
    // Validate all caller-controlled options before allocating a native media
    // element; invalid cue metadata must not leave an unreachable audio object.
    const audio = createAudio();
    if (!audio || typeof audio.play !== "function" || typeof audio.pause !== "function") {
      throw new TypeError("createAudio() must return an HTMLAudio-like object");
    }
    audio.src = url;
    audio.loop = options.loop === true;
    audio.preload = "auto";
    audio.volume = baseVolume * volume;
    active.set(audio, baseVolume);
    let result;
    try {
      result = audio.play();
    } catch (error) {
      reportPlaybackError(error, asset, audio);
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(error => reportPlaybackError(error, asset, audio, true));
    }
    return audio;
  }

  function stop(audio) {
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
    active.delete(audio);
  }

  function setVolume(audio, nextVolume) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!audio || !Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Audio voice volume must be between 0 and 1");
    }
    active.set(audio, nextVolume);
    audio.volume = nextVolume * volume;
  }

  function setMasterVolume(nextVolume) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Master volume must be between 0 and 1");
    }
    volume = nextVolume;
    for (const [audio, baseVolume] of active) audio.volume = baseVolume * volume;
    return volume;
  }

  function destroy() {
    // Prevent new playback immediately, but retain voices whose teardown fails
    // so a later destroy() can retry them.
    destroyed = true;
    const errors = [];
    for (const audio of [...active.keys()]) {
      let failed = false;
      try {
        audio.pause();
      } catch (error) {
        errors.push(error);
        failed = true;
      }
      try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
      try {
        audio.src = "";
      } catch (error) {
        errors.push(error);
        failed = true;
      }
      if (!failed) active.delete(audio);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more HTMLAudio voices could not be destroyed");
    }
  }

  return Object.freeze({ play, stop, setVolume, setMasterVolume, destroy });
}
