import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageName = packageJson.name;

test("package root exports the public API", async () => {
  const api = await import(packageName);
  assert.ok(Object.keys(api).length > 0, "root API should expose named exports");
  for (const name of [
    "createCinematicRuntime",
    "createCinematicDirector",
    "createSceneDefinition",
    "createCharacterController",
    "createAudioCueController",
    "createHTMLAudioAdapter",
    "AssetManager",
    "createPageLifecycleAdapter",
  ]) {
    assert.equal(typeof api[name], "function", `missing root export: ${name}`);
  }
});

test("every declared package export resolves to a module", async () => {
  for (const subpath of Object.keys(packageJson.exports)) {
    const specifier = subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`;
    await test(specifier, async () => {
      const module = await import(specifier);
      assert.ok(module && typeof module === "object");
      assert.ok(Object.keys(module).length > 0, `${specifier} exports nothing`);
    });
  }
});
