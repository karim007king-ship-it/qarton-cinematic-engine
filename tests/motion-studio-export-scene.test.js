import assert from "node:assert/strict";
import test from "node:test";
import { compileProject } from "../packages/motion-studio/index.js";
import { compileCinematicAudioProject } from "../src/audio/cinematic-audio-core.js";
import { addVisualEffect, compileVisualEffectsTrack, makeVisualEffectsTrack } from "../examples/motion-studio-lab/studio-visual-effects-model.js";
import { projectForRaster } from "../examples/motion-studio-lab/studio-export-core.js";
import { compileCharacterTrack, makeCharacterTrack } from "../examples/motion-studio-lab/studio-character-track.js";
import { makeProject } from "../examples/motion-studio-lab/studio-model.js";
import { drawStudioScene } from "../examples/motion-studio-lab/studio-scene-renderer.js";

function context(width, height) {
  const operations = [];
  const gradient = { addColorStop: (...args) => operations.push(["addColorStop", ...args]) };
  const target = { canvas: { width, height }, operations };
  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === "createRadialGradient") return (...args) => { operations.push([key, ...args]); return gradient; };
      return (...args) => operations.push([key, ...args]);
    },
    set(object, key, value) { object[key] = value; return true; }
  });
}

test("preview and export share one compositor and absolute camera, character, dialogue, and effects samples", () => {
  const project = makeProject({ durationMs: 12_000, viewport: { width: 1080, height: 1920, fps: 24 },
    startZoom: 1, endZoom: 1.5, startX: 0, endX: 120, startY: 0, endY: -60 });
  const image = { image: "fixture" };
  const imageProvider = { get: () => image };
  const previewViewport = { width: 360, height: 640, fps: 24 };
  const exportViewport = { width: 720, height: 1280, fps: 24 };
  const previewProject = compileProject(projectForRaster(project, previewViewport), imageProvider);
  const exportProject = compileProject(projectForRaster(project, exportViewport), imageProvider);
  let effects = makeVisualEffectsTrack(77);
  effects = addVisualEffect(effects, project, "vignette", 1000);
  effects = addVisualEffect(effects, project, "shake", 2000);
  const previewEffects = compileVisualEffectsTrack(effects, projectForRaster(project, previewViewport));
  const exportEffects = compileVisualEffectsTrack(effects, projectForRaster(project, exportViewport));
  const characterTrack = makeCharacterTrack();
  characterTrack.keyframes = [
    { atMs: 0, values: { mouthOpen: 0, headRotation: 0 } },
    { atMs: 12_000, values: { mouthOpen: 0.2, headRotation: 8 } }
  ];
  const characterAnimation = compileCharacterTrack(characterTrack, project.durationMs);
  const audio = compileCinematicAudioProject({ durationMs: project.durationMs, tracks: [{ id: "dialogue", type: "dialogue", clips: [
    { id: "line", asset: "voice", startMs: 0, durationMs: 12_000, language: "ar",
      visemes: [{ atMs: 3000, viseme: "wide" }] }
  ] }] });

  for (const timeMs of [0, 3000, 7500, 12_000]) {
    const previewSample = audio.sample(timeMs);
    const exportSample = audio.sample(timeMs);
    const previewCtx = context(previewViewport.width, previewViewport.height);
    const exportCtx = context(exportViewport.width, exportViewport.height);
    const previewFrame = drawStudioScene({ ctx: previewCtx, compiledProject: previewProject, timeMs,
      characterAnimation, characterTrack, audioSample: previewSample, visualEffectsCompiled: previewEffects, viewport: previewViewport });
    const exportFrame = drawStudioScene({ ctx: exportCtx, compiledProject: exportProject, timeMs,
      characterAnimation, characterTrack, audioSample: exportSample, visualEffectsCompiled: exportEffects, viewport: exportViewport });
    assert.deepEqual(previewSample.dialogue, exportSample.dialogue, `dialogue sample stays shared at ${timeMs}ms`);
    assert.equal(exportFrame.camera.x, previewFrame.camera.x * 2, `camera pan scales with raster at ${timeMs}ms`);
    assert.equal(exportFrame.camera.zoom, previewFrame.camera.zoom, `camera zoom stays invariant at ${timeMs}ms`);
    assert.ok(previewCtx.operations.some(([name]) => name === "drawImage"));
    assert.ok(exportCtx.operations.some(([name]) => name === "fillText"), "the character compositor is shared with export");
  }
});

test("projects without audio and visual effects preserve their camera-only legacy frame", () => {
  const project = makeProject({ durationMs: 5000, viewport: { width: 720, height: 1280, fps: 24 },
    startZoom: 1, endZoom: 1.2, startX: 0, endX: 30, startY: 0, endY: 0 });
  const raster = { width: 360, height: 640, fps: 24 };
  const compiledProject = compileProject(projectForRaster(project, raster), { get: () => ({ image: true }) });
  const effects = compileVisualEffectsTrack(makeVisualEffectsTrack(), projectForRaster(project, raster));
  const characterTrack = makeCharacterTrack();
  const characterAnimation = compileCharacterTrack(characterTrack, project.durationMs);
  const audio = compileCinematicAudioProject({ durationMs: project.durationMs, tracks: [] });
  const ctx = context(raster.width, raster.height);
  const result = drawStudioScene({ ctx, compiledProject, timeMs: 2500, characterAnimation,
    characterTrack, audioSample: audio.sample(2500), visualEffectsCompiled: effects, viewport: raster });
  assert.equal(result.camera.zoom, 1.1);
  assert.equal(result.camera.x, 7.5);
  assert.equal(result.shake.x, 0);
  assert.ok(ctx.operations.some(([name]) => name === "drawImage"));
  assert.ok(!ctx.operations.some(([name]) => name === "fillText"), "old projects without a character track do not gain a character overlay");
});
