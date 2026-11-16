import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const showcaseUrl = new URL("../examples/browser-smoke.html", import.meta.url);
const entryUrl = new URL("../src/index.js", import.meta.url);

test("browser showcase module script has valid JavaScript syntax", () => {
  const html = readFileSync(showcaseUrl, "utf8");
  const scripts = [...html.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, "expected exactly one module script in browser showcase");

  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: scripts[0][1],
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "browser showcase syntax check failed");
});

test("browser showcase imports are exported and its required controls exist", () => {
  const html = readFileSync(showcaseUrl, "utf8");
  const entry = readFileSync(entryUrl, "utf8");
  const importMatch = html.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']..\/src\/index\.js["']/);
  assert.ok(importMatch, "expected a named import from the engine entry point");

  const importedNames = importMatch[1]
    .split(",")
    .map(part => part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1])
    .filter(Boolean);
  const exportedNames = new Set(
    [...entry.matchAll(/export\s*\{([\s\S]*?)\}/g)]
      .flatMap(match => match[1].split(","))
      .map(part => part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1])
      .filter(Boolean)
  );

  for (const name of importedNames) {
    assert.ok(exportedNames.has(name), "browser showcase imports " + name + " but src/index.js does not export it");
  }

  for (const id of ["stage", "character-layer", "particles", "scene-one", "scene-two", "audio", "destroy", "status"]) {
    assert.match(html, new RegExp('id=["\\x27]' + id + '["\\x27]'), "missing required showcase element #" + id);
  }
});
