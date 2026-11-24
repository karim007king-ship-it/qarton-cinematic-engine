import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, makeProjectFile, parseProjectFile } from "../examples/motion-studio-lab/studio-model.js";
import {
  addVisualEffect, compileVisualEffectsTrack, deleteVisualEffect, editVisualEffect,
  makeVisualEffectsTrack, moveVisualEffect, sampleVisualEffects, VISUAL_EFFECT_TYPES
} from "../examples/motion-studio-lab/studio-visual-effects-model.js";
import { compileCinematicEffects, drawCinematicEffects, sampleCinematicEffects } from "../src/effects/cinematic-effects.js";
import { createCameraTrack, sampleCameraTrack } from "../src/camera/camera-track.js";
import { projectForRaster, exportViewportFor } from "../examples/motion-studio-lab/studio-export-core.js";
import { compileAudioTracks, makeAudioTracks, setAudioViseme } from "../examples/motion-studio-lab/studio-audio-model.js";

const project = (options = {}) => makeProject({ durationMs: 12_000, viewport: { width: 720, height: 1280, fps: 24 }, startZoom: 1, endZoom: 1, startX: 0, endX: 0, startY: 0, endY: 0, ...options });
const clip = (type = "fade", overrides = {}) => ({
  id: "fx", type, atMs: 1000, durationMs: 1000,
  from: { opacity: 0, color: "#000000" }, to: { opacity: 1, color: "#ffffff" },
  easing: "linear", ...overrides
});

test("Visual Effects editor defaults and project dimensions are strictly integral", () => {
  assert.deepEqual(makeVisualEffectsTrack(), { version: 1, seed: 1, clips: [] });
  assert.throws(() => makeVisualEffectsTrack(1.5), /Seed/);
  assert.throws(() => makeVisualEffectsTrack(Number.MAX_SAFE_INTEGER + 1), /Seed/);
  for (const viewport of [
    { width: 720.5, height: 1280, fps: 24 },
    { width: 720, height: 1280.5, fps: 24 },
    { width: 0, height: 1280, fps: 24 }
  ]) assert.throws(() => compileVisualEffectsTrack(makeVisualEffectsTrack(), { ...project(), viewport }));
});

test("all seven effect types can be added and overlap sampling is stable", () => {
  let track = makeVisualEffectsTrack(42);
  for (const type of VISUAL_EFFECT_TYPES) track = addVisualEffect(track, project(), type, 2000);
  assert.equal(track.clips.length, 7);
  const compiled = compileVisualEffectsTrack(track, project());
  assert.deepEqual(sampleVisualEffects(compiled, 2400), sampleVisualEffects(compiled, 2400));
  assert.equal(sampleVisualEffects(compiled, 2400).timeMs, 2400);
  const overlapped = addVisualEffect(track, project(), "vignette", 2200);
  assert.equal(sampleVisualEffects(compileVisualEffectsTrack(overlapped, project()), 3200).vignette, 0.65);
});

test("effect start, end, zero-duration, and integer time boundaries are exact", () => {
  const compiled = compileCinematicEffects({ version: "CinematicEffectsV1", width: 720, height: 1280,
    durationMs: 3000, seed: 1, layers: [], clips: [clip("fade", { durationMs: 1000 })] });
  assert.equal(sampleCinematicEffects(compiled, 999).fade.opacity, 1);
  assert.equal(sampleCinematicEffects(compiled, 1000).fade.opacity, 0);
  assert.equal(sampleCinematicEffects(compiled, 2000).fade.opacity, 1);
  const instantClip = clip("fade", { atMs: 3000, durationMs: 0, from: { opacity: 1, color: "#000000" }, to: { opacity: 0, color: "#000000" } });
  const instant = compileCinematicEffects({ version: "CinematicEffectsV1", width: 720, height: 1280,
    durationMs: 3000, seed: 1, layers: [], clips: [instantClip] });
  assert.equal(sampleCinematicEffects(instant, 2999).fade.opacity, 1);
  assert.equal(sampleCinematicEffects(instant, 3000).fade.opacity, 0);
  assert.throws(() => compileCinematicEffects({ version: "CinematicEffectsV1", width: 720.5, height: 1280, durationMs: 3000, layers: [], clips: [] }));
});

test("from/to schemas reject unknown keys and fractional shake seeds", () => {
  const base = makeVisualEffectsTrack();
  const withFade = addVisualEffect(base, project(), "fade", 0);
  const fade = withFade.clips[0];
  assert.throws(() => compileVisualEffectsTrack({ ...withFade, clips: [{ ...fade, from: { ...fade.from, unexpected: 1 } }] }, project()), /unknown field/);
  assert.throws(() => compileVisualEffectsTrack({ ...withFade, unexpected: true }, project()), /مسار/);
  const shake = addVisualEffect(base, project(), "shake", 0).clips[0];
  assert.throws(() => compileVisualEffectsTrack({ ...base, clips: [{ ...shake, to: { ...shake.to, seed: 2.5 } }] }, project()), /safe integer/);
  assert.throws(() => editVisualEffect(withFade, project(), fade.id, { atMs: 1.25 }));
  assert.throws(() => moveVisualEffect(withFade, project(), fade.id, 1.25));
  assert.throws(() => deleteVisualEffect(withFade, project(), "missing"));
});

test("overlapping seeded camera shakes are deterministic after seek and replay", () => {
  let track = addVisualEffect(makeVisualEffectsTrack(77), project(), "shake", 500);
  track = editVisualEffect(track, project(), track.clips[0].id, { durationMs: 5000 });
  track = addVisualEffect(track, project(), "shake", 1500);
  const compiled = compileVisualEffectsTrack(track, project());
  const first = sampleVisualEffects(compiled, 2400);
  sampleVisualEffects(compiled, 8000);
  const afterSeek = sampleVisualEffects(compiled, 2400);
  const replaySample = sampleVisualEffects(compiled, 0);
  assert.deepEqual(afterSeek, first);
  assert.deepEqual(replaySample, sampleVisualEffects(compiled, 0));
  assert.notDeepEqual(first.shake, { x: 0, y: 0, rotation: 0 });
});

test("Vignette, Letterbox, Tint, and Flash can be reduced or removed under overlap", () => {
  const base = makeVisualEffectsTrack();
  let track = base;
  for (const type of ["vignette", "letterbox", "tint", "flash"]) track = addVisualEffect(track, project(), type, 0);
  const ids = Object.fromEntries(track.clips.map(item => [item.type, item.id]));
  track = editVisualEffect(track, project(), ids.vignette, { to: { intensity: 0.1 } });
  track = editVisualEffect(track, project(), ids.letterbox, { to: { ratio: 0.02 } });
  track = editVisualEffect(track, project(), ids.tint, { to: { strength: 0.05 } });
  track = editVisualEffect(track, project(), ids.flash, { to: { intensity: 0.05 } });
  let sample = sampleVisualEffects(compileVisualEffectsTrack(track, project()), 1000);
  assert.equal(sample.vignette, 0.1);
  assert.equal(sample.letterbox, 0.02);
  assert.ok(Math.abs(sample.tint.strength - 0.05) < 1e-12);
  assert.ok(Math.abs(sample.flash.intensity - 0.05) < 1e-12);
  track = deleteVisualEffect(track, project(), ids.vignette);
  track = deleteVisualEffect(track, project(), ids.letterbox);
  track = deleteVisualEffect(track, project(), ids.tint);
  track = deleteVisualEffect(track, project(), ids.flash);
  sample = sampleVisualEffects(compileVisualEffectsTrack(track, project()), 1000);
  assert.equal(sample.vignette, 0);
  assert.equal(sample.letterbox, 0);
  assert.equal(sample.tint.strength, 0);
  assert.equal(sample.flash.intensity, 0);
});

test("legacy camera results stay identical and raster changes scale camera translation", () => {
  const legacy = project({ startX: 80, endX: -40, startY: 32, endY: -16, startZoom: 1.1, endZoom: 1.4 });
  const legacyCamera = createCameraTrack(legacy.camera.map(({ atMs, value }) => ({ atMs, ...value })));
  const plain = compileVisualEffectsTrack(makeVisualEffectsTrack(), legacy);
  assert.deepEqual(sampleVisualEffects(plain, 4300).camera, sampleCameraTrack(legacyCamera, 4300));
  const previewRaster = { width: 540, height: 960, fps: 24 };
  const exportRaster = exportViewportFor(legacy.viewport, "economy");
  const preview = compileVisualEffectsTrack(makeVisualEffectsTrack(), projectForRaster(legacy, previewRaster));
  const exported = compileVisualEffectsTrack(makeVisualEffectsTrack(), projectForRaster(legacy, exportRaster));
  const a = sampleVisualEffects(preview, 4300).camera;
  const b = sampleVisualEffects(exported, 4300).camera;
  assert.ok(Math.abs(b.x / exportRaster.width - a.x / previewRaster.width) < 1e-12);
  assert.ok(Math.abs(b.y / exportRaster.height - a.y / previewRaster.height) < 1e-12);
  assert.equal(a.zoom, b.zoom);
  assert.equal(a.rotation, b.rotation);
});

test("dialogue Viseme mouth samples are shared by absolute scene time for replay and export", () => {
  let tracks = makeAudioTracks();
  tracks[0].clips.push({ id: "line", asset: "voice", startMs: 1000, durationMs: 2000, language: "ar", volume: 1, loop: false });
  tracks = setAudioViseme(tracks, 12_000, "audio-dialogue", "line", 500, "wide");
  const compiled = compileAudioTracks(tracks, 12_000);
  const first = compiled.sample(1600).dialogue[0].mouthOpen;
  assert.equal(first, 1);
  assert.equal(compiled.sample(9000).dialogue.length, 0);
  assert.equal(compiled.sample(1600).dialogue[0].mouthOpen, first);
});

test("project JSON saves effects, loads legacy projects, and rejects malformed effect records", () => {
  const baseProject = project();
  const track = addVisualEffect(makeVisualEffectsTrack(9), baseProject, "tint", 1000);
  const saved = makeProjectFile(baseProject, null, undefined, null, [], [], 1, track);
  assert.deepEqual(parseProjectFile(JSON.stringify(saved)).visualEffectsTrack, track);
  const legacy = makeProjectFile(baseProject);
  assert.deepEqual(parseProjectFile(JSON.stringify(legacy)).visualEffectsTrack, makeVisualEffectsTrack());
  const malformed = structuredClone(saved);
  malformed.visualEffectsTrack.clips[0].to.unexpected = 1;
  assert.throws(() => parseProjectFile(JSON.stringify(malformed)), /غير صالح/);
});

test("Canvas state restores when an effect layer drawImage throws", () => {
  const compiled = compileCinematicEffects({ version: "CinematicEffectsV1", width: 32, height: 32,
    durationMs: 1000, layers: [{ id: "broken", assetId: "broken" }], clips: [] });
  const sample = sampleCinematicEffects(compiled, 0);
  const state = { saves: 0, restores: 0 };
  const context = new Proxy({
    save() { state.saves++; }, restore() { state.restores++; }, translate() {}, rotate() {}, scale() {},
    drawImage() { throw new Error("broken source image"); }, fillRect() {}, createRadialGradient() { return { addColorStop() {} }; }
  }, { set(target, key, value) { target[key] = value; return true; } });
  assert.throws(() => drawCinematicEffects(context, sample, { broken: {} }), /broken source image/);
  assert.equal(state.saves, 1);
  assert.equal(state.restores, 1);
});

test("Motion Studio host exposes effect controls and uses the shared scene time", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../examples/motion-studio-lab/index.html", import.meta.url), "utf8");
  const host = await readFile(new URL("../examples/motion-studio-lab/studio.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../examples/motion-studio-lab/studio-scene-renderer.js", import.meta.url), "utf8");
  for (const id of ["visualEffectType", "addVisualEffect", "deleteVisualEffect", "visualEffectsTracks", "visualEffectStart", "visualEffectDuration", "visualEffectEasing", "visualEffectFrom", "visualEffectTo"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(renderer, /sampleVisualEffects\(visualEffectsCompiled, timeMs\)/);
  assert.match(host, /makeProjectFile\([^\n]*visualEffectsTrack/);
  assert.match(host, /audioSample: exportAudio\.sample\(projectMs\)/);
  assert.match(host, /compileAudioTracks\(audioTracks, exportCompiled\.durationMs\)/);
  assert.match(host, /visualEffectsTimeline\?\.setBusy\(busy\)/);
});
