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

  // Keep the manual browser showcase wired to the character animation APIs.
  // These checks guard integration configuration; they are not a substitute
  // for rendering the page in a real browser.
  for (const api of [
    "createIdleAnimation",
    "createWalkAnimation",
    "createSpriteFrameAnimation"
  ]) {
    assert.ok(match[1].includes(api), `showcase must import/use ${api}`);
  }
  for (const config of ["idleAnimations:", "walkAnimations:", "spriteAnimations:"]) {
    assert.ok(match[1].includes(config), `showcase must configure ${config}`);
  }
  for (const frame of [
    "heroIdle", "heroWalkA", "heroWalkB",
    "companionIdle", "companionWalkA", "companionWalkB"
  ]) {
    assert.ok(match[1].includes(frame), `showcase must provide sprite asset key ${frame}`);
  }
  assert.match(html, /id="scene-one"/);
  assert.match(html, /id="scene-two"/);
  assert.match(html, /id="destroy"/);

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
