function resetContext(context) {
  context.setTransform?.(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.shadowColor = "rgba(0, 0, 0, 0)";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("StudioSequenceV2 composition was cancelled");
  error.name = "AbortError";
  throw error;
}

function defaultSurface(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new TypeError("A Canvas surface factory is required in this host");
}

/**
 * Create a reusable compositor for StudioSequenceV2 samples. The caller draws
 * each complete scene (camera, characters and effects included) synchronously.
 * Dissolve uses the output as one weighted layer and a single reusable surface
 * for the other; Fade draws against black and Cut draws only its sampled scene.
 */
export function createStudioSequenceCompositor({ createSurface = defaultSurface } = {}) {
  if (typeof createSurface !== "function") throw new TypeError("createSurface must be a function");
  let scratch = null;
  let scratchContext = null;
  let surfaceCreations = 0;

  function ensureScratch(width, height, target) {
    if (!scratch) {
      scratch = createSurface(width, height);
      if (!scratch || scratch === target || typeof scratch.getContext !== "function") {
        scratch = null;
        throw new TypeError("createSurface must return a distinct Canvas surface");
      }
      surfaceCreations++;
    }
    if (scratch.width !== width) scratch.width = width;
    if (scratch.height !== height) scratch.height = height;
    if (!scratchContext || scratchContext.canvas !== scratch) scratchContext = scratch.getContext("2d", { alpha: true });
    if (!scratchContext) throw new TypeError("Unable to create a 2D transition surface");
    return scratchContext;
  }

  function renderScene(context, width, height, scene, sceneTimeMs, drawScene, signal, { clear = true, alpha = 1 } = {}) {
    context.save();
    try {
      resetContext(context);
      context.globalAlpha = alpha;
      if (clear) context.clearRect(0, 0, width, height);
      const result = drawScene(context, scene, sceneTimeMs);
      if (result?.then) throw new TypeError("Scene drawing must be synchronous");
      throwIfAborted(signal);
    } finally { context.restore(); }
  }

  function draw(context, sample, drawScene, options = {}) {
    try {
      const signal = options?.signal;
      if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean")) {
        throw new TypeError("draw options signal must be an AbortSignal");
      }
      throwIfAborted(signal);
      const width = context?.canvas?.width;
      const height = context?.canvas?.height;
      if (!context || typeof context.save !== "function" || typeof context.drawImage !== "function" ||
          !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
        throw new TypeError("A 2D context with positive Canvas dimensions is required");
      }
      if (typeof drawScene !== "function") throw new TypeError("drawScene(scene, localTimeMs) is required");
      if (sample?.kind === "scene") {
        renderScene(context, width, height, sample.scene, sample.sceneTimeMs, drawScene, signal);
        return;
      }
      const transitionType = sample?.transition?.type;
      if (sample?.kind !== "transition" || !["fade", "dissolve", "crossfade", "through-black", "through-light", "focus"].includes(transitionType) ||
          !Number.isFinite(sample.progress) || sample.progress < 0 || sample.progress > 1 ||
          !sample.outgoing?.scene || !sample.incoming?.scene) {
        throw new TypeError("Expected a valid StudioSequenceV2 scene or transition sample");
      }

      context.save();
      try {
        resetContext(context);
        context.clearRect(0, 0, width, height);
        if (["fade", "through-black", "through-light"].includes(sample.transition.type)) {
          context.fillStyle = sample.transition.type === "through-light" ? (sample.transition.color ?? "#fff") : (sample.transition.color ?? "#000");
          context.fillRect(0, 0, width, height);
          const visible = sample.outgoing.opacity > 0 ? sample.outgoing : sample.incoming;
          const opacity = sample.outgoing.opacity > 0 ? sample.outgoing.opacity : sample.incoming.opacity;
          if (opacity > 0) {
            const overlay = ensureScratch(width, height, context.canvas);
            renderScene(overlay, width, height, visible.scene, visible.sceneTimeMs, drawScene, signal);
            throwIfAborted(signal);
            context.globalAlpha = opacity;
            context.drawImage(scratch, 0, 0, width, height);
          }
          return;
        }

        if (sample.transition.type === "focus") {
          renderScene(context, width, height, sample.outgoing.scene, sample.outgoing.sceneTimeMs, drawScene, signal);
          const overlay = ensureScratch(width, height, context.canvas);
          renderScene(overlay, width, height, sample.incoming.scene, sample.incoming.sceneTimeMs, drawScene, signal);
          throwIfAborted(signal);
          const focusX = Number.isFinite(sample.transition.focusX) ? Math.max(0, Math.min(1, sample.transition.focusX)) * width : width / 2;
          const focusY = Number.isFinite(sample.transition.focusY) ? Math.max(0, Math.min(1, sample.transition.focusY)) * height : height / 2;
          const radius = Math.hypot(width, height) * sample.progress;
          context.save();
          try {
            context.beginPath(); context.arc(focusX, focusY, radius, 0, Math.PI * 2); context.clip();
            context.drawImage(scratch, 0, 0, width, height);
          } finally { context.restore(); }
          return;
        }

        const progress = sample.progress;
        renderScene(context, width, height, sample.outgoing.scene, sample.outgoing.sceneTimeMs, drawScene, signal);
        context.save();
        try {
          resetContext(context);
          context.globalCompositeOperation = "destination-in";
          context.globalAlpha = 1 - progress;
          context.fillStyle = "#fff";
          context.fillRect(0, 0, width, height);
        } finally { context.restore(); }
        const overlay = ensureScratch(width, height, context.canvas);
        renderScene(overlay, width, height, sample.incoming.scene, sample.incoming.sceneTimeMs, drawScene, signal);
        throwIfAborted(signal);
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = progress;
        context.drawImage(scratch, 0, 0, width, height);
      } finally { context.restore(); }
    } catch (error) {
      release();
      throw error;
    }
  }

  function release() {
    if (!scratch) return;
    try { scratch.width = 0; scratch.height = 0; } catch {}
    scratch = null;
    scratchContext = null;
  }

  function getDiagnostics() {
    const width = scratch?.width ?? 0;
    const height = scratch?.height ?? 0;
    return Object.freeze({ surfaceCreations, liveSurfaces: scratch ? 1 : 0,
      scratchWidth: width, scratchHeight: height, scratchBytes: width * height * 4 });
  }

  return Object.freeze({ draw, release, getDiagnostics });
}
