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
  const active = new Set();

  function play(asset, options = {}) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    const url = resolveAsset(asset);
    if (typeof url !== "string" || !url.trim()) throw new TypeError("Audio asset resolver must return a URL");
    const audio = createAudio();
    if (!audio || typeof audio.play !== "function" || typeof audio.pause !== "function") {
      throw new TypeError("createAudio() must return an HTMLAudio-like object");
    }
    audio.src = url;
    audio.loop = options.loop === true;
    audio.preload = "auto";
    audio.volume = Math.min(1, Math.max(0, (options.volume ?? 1) * volume));
    active.add(audio);
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      result.catch(error => onPlaybackError(error, { asset, audio }));
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
    if (!audio || !Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Audio voice volume must be between 0 and 1");
    }
    audio.volume = Math.min(1, nextVolume);
  }

  function setMasterVolume(nextVolume) {
    if (destroyed) throw new Error("HTMLAudio adapter has been destroyed");
    if (!Number.isFinite(nextVolume) || nextVolume < 0 || nextVolume > 1) {
      throw new TypeError("Master volume must be between 0 and 1");
    }
    volume = nextVolume;
    for (const audio of active) audio.volume = Math.min(1, (audio.__qartonBaseVolume ?? 1) * volume);
    return volume;
  }

  function destroy() {
    if (destroyed) return;
    for (const audio of active) {
      audio.pause();
      try { audio.currentTime = 0; } catch { /* best-effort cleanup */ }
      audio.src = "";
    }
    active.clear();
    destroyed = true;
  }

  return Object.freeze({ play, stop, setVolume, setMasterVolume, destroy });
}
