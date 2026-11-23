/** Compile ordered image sequences once. Sample only from the scene clock. */
export function compileFrameAnimation({ clips, blink } = {}, reducedMotion = false) {
  if (!clips || typeof clips !== "object" || Array.isArray(clips) || !Object.keys(clips).length) {
    throw new TypeError("Animation requires named clips");
  }
  const sequences = new Map();
  const assets = new Set();
  for (const [name, clip] of Object.entries(clips)) {
    if (!name.trim() || !Array.isArray(clip?.frames) || !clip.frames.length || clip.frames.length > 4096 ||
        !Number.isFinite(clip.fps) || clip.fps <= 0 || clip.fps > 240) {
      throw new TypeError("A clip requires frames and FPS in (0, 240]");
    }
    let spriteSheet = null;
    if (clip.spriteSheet !== undefined) {
      const sheet = clip.spriteSheet;
      if (!sheet || typeof sheet !== "object" || Array.isArray(sheet) ||
          typeof sheet.asset !== "string" || !sheet.asset.trim() ||
          !Number.isSafeInteger(sheet.frameWidth) || sheet.frameWidth <= 0 ||
          !Number.isSafeInteger(sheet.frameHeight) || sheet.frameHeight <= 0 ||
          !Number.isSafeInteger(sheet.columns) || sheet.columns <= 0 || sheet.columns > 4096 ||
          !Number.isSafeInteger(sheet.frameCount) || sheet.frameCount <= 0 || sheet.frameCount > 16_384 ||
          sheet.frameCount > sheet.columns * 4096) {
        throw new TypeError("A sprite sheet requires an asset, positive frame size, columns, and frameCount");
      }
      spriteSheet = Object.freeze({
        asset: sheet.asset.trim(), frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight, columns: sheet.columns, frameCount: sheet.frameCount
      });
    }
    const closed = clip.blinkFrames;
    if (closed !== undefined && (!Array.isArray(closed) || closed.length !== clip.frames.length)) {
      throw new TypeError("blinkFrames must match the frame count");
    }
    const frames = [...clip.frames];
    for (const key of [...frames, ...(closed ?? [])]) {
      if (spriteSheet) {
        if (!Number.isSafeInteger(key) || key < 0 || key >= spriteSheet.frameCount) {
          throw new TypeError("Sprite sheet frame index is outside the declared frame count");
        }
      } else if (typeof key !== "string" || !key.trim()) {
        throw new TypeError("Invalid frame asset");
      }
    }
    const needed = reducedMotion ? [frames[0]] : [...frames, ...(blink ? closed ?? [] : [])];
    if (spriteSheet) assets.add(spriteSheet.asset);
    else for (const key of needed) assets.add(key);
    const spriteFrames = new Map();
    if (spriteSheet) {
      for (const frame of new Set([...frames, ...(closed ?? [])])) {
        spriteFrames.set(frame, Object.freeze({
          asset: spriteSheet.asset,
          x: (frame % spriteSheet.columns) * spriteSheet.frameWidth,
          y: Math.floor(frame / spriteSheet.columns) * spriteSheet.frameHeight,
          width: spriteSheet.frameWidth,
          height: spriteSheet.frameHeight,
          columns: spriteSheet.columns,
          rows: Math.ceil(spriteSheet.frameCount / spriteSheet.columns),
          index: frame
        }));
      }
    }
    sequences.set(name, { frames, closed: closed?.slice(), fps: clip.fps, loop: clip.loop !== false, spriteSheet, spriteFrames });
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
    const frame = (closed ? clip.closed : clip.frames)[index];
    if (!clip.spriteSheet) return frame;
    return clip.spriteFrames.get(frame);
  }
  return { sample, assets: Object.freeze([...assets]) };
}
