/** Compile ordered image sequences once. Sample only from the scene clock. */
export function compileFrameAnimation({ clips, blink } = {}, reducedMotion = false) {
  if (!clips || typeof clips !== "object" || Array.isArray(clips) || !Object.keys(clips).length) {
    throw new TypeError("Animation requires named clips");
  }
  const sequences = new Map();
  const assets = new Set();
  for (const [name, clip] of Object.entries(clips)) {
    if (!name.trim() || !Array.isArray(clip?.frames) || !clip.frames.length ||
        !Number.isFinite(clip.fps) || clip.fps <= 0 || clip.fps > 240) {
      throw new TypeError("A clip requires frames and FPS in (0, 240]");
    }
    const closed = clip.blinkFrames;
    if (closed !== undefined && (!Array.isArray(closed) || closed.length !== clip.frames.length)) {
      throw new TypeError("blinkFrames must match the frame count");
    }
    const frames = [...clip.frames];
    for (const key of [...frames, ...(closed ?? [])]) {
      if (typeof key !== "string" || !key.trim()) throw new TypeError("Invalid frame asset");
    }
    const needed = reducedMotion ? [frames[0]] : [...frames, ...(blink ? closed ?? [] : [])];
    for (const key of needed) assets.add(key);
    sequences.set(name, { frames, closed: closed?.slice(), fps: clip.fps, loop: clip.loop !== false });
  }
  const period = blink?.intervalMs, duration = blink?.durationMs;
  if (blink !== undefined && (!Number.isFinite(period) || !Number.isFinite(duration) ||
      duration <= 0 || duration >= period)) throw new TypeError("Invalid blink timing");

  function sample(state, expression, timeMs, startMs) {
    const clip = sequences.get(state + ":" + expression) ?? sequences.get(state);
    if (!clip) return undefined;
    const elapsed = timeMs - startMs;
    const frameMs = 1000 / clip.fps;
    const length = clip.frames.length;
    let index = 0;
    if (!reducedMotion) {
      const clipTime = clip.loop ? elapsed % (length * frameMs) : elapsed;
      index = Math.min(length - 1, Math.floor(clipTime / frameMs));
    }
    const closed = !reducedMotion && clip.closed && blink && timeMs % period >= period - duration;
    return (closed ? clip.closed : clip.frames)[index];
  }
  return { sample, assets: Object.freeze([...assets]) };
}
