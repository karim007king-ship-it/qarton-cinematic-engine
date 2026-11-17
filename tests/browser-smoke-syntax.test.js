import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("browser showcase inline module has valid JavaScript syntax", async () => {
  const html = await readFile(resolve(root, "examples/browser-smoke.html"), "utf8");
  const match = html.match(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/i);
  assert.ok(match, "browser showcase must contain an inline module script");

  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: match[1],
    encoding: "utf8"
  });

  assert.equal(
    checked.status,
    0,
    [checked.stdout, checked.stderr].filter(Boolean).join("\n") || "module syntax check failed"
  );
});


test("browser showcase drives all visual tracks from the rebased director clock", async () => {
  const html = await readFile(resolve(root, "examples/browser-smoke.html"), "utf8");
  const match = html.match(/<script\\s+type=["']module["']\\s*>([\\s\\S]*?)<\\/script>/i);
  assert.ok(match, "browser showcase must contain an inline module script");
  const tickStart = match[1].indexOf("async function tick(now)");
  const tickEnd = match[1].indexOf("\\n  async function show(", tickStart);
  assert.notEqual(tickStart, -1, "showcase must define its animation tick");
  assert.notEqual(tickEnd, -1, "showcase must define its scene transition handler");
  const tick = match[1].slice(tickStart, tickEnd);

  const directorUpdate = tick.indexOf("await director.update(now - startTime)");
  const cameraSample = tick.indexOf("sampleCameraTrack(cameraTrack, elapsed)");
  const particleSample = tick.indexOf("particles.sample(sampleTime)");
  assert.ok(directorUpdate >= 0, "tick must advance the director using host timestamps");
  assert.ok(cameraSample > directorUpdate, "camera sampling must happen after director clock rebasing");
  assert.ok(particleSample > directorUpdate, "particle sampling must happen after director clock rebasing");
  assert.match(tick, /elapsed = frame\\.timeMs;/, "visual tracks must use the director's logical time");
  assert.doesNotMatch(tick, /const elapsed = now - startTime;/, "visual tracks must not use raw wall-clock elapsed time");
});
