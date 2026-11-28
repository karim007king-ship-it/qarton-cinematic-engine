import { drawTextCinematicScene } from "../character/text-cinematic-scene.js";
import { drawCinematicAtmosphere, sampleCinematicDirector } from "../effects/cinematic-director.js";
import { composeCameraPose, sampleCameraTrack } from "../camera/camera-track.js";

const DEFAULT_QUALITY = Object.freeze({ low: 0.5, medium: 0.75, high: 1 });

function drawable(image) {
  return image && Number(image.width ?? image.naturalWidth) > 0 && Number(image.height ?? image.naturalHeight);
}

function drawImageFit(ctx, image, width, height, fit = "cover") {
  if (!drawable(image)) return false;
  const iw = Number(image.width ?? image.naturalWidth), ih = Number(image.height ?? image.naturalHeight);
  if (fit === "fill") { ctx.drawImage(image, 0, 0, width, height); return true; }
  if (fit === "contain") {
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
  ctx.save();
  ctx.translate(width / 2 + pose.x, height / 2 + pose.y);
  ctx.rotate((pose.rotation ?? 0) * Math.PI / 180);
  ctx.scale(pose.zoom ?? 1, pose.zoom ?? 1);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = "#090a0d";
  ctx.fillRect(0, 0, width, height);
  const parallax = direction?.parallaxLayers ?? [];
  const layers = [...scene.backgrounds].sort((a, b) => a.z - b.z);
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
    drawImageFit(ctx, image, width, height, layer.fit ?? "cover");
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
  #disposed = false;
  #frameCount = 0;
  #transitionCount = 0;
  #lastDraw = null;
  #transitionCancel = null;

  constructor(canvasOrContext, { quality = "medium", maxCanvasPixels = 2_400_000 } = {}) {
    this.#ctx = canvasOrContext?.getContext ? canvasOrContext.getContext("2d", { alpha: false }) : canvasOrContext;
    if (!this.#ctx?.canvas || typeof this.#ctx.drawImage !== "function") throw new TypeError("CinematicRenderer needs a Canvas or 2D context");
    if (!Object.hasOwn(DEFAULT_QUALITY, quality)) throw new TypeError("quality must be low, medium, or high");
    if (!Number.isSafeInteger(maxCanvasPixels) || maxCanvasPixels < 1) throw new RangeError("maxCanvasPixels must be a positive integer");
    this.#quality = quality;
    const canvas = this.#ctx.canvas;
    canvas.dataset && (canvas.dataset.qartonQuality = quality);
    // Keep the authored 720×1280 coordinate system stable; silently resizing
    // the backing store would misalign the existing effects core. Hosts can
    // choose a lower-resolution canvas before construction if required.
    this.#maxCanvasPixels = maxCanvasPixels;
    this.#ctx.imageSmoothingEnabled = true;
    this.#ctx.imageSmoothingQuality = quality === "high" ? "high" : quality === "low" ? "low" : "medium";
  }

  render(frame) {
    if (this.#disposed) return false;
    if (!frame?.scene?.textScene || !Number.isFinite(frame.timeMs) || !(frame.assets instanceof Map)) throw new TypeError("A Runtime frame with compiled text scene and decoded assets is required");
    const { scene, timeMs, assets, camera, direction } = frame;
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
      characterGeometry: poseStats.characterGeometry,
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
    const sampledCamera = scene.camera.mode === "manual" && scene.camera.keyframes
      ? sampleCameraTrack(scene.camera.keyframes, timeMs) : direction.effects.camera;
    const pose = adaptCamera(composeCameraPose(sampledCamera, direction.effects.shake), width, height);
    const camera = { ...pose, zoom: pose.zoom * direction.shotScale };
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
    const makeSurface = () => {
      const surface = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : canvas.ownerDocument.createElement("canvas");
      surface.width = width; surface.height = height; return surface;
    };
    const source = makeSurface(), target = makeSurface();
    source.getContext("2d").drawImage(canvas, 0, 0, width, height);
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
        if (progress < 0.5) { ctx.globalAlpha = 1 - progress * 2; ctx.drawImage(source, 0, 0); }
        else { ctx.globalAlpha = (progress - 0.5) * 2; ctx.drawImage(target, 0, 0); }
      } else {
        ctx.drawImage(source, 0, 0);
        if (type === "focus") {
          const focus = to.scene.characters.find(item => item.id === (to.scene.dialogue[0]?.speakerId ?? to.scene.characters[0]?.id));
          const x = (focus?.x ?? .5) * width, y = (focus?.y ?? .5) * height;
          const radius = Math.hypot(width, height) * progress;
          ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(target, 0, 0); ctx.restore();
        } else {
          ctx.globalAlpha = progress; ctx.drawImage(target, 0, 0);
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
    const result = await Promise.race([animate(), cancelled]);
    if (this.#transitionCancel === cancel) this.#transitionCancel = null;
    if (result) { this.renderEndpoint(to.scene, to.assets); this.#transitionCount += 1; }
    return result;
  }

  get metrics() { return Object.freeze({ frameCount: this.#frameCount, transitionCount: this.#transitionCount, quality: this.#quality, lastDraw: this.#lastDraw,
    backingPixels: this.#ctx.canvas.width * this.#ctx.canvas.height, withinCanvasBudget: this.#ctx.canvas.width * this.#ctx.canvas.height <= this.#maxCanvasPixels }); }
  dispose() { this.#disposed = true; this.#transitionCancel?.(); this.#transitionCancel = null; this.#lastDraw = null; }
}

export { DEFAULT_QUALITY as CINEMATIC_RENDER_QUALITY };
