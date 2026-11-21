/** Playback transport for hosts which sample camera, director and actors together. */
export function createSceneClock({ durationMs, now = () => performance.now() }) {
  if (!Number.isFinite(durationMs) || durationMs < 0 || typeof now !== "function") {
    throw new TypeError("Scene clock requires a finite duration and clock source");
  }
  let offset = 0;
  let anchor = null;
  function time() {
    return anchor === null ? offset : Math.min(durationMs, offset + Math.max(0, now() - anchor));
  }
  function pause() {
    offset = time();
    anchor = null;
    return offset;
  }
  function resume() {
    if (anchor === null) anchor = now();
  }
  function seek(ms) {
    if (!Number.isFinite(ms)) throw new TypeError("Invalid seek time");
    offset = Math.min(durationMs, Math.max(0, ms));
    if (anchor !== null) anchor = now();
    return offset;
  }
  return Object.freeze({ time, pause, resume, seek, get paused() { return anchor === null; } });
}
