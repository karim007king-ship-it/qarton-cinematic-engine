import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("browser showcase inline module has valid JavaScript syntax", async () => {
  const html = await readFile(resolve(root, "examples/browser-smoke.html"), "utf8");
  const match = html.match(/<script\\s+type=["']module["']\\s*>([\\s\\S]*?)<\\/script>/i);
  assert.ok(match, "browser showcase must contain an inline module script");

  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: match[1],
    encoding: "utf8"
  });

  assert.equal(
    checked.status,
    0,
    [checked.stdout, checked.stderr].filter(Boolean).join("\\n") || "module syntax check failed"
  );
});
