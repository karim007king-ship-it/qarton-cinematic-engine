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
  let destroyInProgress = false;
  const active = new Map();
  const assets = new WeakMap();
  const endedHandlers = new Map();
  const voiceStates = new WeakMap();

  function detachEndedHandler(audio, { alreadyFired = false } = {}) {
    const handler = endedHandlers.get(audio);
    if (!handler) return true;
    if (typeof audio.removeEventListener !== "function") {
      if (alreadyFired) endedHandlers.delete(audio);
      return alreadyFired;
    }
    try {
      audio.removeEventListener("ended", handler);
      endedHandlers.delete(audio);
      return true;
    } catch {
      // Keep the handler reference so destroy()/stop() can retry native cleanup.
      if (alreadyFired) endedHandlers.delete(audio);
      return false;
    }
  }

  function releaseFailedPlayback(audio, { retainOwnership = false, clearSource = false } = {}) {
    try {
      audio.pause();
      // A rejected resume must preserve the playhead so a later user-gesture
      // retry continues from the suspended position instead of restarting.
      if (!retainOwnership) {
        try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
        if (clearSource) {
          try {
            audio.src = "";
          } catch {
            voiceStates.set(audio, "cleanup-pending");
            return;
          }
        }
        if (!detachEndedHandler(audio)) {
          voiceStates.set(audio, "cleanup-pending");
          return;
        }
        active.delete(audio);
        voiceStates.set(audio, "stopped");
      }
    } catch {
      // Keep ownership so stop()/destroy() can retry native media cleanup.
    }
  }

  function reportPlaybackError(error, audio, { retainOwnership = false, clearSource = false, phase = "play" } = {}) {
    // A stopped or naturally ended voice is stale; its late Promise rejection
    // must not report an error or touch a resource the adapter no longer owns.
    if (!active.has(audio) || voiceStates.get(audio) !== "active") return;
    releaseFailedPlayback(audio, { retainOwnership, clearSource });
    try { onPlaybackError(error, { asset: assets.get(audio), audio, phase }); }
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

    // Register ownership before touching native media setters: WebView
    // implementations may throw while assigning src, loop, preload or volume.
    // If setup fails, the normal failure path can pause and release the element,
    // or retain it for a later destroy() retry when native cleanup also fails.
    active.set(audio, baseVolume);
    assets.set(audio, asset);
    voiceStates.set(audio, "active");
    try {
      audio.src = url;
      audio.loop = options.loop === true;
      audio.preload = "auto";
      audio.volume = baseVolume * volume;
    } catch (error) {
      // Setup may have assigned src before a later native setter failed.
      // Clear that source before releasing ownership; if clearing fails,
      // retain the voice so destroy() can retry the native cleanup.
      reportPlaybackError(error, audio, { clearSource: true, phase: "setup" });
      throw error;
    }

    // One-shot voices release their registry entry as soon as playback ends.
    if (options.loop !== true
      && typeof audio.addEventListener === "function"
      && typeof audio.removeEventListener === "function") {
      const onEnded = () => {
        // A queued ended event may arrive after stop() detached the listener.
        // Do not notify the cue owner for a voice that is no longer active.
        if (!active.has(audio) || (voiceStates.get(audio) === "destroying" || voiceStates.get(audio) === "stopping" || voiceStates.get(audio) === "cleanup-pending")) return;
        active.delete(audio);
        voiceStates.set(audio, "ended");
        detachEndedHandler(audio, { alreadyFired: true });
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
      Promise.resolve(result).catch(error => reportPlaybackError(error, audio, { retainOwnership: true, phase: "play" }));
    }
    return audio;
  }

  function stop(audio) {
    if (!audio) return;
    if (!active.has(audio)) {
      detachEndedHandler(audio);
      return;
    }
    voiceStates.set(audio, "stopping");
    audio.pause();
    // A native pause event may synchronously re-enter destroy(). Once teardown
    // changes ownership, let that pass finish instead of releasing its handle.
    if (voiceStates.get(audio) !== "stopping") return;
    try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
    if (!detachEndedHandler(audio)) {
      voiceStates.set(audio, "stopping");
      throw new Error("HTMLAudio ended listener could not be detached");
    }
    active.delete(audio);
    voiceStates.set(audio, "stopped");
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
      reportPlaybackError(error, audio, { retainOwnership: true, phase: "resume" });
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(error => reportPlaybackError(error, audio, { retainOwnership: true, phase: "resume" }));
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
    const errors = [];
    for (const [audio, baseVolume] of active) {
      try {
        audio.volume = baseVolume * volume;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more HTMLAudio voices could not update master volume");
    }
    return volume;
  }

  function destroy() {
    // Native pause/source cleanup can synchronously dispatch host events. If
    // one of those listeners re-enters destroy(), keep the outer pass as the
    // sole owner of each voice and allow a later call to retry failed cleanup.
    if (destroyInProgress) return;
    destroyed = true;
    destroyInProgress = true;
    try {
      const errors = [];
      for (const audio of [...active.keys()]) {
        let failed = false;
        // Mark before invoking native methods: a queued ended callback must not
        // release ownership while teardown is in progress.
        const stopAlreadyOwnsPause = voiceStates.get(audio) === "stopping";
        voiceStates.set(audio, "destroying");
        // stop() may have entered destroy() from its native pause callback.
        // Do not issue a second pause while that operation is already active.
        if (!stopAlreadyOwnsPause) {
          try {
            audio.pause();
          } catch (error) {
            errors.push(error);
            failed = true;
          }
        }
        try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
        try {
          audio.src = "";
        } catch (error) {
          errors.push(error);
          failed = true;
        }
        if (!detachEndedHandler(audio)) {
          errors.push(new Error("HTMLAudio ended listener could not be detached"));
          failed = true;
        }
        if (!failed) {
          active.delete(audio);
          voiceStates.set(audio, "stopped");
        } else {
          // A late ended event must not release ownership while native teardown
          // is incomplete; a later destroy() call remains responsible for retry.
          voiceStates.set(audio, "destroying");
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "One or more HTMLAudio voices could not be destroyed");
      }
    } finally {
      destroyInProgress = false;
    }
  }

  return Object.freeze({ play, pause, resume, stop, setVolume, setMasterVolume, destroy });
}
