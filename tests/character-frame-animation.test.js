import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCharacterController, createScenePackage, createSceneClock } from "../src/index.js";

const scene = JSON.parse(await readFile(new URL("../examples/character-lab/scene.json", import.meta.url)));
const actor = scene.characters[0];
test("clip time is local to each motion and seek reproduces pose, expression and blink", () => {
  const player = createCharacterController(actor);
  const walk = player.update(1250);
  assert.equal(walk.frameAsset, "frames/walk-1.svg");
  assert.equal(player.update(1900).frameAsset, "frames/walk-1-blink.svg");
  assert.equal(player.update(3400).frameAsset, "frames/gesture-1.svg");
  assert.equal(player.update(4500).state, "idle");
  assert.deepEqual(player.update(1250), walk);
});
test("FPS, looping and last-frame hold are independent per clip", () => {
  const create = (fps, loop) => createCharacterController({id:"one", animation:{
    clips:{idle:{fps, loop, frames:["a","b","c"]}}
  }});
  assert.equal(create(4,true).update(750).frameAsset, "a");
  assert.equal(create(2,true).update(750).frameAsset, "b");
  assert.equal(create(4,false).update(9000).frameAsset, "c");
  assert.throws(() => create(0,true), /FPS/);
});
test("reduced motion preloads representative poses and holds still between states", () => {
  const pack = createScenePackage(scene, {reducedMotion: true});
  const actor = pack.characters[0].controller;
  assert.deepEqual(pack.imageKeys({maxBackgroundLayers: 2}), ["frames/idle-0.svg","frames/walk-0.svg","frames/gesture-0.svg"]);
  assert.equal(actor.update(1900).frameAsset, "frames/walk-0.svg");
  assert.equal(actor.update(1900).x, actor.update(1000).x);
  assert.equal(actor.update(3400).expression, "happy");
});
test("old character snapshots retain their shape and invalid blink frames reject", () => {
  assert.equal(Object.hasOwn(createCharacterController({id:"one"}).update(0), "frameAsset"), false);
  assert.throws(() => createCharacterController({id:"one",animation:{clips:{
    idle:{fps:5,frames:["a","b"],blinkFrames:["x"]}
  }}}), /frame count/);
});
test("scene clock freezes on pause, seeks while paused or running, and clamps at end", () => {
  let wall = 100;
  const clock = createSceneClock({durationMs:5000,now:()=>wall});
  clock.resume(); wall += 470; assert.equal(clock.pause(),470);
  wall += 500; assert.equal(clock.time(),470);
  clock.seek(1800); clock.resume(); wall += 120; assert.equal(clock.time(),1920);
  clock.seek(230); wall += 30; assert.equal(clock.time(),260);
  wall += 6000; assert.equal(clock.time(),5000);
  assert.equal(clock.seek(-100),0);
});
