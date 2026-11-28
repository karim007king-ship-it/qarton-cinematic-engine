import { drawTextCinematicScene } from "../character/text-cinematic-scene.js";
import { drawCinematicAtmosphere, sampleCinematicDirector } from "../effects/cinematic-director.js";
import { composeCameraPose, sampleCameraTrack } from "../camera/camera-track.js";

const DEFAULT_QUALITY = Object.freeze({ low: 0.5, medium: 0.75, high: 1 });

function drawable(image) {
  return image && Number(image.width ?? image.naturalWidth) > 0 && Number(image.height ?? image.naturalHeight);
}

function enforceDecodedPixelBudget(assetMaps, budget) {
  const images = new Set();
  for (const map of assetMaps) if (map instanceof Map) for (const value of map.values()) {
    for (const image of [value, value?.portrait, value?.bitmap, ...(value?.layers ?? []).map(layer => layer.image ?? layer.bitmap)]) if (drawable(image)) images.add(image);
  }
  let pixels = 0;
  for (const image of images) pixels += Number(image.width ?? image.naturalWidth) * Number(image.height ?? image.naturalHeight);
  if (pixels > budget) throw new RangeError(`Decoded image budget exceeded: ${pixels} > ${budget} pixels`);
  return pixels;
}

function drawImageFit(ctx, image, width, height, fit = "cover", role = "background") {
  if (!drawable(image)) return false;
  const iw = Number(image.width ?? image.naturalWidth), ih = Number(image.height ?? image.naturalHeight);
  if (fit === "fill") { ctx.drawImage(image, 0, 0, width, height); return true; }
  if (fit === "contain" && role !== "foreground") {
    // Use a subdued crop of the same artwork as the matte, then draw the
    // complete uncropped image over it. Fit never exposes accidental black.
    ctx.save(); ctx.globalAlpha *= 0.34;
    const coverScale = Math.max(width / iw, height / ih), coverW = iw * coverScale, coverH = ih * coverScale;
    ctx.drawImage(image, (width - coverW) / 2, (height - coverH) / 2, coverW, coverH);
    ctx.restore();
  }
  const scale = fit === "contain" ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
  const w = iw * scale, h = ih * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  return true;
}

function adaptCamera(camera, width, height) {
  const pose = camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 };
  return { ...pose, x: (pose.x ?? 0) * width / 720, y: (pose.y ?? 0) * height / 1280 };
}

function drawAtmosphereAndEffects(ctx, direction, assets) {
  if (direction) drawCinematicAtmosphere(ctx, direction, Object.fromEntries(assets));
}

function drawBackgrounds(ctx, scene, assets, camera, direction) {
  const { width, height } = ctx.canvas;
  const pose = adaptCamera(camera, width, height);
  const layers = [...scene.backgrounds].sort((a, b) => a.z - b.z);
  // Keep a same-art cover matte fixed to the viewport beneath the camera pass.
  // Pan, zoom, and rotation can expose canvas edges; this prevents those gaps
  // from revealing the black clear color while keeping a neutral shot identical.
  const primary = layers.find(layer => layer.role === "background") ?? layers.find(layer => drawable(assets.get(layer.assetId)));
  const primaryImage = primary && assets.get(primary.assetId);
  if (drawable(primaryImage)) {
    ctx.save(); ctx.globalAlpha = 1;
    drawImageFit(ctx, primaryImage, width, height, "cover", "background");
    ctx.restore();
  }
  ctx.save();
  ctx.translate(width / 2 + pose.x, height / 2 + pose.y);
  ctx.rotate((pose.rotation ?? 0) * Math.PI / 180);
  ctx.scale(pose.zoom ?? 1, pose.zoom ?? 1);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = "#090a0d";
  ctx.fillRect(0, 0, width, height);
  const parallax = direction?.parallaxLayers ?? [];
  for (const layer of layers) {
    const image = assets.get(layer.assetId);
    if (!drawable(image)) continue;
    const offset = parallax.find(item => item.depth != null && Math.abs(item.depth - (layer.depth ?? 0)) < 0.55);
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.translate((layer.x ?? 0) * width + (offset?.x ?? 0) * width, (layer.y ?? 0) * height + (offset?.y ?? 0) * height);
    const scale = layer.scale ?? 1;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);
    drawImageFit(ctx, image, width, height, layer.fit ?? "cover", layer.role);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Canvas renderer for CinematicSceneV1 Runtime frames. It composes the existing
 * text-character, layered-sprite, camera and cinematic-effects cores; hosts
 * provide the canvas and decoded asset map. No editor or audio APIs are used.
 */
export class CinematicRenderer {
  #ctx;
  #quality;
  #maxCanvasPixels;
  #maxDecodedPixels;
  #decodedPixels = 0;
  #disposed = false;
  #frameCount = 0;
  #transitionCount = 0;
  #transitionSurfacePixels = 0;
  #lastDraw = null;
  #transitionCancel = null;

  constructor(canvasOrContext, { quality = "medium", maxCanvasPixels = 2_400_000, maxDecodedPixels = 12_000_000 } = {}) {
    this.#ctx = canvasOrContext?.getContext ? canvasOrContext.getContext("2d", { alpha: false }) : canvasOrContext;
    if (!this.#ctx?.canvas || typeof this.#ctx.drawImage !== "function") throw new TypeError("CinematicRenderer needs a Canvas or 2D context");
    if (!Object.hasOwn(DEFAULT_QUALITY, quality)) throw new TypeError("quality must be low, medium, or high");
    if (!Number.isSafeInteger(maxCanvasPixels) || maxCanvasPixels < 1) throw new RangeError("maxCanvasPixels must be a positive integer");
    if (!Number.isSafeInteger(maxDecodedPixels) || maxDecodedPixels < 1) throw new RangeError("maxDecodedPixels must be a positive integer");
    this.#quality = quality;
    const canvas = this.#ctx.canvas;
    const backingPixels = canvas.width * canvas.height;
    if (backingPixels > maxCanvasPixels) throw new RangeError(`Canvas backing budget exceeded: ${backingPixels} > ${maxCanvasPixels} pixels`);
    canvas.dataset && (canvas.dataset.qartonQuality = quality);
    // Keep the authored 720×1280 coordinate system stable; silently resizing
    // the backing store would misalign the existing effects core. Hosts can
    // choose a lower-resolution canvas before construction if required.
    this.#maxCanvasPixels = maxCanvasPixels;
    this.#maxDecodedPixels = maxDecodedPixels;
    this.#ctx.imageSmoothingEnabled = true;
    this.#ctx.imageSmoothingQuality = quality === "high" ? "high" : quality === "low" ? "low" : "medium";
  }

  render(frame) {
    if (this.#disposed) return false;
    if (!frame?.scene?.textScene || !Number.isFinite(frame.timeMs) || !(frame.assets instanceof Map)) throw new TypeError("A Runtime frame with compiled text scene and decoded assets is required");
    const { scene, timeMs, assets, camera, direction } = frame;
    this.#decodedPixels = enforceDecodedPixelBudget([assets, frame.characterAssets], this.#maxDecodedPixels);
    const ctx = this.#ctx, { width, height } = ctx.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);
    drawBackgrounds(ctx, scene, assets, camera, direction);
    const characters = new Map();
    for (const character of scene.characters) {
      const art = frame.characterAssets?.get(character.id);
      if (art) characters.set(character.id, art);
    }
    const poseStats = drawTextCinematicScene(ctx, scene.textScene, timeMs, {
      transparent: true, assets: characters, camera: adaptCamera(camera, width, height), drawDialogue: false,
      drawSceneOverlay: overlayCtx => {
        drawAtmosphereAndEffects(overlayCtx, direction, assets);
        const tint = scene.lighting?.tint ?? "#000000";
        const intensity = Math.max(0, Math.min(1, scene.lighting?.intensity ?? 0));
        if (intensity) {
          overlayCtx.save(); overlayCtx.globalAlpha = intensity * 0.14;
          overlayCtx.fillStyle = tint; overlayCtx.fillRect(0, 0, width, height); overlayCtx.restore();
        }
      }
    });
    this.#frameCount += 1;
    this.#lastDraw = Object.freeze({ timeMs, sceneId: scene.id, drawnCharacterIds: poseStats.drawnCharacterIds,
      characterGeometry: poseStats.characterGeometry, faceRigValid: poseStats.faceRigValid,
      focusCharacterId: frame.focusCharacterId ?? null, visibleBackgroundIds: Object.freeze(scene.backgrounds.filter(layer => drawable(assets.get(layer.assetId))).map(layer => layer.id)) });
    return this.#lastDraw;
  }

  /** Render an initial transition endpoint using this same production path. */
  renderEndpoint(scene, assets, ctx = this.#ctx, timeMs = 0) {
    if (!scene?.textScene || !(assets instanceof Map)) throw new TypeError("A compiled scene and decoded assets are required");
    const canvas = ctx.canvas, { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    const direction = sampleCinematicDirector(scene.direction, timeMs);
    this.#decodedPixels = enforceDecodedPixelBudget([assets], this.#maxDecodedPixels);
    const sampledCamera = scene.camera.mode === "manual" && scene.camera.keyframes
      ? sampleCameraTrack(scene.camera.keyframes, timeMs) : direction.effects.camera;
    const sampledPose = composeCameraPose(sampledCamera, direction.effects.shake);
    const camera = { ...sampledPose, zoom: sampledPose.zoom * direction.shotScale };
    const pose = adaptCamera(camera, width, height);
    drawBackgrounds(ctx, scene, assets, camera, direction);
    const characters = new Map(scene.characters.map(character => [character.id, character.assetId ? assets.get(character.assetId) : { layers: character.layers.map(layer => ({ ...layer, image: assets.get(layer.assetId) })) }]));
    const rendered = drawTextCinematicScene(ctx, scene.textScene, timeMs, { transparent: true, assets: characters, camera: pose, drawDialogue: false,
      drawSceneOverlay: overlayCtx => {
        drawAtmosphereAndEffects(overlayCtx, direction, assets);
        const intensity = Math.max(0, Math.min(1, scene.lighting?.intensity ?? 0));
        if (intensity) { overlayCtx.save(); overlayCtx.globalAlpha = intensity * 0.14; overlayCtx.fillStyle = scene.lighting?.tint ?? "#000000"; overlayCtx.fillRect(0, 0, width, height); overlayCtx.restore(); }
      } });
    return rendered;
  }

  async transition({ from, to, type = "crossfade", durationMs = 350 } = {}) {
    if (this.#disposed) return false;
    if (!to?.scene || !(to.assets instanceof Map) || !["cut", "crossfade", "through-black", "through-light", "focus"].includes(type)) throw new TypeError("Transition requires a mounted target and supported cinematic transition type");
    this.#transitionCancel?.();
    if (type === "cut" || durationMs <= 0 || !from?.scene) {
      this.renderEndpoint(to.scene, to.assets);
      return true;
    }
    const canvas = this.#ctx.canvas, width = canvas.width, height = canvas.height;
    const basePixels = width * height, availablePixels = this.#maxCanvasPixels - basePixels;
    if (availablePixels < 2) { this.renderEndpoint(to.scene, to.assets); return true; }
    const scale = Math.min(1, Math.sqrt(availablePixels / (2 * basePixels)));
    const surfaceWidth = Math.max(1, Math.floor(width * scale)), surfaceHeight = Math.max(1, Math.floor(height * scale));
    const makeSurface = () => {
      const surface = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(surfaceWidth, surfaceHeight) : canvas.ownerDocument.createElement("canvas");
      surface.width = surfaceWidth; surface.height = surfaceHeight; return surface;
    };
    const source = makeSurface(), target = makeSurface();
    this.#transitionSurfacePixels = 2 * surfaceWidth * surfaceHeight;
    source.getContext("2d").drawImage(canvas, 0, 0, surfaceWidth, surfaceHeight);
    this.renderEndpoint(to.scene, to.assets, target.getContext("2d"), 0);
    const started = globalThis.performance?.now?.() ?? Date.now();
    let cancel;
    const cancelled = new Promise(resolve => { cancel = () => resolve(false); });
    this.#transitionCancel = cancel;
    const frame = () => new Promise(resolve => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(resolve);
      else setTimeout(() => resolve(globalThis.performance?.now?.() ?? Date.now()), 16);
    });
    const paint = progress => {
      const ctx = this.#ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
      ctx.clearRect(0, 0, width, height);
      if (type === "through-black" || type === "through-light") {
        const color = type === "through-light" ? "#fffaf0" : "#000000";
        ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
        if (progress < 0.5) { ctx.globalAlpha = 1 - progress * 2; ctx.drawImage(source, 0, 0, width, height); }
        else { ctx.globalAlpha = (progress - 0.5) * 2; ctx.drawImage(target, 0, 0, width, height); }
      } else {
        ctx.drawImage(source, 0, 0, width, height);
        if (type === "focus") {
          const focus = to.scene.characters.find(item => item.id === (to.scene.dialogue[0]?.speakerId ?? to.scene.characters[0]?.id));
          const x = (focus?.x ?? .5) * width, y = (focus?.y ?? .5) * height;
          const radius = Math.hypot(width, height) * progress;
          ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(target, 0, 0, width, height); ctx.restore();
        } else {
          ctx.globalAlpha = progress; ctx.drawImage(target, 0, 0, width, height);
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    };
    const animate = async () => {
      for (;;) {
        const timestamp = await frame();
        if (this.#disposed || this.#transitionCancel !== cancel) return false;
        const now = Number.isFinite(timestamp) ? timestamp : (globalThis.performance?.now?.() ?? Date.now());
        const progress = Math.max(0, Math.min(1, (now - started) / durationMs));
        paint(progress);
        if (progress >= 1) return true;
      }
    };
    let result;
    try { result = await Promise.race([animate(), cancelled]); }
    finally {
      if (this.#transitionCancel === cancel) this.#transitionCancel = null;
      this.#transitionSurfacePixels = 0;
      source.width = 0; source.height = 0; target.width = 0; target.height = 0;
    }
    if (result) { this.renderEndpoint(to.scene, to.assets); this.#transitionCount += 1; }
    return result;
  }

  get metrics() { return Object.freeze({ frameCount: this.#frameCount, transitionCount: this.#transitionCount, quality: this.#quality, lastDraw: this.#lastDraw,
    backingPixels: this.#ctx.canvas.width * this.#ctx.canvas.height, maxCanvasPixels: this.#maxCanvasPixels,
    transitionSurfacePixels: this.#transitionSurfacePixels, totalCanvasPixels: this.#ctx.canvas.width * this.#ctx.canvas.height + this.#transitionSurfacePixels,
    decodedPixels: this.#decodedPixels, maxDecodedPixels: this.#maxDecodedPixels,
    withinCanvasBudget: this.#ctx.canvas.width * this.#ctx.canvas.height <= this.#maxCanvasPixels }); }
  dispose() { this.#disposed = true; this.#transitionCancel?.(); this.#transitionCancel = null; this.#lastDraw = null; }
}

export { DEFAULT_QUALITY as CINEMATIC_RENDER_QUALITY };
