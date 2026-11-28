import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileCinematicStoryV1 } from "../src/index.js";

test("offline Runtime Lab is a linked five-scene story with four stable characters, choices and two endings", async () => {
  const json=JSON.parse(await readFile(new URL("../examples/cinematic-runtime-lab/story.json",import.meta.url),"utf8"));
  const story=compileCinematicStoryV1(json.scenes);
  assert.equal(story.scenes.length,5);
  const ids=new Set(story.scenes.flatMap(scene=>scene.characters.map(character=>character.id)));
  assert.deepEqual([...ids].sort(),["layla","nour","salim","youssef"]);
  assert.ok(story.scenes.some(scene=>scene.choices.length>=1));
  const endings=story.byId.get("finale").choices[0].options.map(option=>option.endingId).filter(Boolean);
  assert.deepEqual(endings.sort(),["family-safe","united-carthage"]);
  assert.ok(story.scenes.some(scene=>scene.camera.timeOfDay==="day"));
  assert.ok(story.scenes.some(scene=>scene.camera.timeOfDay==="night"));
  for(const scene of story.scenes) for(const asset of scene.assets) assert.ok(asset.src.startsWith("assets/"),"preview assets must remain local");
});

test("Runtime Lab contains no audio or Motion Studio imports", async () => {
  const source=await readFile(new URL("../examples/cinematic-runtime-lab/runtime-lab.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/AudioContext|getUserMedia|motion-studio-v2|@qarton\/cinematic-engine\/motion-studio/u);
  assert.match(source,/createCinematicStoryRuntime/u);
});
