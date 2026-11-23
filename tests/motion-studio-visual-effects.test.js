import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, makeProjectFile, parseProjectFile } from "../examples/motion-studio-lab/studio-model.js";
import {
  addVisualEffect, compileVisualEffectsTrack, deleteVisualEffect, editVisualEffect,
  makeVisualEffectsTrack, moveVisualEffect, sampleVisualEffects, VISUAL_EFFECT_TYPES
} from "../examples/motion-studio-lab/studio-visual-effects-model.js";
import { compileCinematicEffects, drawCinematicEffects, sampleCinematicEffects } from "../src/effects/cinematic-effects.js";

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
  for (const id of ["visualEffectType", "addVisualEffect", "deleteVisualEffect", "visualEffectsTracks", "visualEffectStart", "visualEffectDuration", "visualEffectEasing", "visualEffectFrom", "visualEffectTo"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(host, /sampleVisualEffects\(visualEffectsCompiled, currentMs\)/);
  assert.match(host, /makeProjectFile\([^\n]*visualEffectsTrack/);
  assert.match(host, /visualEffectsTimeline\?\.setBusy\(busy\)/);
});
