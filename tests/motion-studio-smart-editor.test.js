import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject } from "../examples/motion-studio-lab/studio-model.js";
import { CAMERA_MOTION_PRESETS, createCameraMotionProject } from "../examples/motion-studio-lab/studio-motion-presets.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = (project, atMs) => {
  const left = project.camera.find(frame => frame.atMs === atMs);
  assert.ok(left, `missing generated key at ${atMs}`);
  return left.value;
};

test("simple editor offers all six Arabic camera movements and defaults to Simple mode", async () => {
  const html = await readFile(resolve(root, "examples/motion-studio-lab/index.html"), "utf8");
  const css = await readFile(resolve(root, "examples/motion-studio-lab/studio.css"), "utf8");
  const js = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  for (const id of ["automatic", "simple", "professional"]) assert.match(html, new RegExp(`data-editor-mode-button="${id}"`));
  for (const [id, label] of [["zoom-in", "تقريب"], ["zoom-out", "إبعاد"], ["static", "كاميرا ثابتة"],
    ["pan-horizontal", "يمين ويسار"], ["pan-vertical", "أعلى وأسفل"], ["cinematic", "حركة مركبة"]]) {
    assert.match(html, new RegExp(`data-motion-preset="${id}"`));
    assert.match(html, new RegExp(label));
  }
  for (const id of ["motionSpeed", "motionStrength", "motionFocusX", "motionFocusY", "motionFromSeconds", "motionToSeconds", "undoMotionButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(js, /setEditorMode\("simple"\)/);
  assert.match(css, /data-editor-mode="professional"/);
});

test("camera preset generation is deterministic and preserves camera keys outside the selected interval", () => {
  const project = makeProject({ durationMs: 12_000, startZoom: 1, endZoom: 1.2, startX: 0, endX: 12, startY: 0, endY: 6 });
  const first = createCameraMotionProject(project, { preset: "zoom-in", fromSeconds: 2, toSeconds: 8, speed: 1.5, strength: 75, focusX: 70, focusY: 30 });
  const repeated = createCameraMotionProject(project, { preset: "zoom-in", fromSeconds: 2, toSeconds: 8, speed: 1.5, strength: 75, focusX: 70, focusY: 30 });
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.camera.map(frame => frame.atMs), [0, 2000, 4121, 8000, 12000]);
  assert.deepEqual(first.camera[0], project.camera[0]);
  assert.deepEqual(first.camera.at(-1), project.camera.at(-1));
  assert.ok(sample(first, 8000).zoom > sample(first, 2000).zoom);
  assert.notDeepEqual(sample(first, 8000), project.camera[1].value);
});

test("camera presets create zoom, pan, composite, and truly static results", () => {
  const project = makeProject({ durationMs: 10_000, startZoom: 1, endZoom: 1, startX: 0, endX: 0, startY: 0, endY: 0 });
  const options = { fromSeconds: 1, toSeconds: 9, strength: 80, focusX: 25, focusY: 70 };
  const zoomIn = createCameraMotionProject(project, { preset: "zoom-in", ...options });
  const zoomOut = createCameraMotionProject(project, { preset: "zoom-out", ...options });
  const horizontal = createCameraMotionProject(project, { preset: "pan-horizontal", ...options });
  const vertical = createCameraMotionProject(project, { preset: "pan-vertical", ...options });
  const composite = createCameraMotionProject(project, { preset: "cinematic", ...options });
  const still = createCameraMotionProject(project, { preset: "static", ...options });
  assert.ok(sample(zoomIn, 9000).zoom > sample(zoomIn, 1000).zoom);
  assert.ok(sample(zoomOut, 1000).zoom > sample(zoomOut, 9000).zoom);
  assert.notEqual(sample(horizontal, 1000).x, sample(horizontal, 9000).x);
  assert.notEqual(sample(vertical, 1000).y, sample(vertical, 9000).y);
  assert.ok(sample(composite, 9000).zoom > sample(composite, 1000).zoom);
  assert.notEqual(sample(composite, 1000).x, sample(composite, 9000).x);
  assert.equal(new Set(still.camera.filter(frame => frame.atMs >= 1000 && frame.atMs <= 9000)
    .map(frame => JSON.stringify(frame.value))).size, 1);
  assert.equal(CAMERA_MOTION_PRESETS.length, 6);
});

test("speed changes the generated easing midpoint, strength scales movement, and boundaries are validated", () => {
  const project = makeProject({ durationMs: 12_000, startZoom: 1, endZoom: 1, startX: 0, endX: 0, startY: 0, endY: 0 });
  const slow = createCameraMotionProject(project, { preset: "zoom-in", fromSeconds: 1, toSeconds: 11, speed: 0.5, strength: 50 });
  const fast = createCameraMotionProject(project, { preset: "zoom-in", fromSeconds: 1, toSeconds: 11, speed: 2, strength: 50 });
  const mild = createCameraMotionProject(project, { preset: "pan-horizontal", fromSeconds: 1, toSeconds: 11, strength: 20 });
  const strong = createCameraMotionProject(project, { preset: "pan-horizontal", fromSeconds: 1, toSeconds: 11, strength: 80 });
  assert.equal(slow.camera[2].atMs, 8071);
  assert.equal(fast.camera[2].atMs, 3500);
  assert.ok(Math.abs(sample(strong, 1000).x) > Math.abs(sample(mild, 1000).x));
  for (const bad of [
    { fromSeconds: 4, toSeconds: 4 }, { fromSeconds: -1, toSeconds: 5 },
    { fromSeconds: 1, toSeconds: 13 }, { fromSeconds: 1, toSeconds: 5, strength: 101 },
    { fromSeconds: 1, toSeconds: 5, speed: 0 }, { fromSeconds: 1, toSeconds: 5, focusX: 101 }
  ]) assert.throws(() => createCameraMotionProject(project, { preset: "zoom-in", ...bad }));
  assert.throws(() => createCameraMotionProject(project, { preset: "unknown" }));
});

test("compact editor shell keeps preview, scene thumbnails, and five touch sections inside one viewport", async () => {
  const html = await readFile(resolve(root, "examples/motion-studio-lab/index.html"), "utf8");
  const css = await readFile(resolve(root, "examples/motion-studio-lab/studio.css"), "utf8");
  const js = await readFile(resolve(root, "examples/motion-studio-lab/studio.js"), "utf8");
  for (const id of ["studioPreview", "previewSceneStrip", "fullscreenPreviewButton", "headerSaveButton", "headerUndoButton", "headerExportButton"]) {
    if (id === "fullscreenPreviewButton") assert.match(js, new RegExp(`id = "${id}"`));
    else assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const section of ["scenes", "motion", "audio", "effects", "more"]) {
    assert.match(html, new RegExp(`data-tool-panel="${section}"`));
    assert.match(html, new RegExp(`data-editor-section="${section}"`));
  }
  assert.match(html, /<nav class="bottom-dock"/);
  assert.match(js, /advancedProjectOptions/);
  assert.match(js, /خيارات الجودة والصيغة المتقدمة/);
  assert.match(html, /data-editor-section="more"[\s\S]*?<svg/);
  assert.match(js, /function mountCompactWorkspace\(\)/);
  assert.match(js, /function setEditorSection\(section\)/);
  assert.match(js, /fullscreenPreviewButton/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /overflow:hidden/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /min-height:\s*44px/);
});
