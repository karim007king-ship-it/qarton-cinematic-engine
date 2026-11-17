import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("diagnostics collect bounded frame-pacing metrics without claiming a benchmark", () => {
  assert.match(page, /sampleDurationMs/);
  assert.match(page, /averageFps/);
  assert.match(page, /p95FrameMs/);
  assert.match(page, /framesOver25MsRatio/);
  assert.match(page, /Foreground-only rough measurement/);
  assert.match(page, /timestamp - startedAt >= 1200/);
});

test("audio lifecycle and optional resource hints are observable without autoplay", () => {
  assert.match(page, /audio-context-statechange/);
  assert.match(page, /audio-sample-ended/);
  assert.match(page, /audio-sample-started/);
  assert.match(page, /audioContextState/);
  assert.match(page, /deviceMemoryGb/);
  assert.match(page, /usedJSHeapSize/);
  assert.match(page, /not native Android RAM or GPU-memory measurements/);
  assert.match(page, /AudioContext did not enter running state/);
});

test("background lifecycle requests audio suspension and never auto-resumes on foreground", () => {
  assert.match(page, /suspendAudioForBackground\("visibilitychange"\)/);
  assert.match(page, /suspendAudioForBackground\("pagehide"\)/);
  assert.match(page, /audio-suspend-request/);
  assert.match(page, /audio-suspend-complete/);
  assert.match(page, /audio-suspend-error/);
  assert.doesNotMatch(page, /visibilityState === "visible".*audioContext/);
});


test("HTMLAudio diagnostics require a tap and expose play, pause and resume", () => {
  assert.match(page, /id="html-audio"/);
  assert.match(page, /id="html-audio-toggle"/);
  assert.match(page, /new Audio\(createToneWavDataUrl\(\)\)/);
  assert.match(page, /await htmlAudio\.play\(\)/);
  assert.match(page, /htmlAudio\.pause\(\)/);
  assert.match(page, /html-audio-play-resolved/);
  assert.match(page, /html-audio-ended/);
  assert.match(page, /data:audio\/wav;base64,/);
});

test("background lifecycle pauses HTMLAudio without automatic foreground resume", () => {
  assert.match(page, /pauseHTMLAudioForBackground\(source\)/);
  assert.match(page, /pauseHTMLAudioForBackground\(source\);/);
  const pageshow = page.match(/window\.addEventListener\("pageshow",[\s\S]*?\n  \}\);/);
  assert.ok(pageshow, "diagnostics must observe pageshow");
  assert.doesNotMatch(pageshow[0], /htmlAudio\.play\(\)/);
});


test("diagnostic inline script has valid JavaScript syntax", () => {
  const match = page.match(/<script>([\\s\\S]*?)<\\/script>/i);
  assert.ok(match, "diagnostic page must contain an inline script");
  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: match[1],
    encoding: "utf8"
  });
  assert.equal(
    checked.status,
    0,
    [checked.stdout, checked.stderr].filter(Boolean).join("\\n") || "diagnostic script syntax check failed"
  );
});
