import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../examples/android-webview-diagnostics.html", import.meta.url), "utf8");

test("Android WebView diagnostics stay standalone and gesture-gate audio", () => {
  assert.match(page, /<!doctype html>/i);
  assert.match(page, /AbortController/);
  assert.match(page, /Image\.decode\(\)/);
  assert.match(page, /Web Animations API/);
  assert.match(page, /Page Visibility API/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /pagehide/);
  assert.match(page, /pageshow/);
  assert.match(page, /addEventListener\("click", async \(\) => \{/);
  assert.match(page, /audioContext\.resume\(\)/);
  assert.doesNotMatch(page, /autoplay\s*=/i);
  assert.doesNotMatch(page, /setInterval\s*\(/);
});

test("diagnostics report failures without assuming optional APIs exist", () => {
  assert.match(page, /typeof HTMLImageElement\.prototype\.decode === "function"/);
  assert.match(page, /typeof Element\.prototype\.animate === "function"/);
  assert.match(page, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(page, /navigator\.clipboard\.writeText/);
});

test("diagnostics collect bounded frame-pacing metrics without claiming a benchmark", () => {\n  assert.match(page, /sampleDurationMs/);\n  assert.match(page, /averageFps/);\n  assert.match(page, /p95FrameMs/);\n  assert.match(page, /framesOver25MsRatio/);\n  assert.match(page, /Foreground-only rough measurement/);\n  assert.match(page, /timestamp - startedAt >= 1200/);\n});\n