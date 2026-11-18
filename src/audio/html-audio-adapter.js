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
  const assets = new WeakMap();
  const endedHandlers = new Map();
  const voiceStates = new WeakMap();

  function detachEndedHandler(audio) {
    const handler = endedHandlers.get(audio);
    if (!handler) return;
    try { audio.removeEventListener?.("ended", handler); }
    catch { /* listener cleanup is best-effort on minimal media hosts */ }
    endedHandlers.delete(audio);
  }

  function releaseFailedPlayback(audio, { retainOwnership = false } = {}) {
    try {
      audio.pause();
      // A rejected resume must preserve the playhead so a later user-gesture
      // retry continues from the suspended position instead of restarting.
      if (!retainOwnership) {
        try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
        active.delete(audio);
        voiceStates.set(audio, "stopped");
        detachEndedHandler(audio);
      }
    } catch {
      // Keep ownership so stop()/destroy() can retry native media cleanup.
    }
  }

  function reportPlaybackError(error, audio, { retainOwnership = false } = {}) {
    // A stopped or naturally ended voice is stale; its late Promise rejection
    // must not report an error or touch a resource the adapter no longer owns.
    if (!active.has(audio)) return;
    releaseFailedPlayback(audio, { retainOwnership });
    try { onPlaybackError(error, { asset: assets.get(audio), audio }); }
    catch { /* error reporting must not create an unhandled rejection */ }
  }

  function play(asset, options = {}) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    const url = resolveAsset(asset);
    if (typeof url !== "string" || !url.trim()) throw new TypeError("Audio asset resolver must return a URL");
    const baseVolume = options.volume ?? 1;
    if (!Number.isFinite(baseVolume) || baseVolume < 0 || baseVolume > 1) {
      throw new TypeError("Audio voice volume must be between 0 and 1");
    }

    // Validate caller-controlled options before allocating a native media element.
    const audio = createAudio();
    if (!audio || typeof audio.play !== "function" || typeof audio.pause !== "function") {
      throw new TypeError("createAudio() must return an HTMLAudio-like object");
    }

    // Register ownership before touching native media properties. Some WebView
    // implementations can throw from a setter after the Audio object is created.
    active.set(audio, baseVolume);
    assets.set(audio, asset);
    voiceStates.set(audio, "active");
    try {
      audio.src = url;
      audio.loop = options.loop === true;
      audio.preload = "auto";
      audio.volume = baseVolume * volume;
    } catch (error) {
      // Roll back a partially configured voice. If native cleanup itself fails,
      // keep ownership so destroy() can retry instead of orphaning the element.
      let cleanupFailed = false;
      try { audio.pause(); } catch { cleanupFailed = true; }
      try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
      try { audio.src = ""; } catch { cleanupFailed = true; }
      if (!cleanupFailed) {
        active.delete(audio);
        voiceStates.set(audio, "stopped");
        detachEndedHandler(audio);
      }
      throw error;
    }

    // One-shot voices release their registry entry as soon as playback ends.
    if (options.loop !== true && typeof audio.addEventListener === "function") {
      const onEnded = () => {
        // A queued ended event may arrive after stop() detached the listener.
        // Do not notify the cue owner for a voice that is no longer active.
        if (!active.has(audio)) return;
        active.delete(audio);
        voiceStates.set(audio, "ended");
        detachEndedHandler(audio);
        try { options.onEnded?.(audio); } catch { /* completion observers must not break media cleanup */ }
      };
      try {
        audio.addEventListener("ended", onEnded, { once: true });
        endedHandlers.set(audio, onEnded);
      } catch {
        // Playback remains valid on HTMLAudio-compatible hosts with limited events.
      }
    }

    let result;
    try {
      result = audio.play();
    } catch (error) {
      reportPlaybackError(error, audio);
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(error => reportPlaybackError(error, audio, { retainOwnership: true }));
    }
    return audio;
  }

  function stop(audio) {
    if (!audio) return;
    if (!active.has(audio)) {
      detachEndedHandler(audio);
      return;
    }
    audio.pause();
    try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
    active.delete(audio);
    voiceStates.set(audio, "stopped");
    detachEndedHandler(audio);
  }

  function pause(audio) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!audio || !active.has(audio)) return;
    audio.pause();
  }

  function resume(audio) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!audio || !active.has(audio)) return;
    let result;
    try {
      result = audio.play();
    } catch (error) {
      reportPlaybackError(error, audio, { retainOwnership: true });
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(error => reportPlaybackError(error, audio, { retainOwnership: true }));
    }
  }

  function setVolume(audio, nextVolume) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!audio || !Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Audio voice volume must be between 0 and 1");
    }
    if (!active.has(audio) || voiceStates.get(audio) !== "active") return;
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
    // Close new work immediately, but retain voices whose native teardown fails
    // so a later destroy() call can retry them.
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
      detachEndedHandler(audio);
      if (!failed) {
        active.delete(audio);
        voiceStates.set(audio, "stopped");
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more HTMLAudio voices could not be destroyed");
    }
  }

  return Object.freeze({ play, pause, resume, stop, setVolume, setMasterVolume, destroy });
}
