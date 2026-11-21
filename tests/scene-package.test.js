import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AssetManager, createScenePackage, createSceneDefinition, sampleCameraTrack } from "../src/index.js";

const fixture = JSON.parse(await readFile(new URL("../examples/scene-lab/scene.json", import.meta.url)));
test("version one compiles existing scene, camera, layer and character inputs", () => {
  const pack = createScenePackage(fixture);
  assert.deepEqual(pack.scene, createSceneDefinition(fixture));
  assert.equal(sampleCameraTrack(pack.camera, 3200).zoom, 1.05);
  assert.equal(sampleCameraTrack(pack.layerTracks.ridge, 3200).x, 12);
  const actor = pack.characters[0].controller;
  assert.deepEqual([0, 500, 2000, 3200].map(t => actor.update(t).state), ["idle", "walk", "gesture", "idle"]);
  assert.equal(actor.update(3200).expression, "greeting");
  assert.deepEqual(pack.imageKeys({maxBackgroundLayers: 1}), ["sky.svg", "scout.svg", "wave.svg"]);
});
test("invalid versions, layer tracks, sprite sets, cues and transitions fail before mounting", () => {
  for (const override of [
    {version: 2}, {layers: [{...fixture.layers[0], keyframes: []}]},
    {characters: [fixture.characters[0], fixture.characters[0]]},
    {characters: [{id: "a", sprites: {}}]}, {audioCues: [{}]}, {transitionMs: -1}
  ]) assert.throws(() => createScenePackage({...fixture, ...override}));
});
test("two hosts can preload identical package keys with independent caches", async () => {
  const keys = createScenePackage(fixture).imageKeys({maxBackgroundLayers: 2});
  const first = new AssetManager({ loader: key => "first/" + key });
  const second = new AssetManager({ loader: key => "second/" + key });
  assert.notDeepEqual(await first.preload(keys), await second.preload(keys));
  first.destroy();
  assert.equal(second.size, keys.length);
  second.destroy();
});
