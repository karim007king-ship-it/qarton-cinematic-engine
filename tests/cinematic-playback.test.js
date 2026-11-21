import test from "node:test";
import assert from "node:assert/strict";
import { createAudioCueController, createCinematicPlayback, createScenePackage } from "../src/index.js";

function fixture() {
  let wall = 0, pos = 0, destroyed = false;
  const events = [], sounds = [], stopped = [], views = [];
  const pack = createScenePackage({version:1,id:"scene",durationMs:1000,
    layers:[{id:"ridge",role:"background",asset:"image",keyframes:[{atMs:0},{atMs:1000,x:12}]}],
    camera:[{atMs:0},{atMs:1000,x:24}], events:[{id:"a",atMs:100,type:"step"}],
    audioCues:[{id:"start",atMs:0,asset:"intro"},{id:"b",atMs:100,asset:"beat"}]});
  const audio = createAudioCueController({cues:pack.audioCues,play:key=>{sounds.push(key);return key;},
    stop:key=>stopped.push(key)});
  const player = createCinematicPlayback({pack,audio, now:()=>wall,
    characterStage:{mount:()=>true,update:t=>{pos=t;},unmount(){},destroy(){destroyed=true;}},
    onEvent:e=>events.push(e.id),present:view=>{assert.equal(view.timeMs,pos);views.push(view);}});
  return {player,events,sounds,stopped,views,advance:ms=>{wall+=ms;},closed:()=>destroyed};
}

test("pause freezes actor, camera, moving layer, cues and event clock; resume uses remaining time",async()=>{
  const f=fixture(), p=f.player;
  await p.mount(); await p.play(); f.advance(500); await p.tick();
  assert.equal(f.views.at(-1).camera.x,12); assert.equal(f.views.at(-1).layers.ridge.x,6);
  await p.pause(); f.advance(4000); await p.tick(); assert.equal(f.views.at(-1).timeMs,500);
  assert.deepEqual(f.stopped,["intro","beat"]);
  await p.resume(); f.advance(125); await p.tick();
  assert.equal(f.views.at(-1).timeMs,625); assert.deepEqual(f.events,["a"]);
});
test("silent seek previews while paused, rearms future cues, replay includes zero and close releases stage",async()=>{
  const f=fixture(), p=f.player; await p.mount();
  await p.seek(700); assert.deepEqual(f.sounds,[]); assert.deepEqual(f.events,[]);
  await p.resume(); f.advance(20); await p.tick(); await p.seek(50);
  f.advance(65); await p.tick(); assert.deepEqual(f.events,["a"]); assert.deepEqual(f.sounds,["beat"]);
  await p.replay(); assert.deepEqual(f.sounds,["beat","intro"]);
  f.advance(1200); await p.tick(); assert.equal(p.state,"ended");
  await p.seek(10); await p.resume(); await p.destroy();
  assert.equal(f.closed(),true); await assert.rejects(p.play(),/closed/);
});
test("replacing a session waits for submitted updates and the next scene starts at zero",async()=>{
  const f=fixture(); await f.player.play(); f.advance(400);
  await Promise.all([f.player.tick(), f.player.destroy()]);
  const next=fixture(); await next.player.mount();
  assert.equal(next.views.at(-1).timeMs,0); assert.deepEqual(next.sounds,[]);
});
