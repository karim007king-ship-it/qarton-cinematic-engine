function resetContext(context) {
  context.setTransform?.(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
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

  function renderScene(context, width, height, scene, sceneTimeMs, drawScene, { clear = true, alpha = 1 } = {}) {
    context.save();
    try {
      resetContext(context);
      context.globalAlpha = alpha;
      if (clear) context.clearRect(0, 0, width, height);
      const result = drawScene(context, scene, sceneTimeMs);
      if (result?.then) throw new TypeError("Scene drawing must be synchronous");
    } finally { context.restore(); }
  }

  function draw(context, sample, drawScene) {
    const width = context?.canvas?.width;
    const height = context?.canvas?.height;
    if (!context || typeof context.save !== "function" || typeof context.drawImage !== "function" ||
        !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new TypeError("A 2D context with positive Canvas dimensions is required");
    }
    if (typeof drawScene !== "function") throw new TypeError("drawScene(scene, localTimeMs) is required");
    if (sample?.kind === "scene") {
      renderScene(context, width, height, sample.scene, sample.sceneTimeMs, drawScene);
      return;
    }
    if (sample?.kind !== "transition" || !["fade", "dissolve"].includes(sample.transition?.type) ||
        !Number.isFinite(sample.progress) || sample.progress < 0 || sample.progress > 1 ||
        !sample.outgoing?.scene || !sample.incoming?.scene) {
      throw new TypeError("Expected a valid StudioSequenceV2 scene or transition sample");
    }

    context.save();
    try {
      resetContext(context);
      context.clearRect(0, 0, width, height);
      if (sample.transition.type === "fade") {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        const visible = sample.outgoing.opacity > 0 ? sample.outgoing : sample.incoming;
        const opacity = sample.outgoing.opacity > 0 ? sample.outgoing.opacity : sample.incoming.opacity;
        if (opacity > 0) {
          const overlay = ensureScratch(width, height, context.canvas);
          renderScene(overlay, width, height, visible.scene, visible.sceneTimeMs, drawScene);
          context.globalAlpha = opacity;
          context.drawImage(scratch, 0, 0, width, height);
        }
        return;
      }

      const progress = sample.progress;
      renderScene(context, width, height, sample.outgoing.scene, sample.outgoing.sceneTimeMs,
        drawScene);
      context.save();
      try {
        resetContext(context);
        context.globalCompositeOperation = "destination-in";
        context.globalAlpha = 1 - progress;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
      } finally { context.restore(); }
      const overlay = ensureScratch(width, height, context.canvas);
      renderScene(overlay, width, height, sample.incoming.scene, sample.incoming.sceneTimeMs, drawScene);
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = progress;
      context.drawImage(scratch, 0, 0, width, height);
    } finally { context.restore(); }
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
