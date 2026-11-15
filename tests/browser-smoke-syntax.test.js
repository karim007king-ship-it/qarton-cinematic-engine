import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("browser showcase module script has valid JavaScript syntax", () => {
  const html = readFileSync(new URL("../examples/browser-smoke.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, "expected exactly one module script in browser showcase");

  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: scripts[0][1],
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "browser showcase syntax check failed");
});
