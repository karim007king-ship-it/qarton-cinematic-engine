import { compileCinematicEffects, sampleCinematicEffects, drawCinematicEffects } from "./cinematic-effects.js";
import { createParticleField } from "./particle-field.js";
import { sampleFog } from "./atmosphere.js";
import { clamp } from "../motion/easing.js";

export const CINEMATIC_MOODS = Object.freeze({
  calm: Object.freeze({ label: "حوار هادئ", vignette: 0.16, tint: "#d5ae61", tintStrength: 0.08, fog: 0, parallax: 3, transition: "crossfade" }),
  emotional: Object.freeze({ label: "مشهد عاطفي", vignette: 0.3, tint: "#c77978", tintStrength: 0.13, fog: 0, parallax: 5, transition: "focus" }),
  mystery: Object.freeze({ label: "غموض", vignette: 0.5, tint: "#61799b", tintStrength: 0.2, fog: 0.48, dust: 0.08, blur: 0.45, parallax: 12, transition: "through-black" }),
  fear: Object.freeze({ label: "خوف", vignette: 0.52, tint: "#51617b", tintStrength: 0.17, fog: 0.32, smoke: 0.2, shake: 2.2, blur: 0.65, parallax: 16, transition: "through-black" }),
  confrontation: Object.freeze({ label: "مواجهة", vignette: 0.34, tint: "#a64d3a", tintStrength: 0.12, letterbox: 0.055, shake: 1.1, parallax: 7, transition: "crossfade" }),
  sad: Object.freeze({ label: "حزين", vignette: 0.36, tint: "#526784", tintStrength: 0.16, fog: 0.12, blur: 0.25, parallax: 3, transition: "through-black" }),
  heroic: Object.freeze({ label: "بطولي", vignette: 0.2, tint: "#d5ae61", tintStrength: 0.15, rays: 0.42, parallax: 18, transition: "through-light" }),
  siege: Object.freeze({ label: "حصار وخطر", vignette: 0.4, tint: "#a9432e", tintStrength: 0.18, smoke: 0.42, fire: 0.32, rain: 0.16, shadows: 0.25, shake: 3.4, blur: 0.3, parallax: 24, transition: "through-light" })
});

export const CINEMATIC_SHOTS = Object.freeze({ wide: 0.9, medium: 1, close: 1.14 });
export const CINEMATIC_TRANSITIONS = Object.freeze(["cut", "crossfade", "through-black", "through-light", "focus"]);
const PRIVATE = new WeakMap();
const BLUR_SURFACES = new WeakMap();
const clampUnit = value => clamp(value, 0, 1);

function applySoftBlur(ctx, amount) {
  const target = ctx.canvas;
  const width = target.width, height = target.height;
  let surface = BLUR_SURFACES.get(target);
  const width2 = Math.max(1, Math.ceil(width / 2)), height2 = Math.max(1, Math.ceil(height / 2));
  if (!surface || surface.width !== width2 || surface.height !== height2) {
    surface = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width2, height2) : target.ownerDocument?.createElement?.("canvas");
    if (!surface) return false;
    surface.width = width2; surface.height = height2; BLUR_SURFACES.set(target, surface);
  }
  const buffer = surface.getContext("2d", { alpha: false });
  if (!buffer) return false;
  buffer.setTransform(1, 0, 0, 1, 0, 0); buffer.clearRect(0, 0, width2, height2); buffer.drawImage(target, 0, 0, width2, height2);
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.filter = `blur(${Math.min(3, amount * 2)}px)`; ctx.clearRect(0, 0, width, height); ctx.drawImage(surface, 0, 0, width, height);
  } finally { ctx.restore(); }
  return true;
}

function effectClip(id, type, durationMs, from, to, atMs = 0) {
  const easing = type === "shake" ? "linear" : "easeInOutCubic";
  return { id, type, atMs, durationMs: Math.max(0, Math.min(durationMs, 900)), from, to, easing };
}

/** Compile a reusable, data-driven direction profile using the shared effects core. */
export function compileTextCinematicDirection({ durationMs = 8000, mood = "calm", seed = 1, shot = "medium", timeOfDay = "day", enabled = true, strength = 0.75 } = {}) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 3_600_000) throw new RangeError("Cinematic duration must be a positive integer in milliseconds");
  if (!Object.hasOwn(CINEMATIC_MOODS, mood)) throw new TypeError("Unknown cinematic mood");
  if (!Object.hasOwn(CINEMATIC_SHOTS, shot)) throw new TypeError("Unknown cinematic shot size");
  if (!Number.isSafeInteger(seed) || seed < -1_000_000 || seed > 1_000_000) throw new RangeError("Cinematic seed is out of range");
  if (typeof enabled !== "boolean" || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError("Cinematic effect strength must be between 0 and 1");
  if (!["day", "night", "dusk"].includes(timeOfDay)) throw new TypeError("Time of day must be day, dusk, or night");
  const preset = CINEMATIC_MOODS[mood];
  const amount = enabled ? strength : 0;
  const clips = [];
  if (amount) {
    clips.push(effectClip("fade-in", "fade", durationMs, { opacity: 0, color: "#000000" }, { opacity: 1, color: "#000000" }));
    clips.push(effectClip("vignette", "vignette", durationMs, { intensity: 0 }, { intensity: preset.vignette * amount }));
    clips.push(effectClip("tint", "tint", durationMs, { strength: 0, color: preset.tint }, { strength: preset.tintStrength * amount, color: preset.tint }));
    if (preset.letterbox) clips.push(effectClip("letterbox", "letterbox", durationMs, { ratio: 0 }, { ratio: preset.letterbox * amount }));
    if (preset.shake) clips.push(effectClip("shake", "shake", durationMs, { amplitude: preset.shake * amount, frequencyHz: 3.6, seed }, { amplitude: 0, frequencyHz: 3.6, seed }, Math.min(400, durationMs - 1)));
    if (timeOfDay !== "day") {
      const color = timeOfDay === "night" ? "#233a63" : "#a65d45";
      clips.push(effectClip("time-of-day", "tint", durationMs, { strength: 0, color }, { strength: (timeOfDay === "night" ? 0.18 : 0.1) * amount, color }));
    }
  }
  // Effect-core layers are composited as full-frame overlays. Keep parallax as
  // camera metadata so it cannot cover the scene with opaque layer colors.
  const compiled = compileCinematicEffects({ version: "CinematicEffectsV1", width: 720, height: 1280, durationMs, seed,
    camera: [{ atMs: 0 }], layers: [], clips });
  const profile = Object.freeze({ mood, shot, timeOfDay, transition: enabled ? preset.transition : "cut", shotScale: enabled ? CINEMATIC_SHOTS[shot] : 1,
    focusX: 0.5, parallax: preset.parallax * amount, enabled, strength: amount });
  const fields = [];
  const budget = amount ? 28 : 0;
  const addParticles = (kind, intensity, color, options = {}) => {
    if (!intensity || !budget) return;
    const field = createParticleField({ count: Math.round(budget * intensity), seed: seed + fields.length * 37,
      width: 720, height: 1280, lifetimeMs: options.lifetimeMs ?? 5600,
      speedMin: options.speedMin ?? 8, speedMax: options.speedMax ?? 34,
      gravity: options.gravity ?? 0, profile: { maxParticles: 32 } });
    fields.push(Object.freeze({ kind, intensity: clampUnit(intensity * amount), color, field }));
  };
  addParticles("dust", preset.dust ?? (mood === "calm" ? 0.06 : 0), "#ead8b0", { speedMin: 2, speedMax: 10, lifetimeMs: 7000 });
  addParticles("smoke", preset.smoke, "#7b7c85", { speedMin: 3, speedMax: 14, lifetimeMs: 7800 });
  addParticles("rain", preset.rain, "#b6c6d8", { speedMin: 80, speedMax: 160, lifetimeMs: 1600, gravity: 30 });
  const atmosphere = Object.freeze({ fog: (preset.fog ?? 0) * amount, fire: (preset.fire ?? 0) * amount,
    rays: (preset.rays ?? 0) * amount, shadows: (preset.shadows ?? 0) * amount,
    blur: (preset.blur ?? 0) * amount, fogColor: timeOfDay === "night" ? "#a8bfd4" : "#d5c2a5", fields: Object.freeze(fields) });
  const result = Object.freeze({ version: "QartonCinematicDirectionV1", durationMs, seed, profile, compiledEffects: compiled });
  PRIVATE.set(result, atmosphere);
  return result;
}

/** All values are derived from absolute scene time, so seek/replay gives identical frames. */
export function sampleCinematicDirector(director, timeMs) {
  if (!director || director.version !== "QartonCinematicDirectionV1") throw new TypeError("A compiled QARTON cinematic direction is required");
  const at = clamp(timeMs, 0, director.durationMs);
  const effects = sampleCinematicEffects(director.compiledEffects, at);
  const atmosphere = PRIVATE.get(director);
  const parallaxAmount = director.profile.parallax;
  const parallaxLayers = Object.freeze(parallaxAmount ? [
    Object.freeze({ id: "director-far", depth: .18, x: Math.sin(at * .00018) * -parallaxAmount * .08, y: Math.cos(at * .00014) * .15 }),
    Object.freeze({ id: "director-near", depth: .82, x: Math.sin(at * .00018) * parallaxAmount * .08, y: Math.cos(at * .00014) * -.15 })
  ] : []);
  const fog = atmosphere.fog ? sampleFog({ timeMs: at, density: atmosphere.fog, driftX: 14, driftY: -2, speed: 0.012, profile: { tier: "low" } }) : null;
  const fields = atmosphere.fields.map(layer => Object.freeze({ ...layer, particles: layer.field.sample(at) }));
  return Object.freeze({ timeMs: at, effects, parallaxLayers, fog, fields: Object.freeze(fields), fire: atmosphere.fire,
    rays: atmosphere.rays, shadows: atmosphere.shadows, blur: atmosphere.blur, fogColor: atmosphere.fogColor,
    shot: director.profile.shot, shotScale: director.profile.shotScale, focusX: director.profile.focusX,
    transition: director.profile.transition, enabled: director.profile.enabled });
}

function hexRgba(hex, alpha) {
  const value = hex.replace(/^#/u, "");
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${clampUnit(alpha)})`;
}

/** Draw lightweight atmospheric overlays with bounded deterministic particles. */
export function drawCinematicAtmosphere(ctx, sample) {
  if (!ctx?.canvas || !sample) throw new TypeError("Canvas context and cinematic sample are required");
  const { width, height } = ctx.canvas;
  if (sample.blur > 0.05) applySoftBlur(ctx, sample.blur);
  const scaleX = width / 720, scaleY = height / 1280;
  ctx.save();
  try {
    if (sample.fog?.density > 0) {
      for (let index = 0; index < 3; index += 1) {
        const x = ((width * (0.25 + index * 0.28) + sample.fog.offsetX * scaleX) % width + width) % width;
        const y = height * (0.55 + index * 0.1) + sample.fog.offsetY * scaleY;
        const radius = width * (0.42 + index * 0.08);
        const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
        gradient.addColorStop(0, hexRgba(sample.fogColor, sample.fog.density * 0.18));
        gradient.addColorStop(1, hexRgba(sample.fogColor, 0));
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      }
    }
    for (const field of sample.fields) {
      ctx.save(); ctx.globalAlpha = field.intensity;
      if (field.kind === "rain") {
        ctx.strokeStyle = field.color; ctx.lineWidth = Math.max(1, width / 720);
        for (const particle of field.particles) {
          ctx.globalAlpha = field.intensity * particle.opacity; ctx.beginPath();
          const px = particle.x * scaleX, py = particle.y * scaleY, radius = particle.radius * scaleY;
          ctx.moveTo(px, py); ctx.lineTo(px - radius * 3, py + radius * 12); ctx.stroke();
        }
      } else {
        for (const particle of field.particles) {
          const px = particle.x * scaleX, py = particle.y * scaleY;
          const radius = (field.kind === "smoke" ? particle.radius * 720 / 42 : particle.radius * 720 / 260) * scaleX;
          const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
          gradient.addColorStop(0, hexRgba(field.color, particle.opacity * (field.kind === "smoke" ? 0.24 : 0.5)));
          gradient.addColorStop(1, hexRgba(field.color, 0)); ctx.fillStyle = gradient;
          ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        }
      }
      ctx.restore();
    }
    if (sample.fire > 0) {
      const gradient = ctx.createRadialGradient(width * .5, height * 1.03, 0, width * .5, height * .84, height * .56);
      gradient.addColorStop(0, `rgba(255,111,35,${sample.fire * .35})`); gradient.addColorStop(.5, `rgba(233,74,33,${sample.fire * .18})`); gradient.addColorStop(1, "rgba(180,44,25,0)");
      ctx.fillStyle = gradient; ctx.fillRect(0, height * .45, width, height * .55);
    }
    if (sample.rays > 0) {
      ctx.save(); ctx.globalAlpha = sample.rays * .13; ctx.fillStyle = "#f6dfad";
      const originX = width * .72, originY = height * .08;
      for (let index = 0; index < 5; index += 1) {
        const spread = width * (.04 + index * .023); ctx.beginPath(); ctx.moveTo(originX, originY);
        ctx.lineTo(originX - spread, height * .72); ctx.lineTo(originX + spread * 1.7, height * .72); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    if (sample.shadows > 0) {
      ctx.save(); ctx.globalAlpha = sample.shadows * .26; ctx.fillStyle = "#09080b";
      for (const x of [.28, .5, .72]) { ctx.beginPath(); ctx.ellipse(width * x, height * .84, width * .14, height * .025, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  } finally { ctx.restore(); }
  drawCinematicEffects(ctx, sample.effects);
  return true;
}
