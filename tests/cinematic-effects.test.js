import test from "node:test";
import assert from "node:assert/strict";
import { compileCinematicEffects, sampleCinematicEffects, drawCinematicEffects, createCinematicEffectsPlayer } from "../src/effects/cinematic-effects.js";

const demo = () => compileCinematicEffects({version:"CinematicEffectsV1",width:360,height:640,durationMs:5000,seed:42,
  camera:[{atMs:0,x:0,y:0},{atMs:5000,x:20,y:-10,zoom:1.05}],
  layers:[{id:"far",depth:0.2,speedX:2,color:"#21364c",z:0},{id:"near",depth:0.8,speedX:5,color:"#487155",z:1}],
  clips:[
    {id:"fade-in",type:"fade",atMs:0,durationMs:700,from:{opacity:0,color:"#000000"},to:{opacity:1,color:"#000000"},easing:"easeInOutCubic"},
    {id:"shake",type:"shake",atMs:900,durationMs:1200,from:{amplitude:7,frequencyHz:8,seed:8},to:{amplitude:0,frequencyHz:8,seed:8}},
    {id:"vignette",type:"vignette",atMs:0,durationMs:400,from:{intensity:0},to:{intensity:0.55}},
    {id:"bars",type:"letterbox",atMs:500,durationMs:400,from:{ratio:0},to:{ratio:0.08}},
    {id:"flash",type:"flash",atMs:1200,durationMs:200,from:{intensity:0.9,color:"#ffffff"},to:{intensity:0,color:"#ffffff"}},
    {id:"tint",type:"tint",atMs:1800,durationMs:500,from:{strength:0,color:"#e24848"},to:{strength:0.3,color:"#e24848"}},
    {id:"dissolve",type:"dissolve",atMs:4000,durationMs:500,from:{progress:0,color:"#000000"},to:{progress:1,color:"#000000"}}
  ]});

test("strictly rejects invalid dimensions, IDs, ranges, colors, and clip timing", () => {
  const base = {version:"CinematicEffectsV1",width:64,height:64,durationMs:100,layers:[],clips:[]};
  for (const project of [{...base,width:0},{...base,durationMs:Infinity},{...base,layers:[{id:"x",depth:8}]},
    {...base,layers:[{id:"x"},{id:"x"}]},{...base,clips:[{id:"x",type:"glow",atMs:0,durationMs:0,from:{},to:{}}]},
    {...base,clips:[{id:"x",type:"fade",atMs:90,durationMs:20,from:{opacity:0,color:"#000000"},to:{opacity:1,color:"#000000"}}]},
    {...base,clips:[{id:"x",type:"fade",atMs:0,durationMs:1,from:{opacity:2,color:"red"},to:{opacity:1,color:"#000000"}}]}]) {
    assert.throws(() => compileCinematicEffects(project));
  }
});

test("V1 rejects fractional discrete values, nulls, missing channels, and unknown fields", () => {
  const base={version:"CinematicEffectsV1",width:64,height:64,durationMs:100,layers:[],clips:[]};
  const fade={id:"f",type:"fade",atMs:0,durationMs:10,from:{opacity:0,color:"#000000"},to:{opacity:1,color:"#000000"}};
  const shake={id:"s",type:"shake",atMs:0,durationMs:10,from:{amplitude:1,frequencyHz:3,seed:1},to:{amplitude:0,frequencyHz:3,seed:1}};
  const invalid=[
    {...base,width:64.5},{...base,height:63.5},{...base,durationMs:100.5},{...base,seed:1.5},
    {...base,unexpected:true},{...base,camera:[{atMs:0,scale:1}]},{...base,camera:[{atMs:0.5}]},
    {...base,layers:[{id:"x",z:1.5}]},{...base,layers:[{id:"x",unknown:1}]},
    {...base,clips:[{...fade,atMs:0.5}]},{...base,clips:[{...fade,durationMs:0.5}]},
    {...base,clips:[{...fade,unknown:1}]},{...base,clips:[{...fade,from:{...fade.from,extra:1}}]},
    {...base,clips:[{...fade,to:{opacity:1}}]},{...base,clips:[{...shake,from:{...shake.from,seed:1.5}}]},
    {...base,seed:null},{...base,layers:[{id:"x",depth:null}]},{...base,layers:Array(1)}
  ];
  for(const candidate of invalid) assert.throws(()=>compileCinematicEffects(candidate));
  const compiled=compileCinematicEffects({...base,clips:[fade]});
  assert.ok(Object.isFrozen(compiled.clips[0].from));
  assert.deepEqual(Object.keys(compiled.clips[0].from).sort(),["color","opacity"]);
});

test("absolute-time sampling is deterministic across seek and replay", () => {
  const scene = demo();
  const a = sampleCinematicEffects(scene, 1450);
  sampleCinematicEffects(scene, 4000);
  const b = sampleCinematicEffects(scene, 1450);
  assert.deepEqual(a, b);
  assert.ok(a.shake.x !== 0 || a.shake.y !== 0);
  assert.equal(a.layers[0].id, "far");
  assert.ok(a.layers[1].x > a.layers[0].x);
});

test("clips use shared Timeline ordering with stable order for simultaneous events", () => {
  const scene=compileCinematicEffects({version:"CinematicEffectsV1",width:20,height:20,durationMs:100,layers:[],clips:[
    {id:"late",type:"flash",atMs:50,durationMs:0,from:{intensity:0,color:"#ffffff"},to:{intensity:0,color:"#ffffff"}},
    {id:"first",type:"vignette",atMs:0,durationMs:0,from:{intensity:0},to:{intensity:0}},
    {id:"same-time",type:"letterbox",atMs:0,durationMs:0,from:{ratio:0},to:{ratio:0}}
  ]});
  assert.deepEqual(scene.clips.map(clip=>clip.id),["first","same-time","late"]);
});

test("samples all authored effects and camera/parallax movement at exact boundaries", () => {
  const scene = demo();
  const start = sampleCinematicEffects(scene, 0);
  const mid = sampleCinematicEffects(scene, 2200);
  const end = sampleCinematicEffects(scene, 4500);
  assert.equal(start.fade.opacity, 0);
  assert.equal(mid.vignette, 0.55);
  assert.equal(mid.letterbox, 0.08);
  assert.equal(mid.tint.strength, 0.24);
  assert.equal(end.dissolve.progress, 1);
  assert.notDeepEqual(start.layers.map(layer=>layer.x), mid.layers.map(layer=>layer.x));
});

test("samples exact effect boundaries and zero-duration clips as instantaneous steps", () => {
  const scene=compileCinematicEffects({version:"CinematicEffectsV1",width:24,height:40,durationMs:50,layers:[],clips:[
    {id:"fade",type:"fade",atMs:10,durationMs:10,from:{opacity:0,color:"#000000"},to:{opacity:1,color:"#000000"}},
    {id:"instant-vignette",type:"vignette",atMs:20,durationMs:0,from:{intensity:0},to:{intensity:.75}},
    {id:"instant-shake",type:"shake",atMs:30,durationMs:0,from:{amplitude:0,frequencyHz:5,seed:2},to:{amplitude:5,frequencyHz:5,seed:2}}
  ]});
  assert.equal(sampleCinematicEffects(scene,9).fade.opacity,1);
  assert.equal(sampleCinematicEffects(scene,10).fade.opacity,0);
  assert.equal(sampleCinematicEffects(scene,20).fade.opacity,1);
  assert.equal(sampleCinematicEffects(scene,19).vignette,0);
  assert.equal(sampleCinematicEffects(scene,20).vignette,.75);
  const pulse=sampleCinematicEffects(scene,30).shake;
  assert.ok(pulse.x!==0||pulse.y!==0||pulse.rotation!==0);
  assert.deepEqual(sampleCinematicEffects(scene,31).shake,{x:0,y:0,rotation:0});
});

test("overlapping effects combine deterministically without order-dependent maxima", () => {
  const scene=compileCinematicEffects({version:"CinematicEffectsV1",width:24,height:40,durationMs:100,layers:[],clips:[
    {id:"vignette-a",type:"vignette",atMs:0,durationMs:100,from:{intensity:.1},to:{intensity:.7}},
    {id:"vignette-b",type:"vignette",atMs:25,durationMs:50,from:{intensity:.5},to:{intensity:.8}},
    {id:"flash-a",type:"flash",atMs:0,durationMs:100,from:{intensity:.3,color:"#ffffff"},to:{intensity:.7,color:"#ffffff"}},
    {id:"flash-b",type:"flash",atMs:25,durationMs:50,from:{intensity:.6,color:"#ffccaa"},to:{intensity:.9,color:"#ffccaa"}}
  ]});
  const sample=sampleCinematicEffects(scene,50);
  assert.equal(sample.vignette,.65);
  assert.equal(sample.flash.intensity,.75);
  assert.equal(sample.flash.color,"#ffccaa");
  assert.deepEqual(sample,sampleCinematicEffects(scene,50));
});

test("Scene Clock transport pauses, seeks, replays, and clamps at the scene end", () => {
  let now=0;
  const player=createCinematicEffectsPlayer(demo(),{now:()=>now});
  player.play(); now=1000;
  assert.equal(player.timeMs,1000);
  player.pause(); now=4000;
  assert.equal(player.timeMs,1000);
  player.seek(3200);
  assert.equal(player.sample().timeMs,3200);
  player.replay();
  assert.equal(player.timeMs,0);
  now=10000; player.pause();
  assert.equal(player.timeMs,5000);
});

test("camera shake is identical after backward seek and replay", () => {
  let now=0;
  const player=createCinematicEffectsPlayer(demo(),{now:()=>now});
  player.play(); now=1450;
  const first=player.sample().shake;
  player.seek(3900); player.seek(1450);
  assert.deepEqual(player.sample().shake,first);
  player.replay(); player.seek(1450);
  assert.deepEqual(player.sample().shake,first);
});

test("Canvas renderer draws sorted layers and screen-space overlays with bounded work", () => {
  const sample=sampleCinematicEffects(demo(),2200), calls=[];
  const ctx={save(){calls.push("save")},restore(){calls.push("restore")},translate(){},rotate(){},scale(){},fillRect(x,y,w,h){calls.push(["rect",x,y,w,h])},
    drawImage(){calls.push("image")},set fillStyle(v){},set globalAlpha(v){},createRadialGradient(){return {addColorStop(){}}}};
  const pose=drawCinematicEffects(ctx,sample);
  assert.deepEqual(Object.keys(pose),["x","y","rotation"]);
  assert.equal(calls.filter(item=>Array.isArray(item)&&item[0]==="rect").length,6);
  assert.equal(calls[0],"save"); assert.equal(calls.at(-1),"restore");
});

test("Canvas state is restored when drawImage throws", () => {
  const scene=compileCinematicEffects({version:"CinematicEffectsV1",width:24,height:40,durationMs:10,
    layers:[{id:"asset",assetId:"picture"}],clips:[]});
  const sample=sampleCinematicEffects(scene,0);
  let depth=0,saves=0,restores=0;
  const ctx={save(){depth++;saves++;},restore(){depth--;restores++;},translate(){},rotate(){},scale(){},drawImage(){throw new Error("decode/render failure");}};
  assert.throws(()=>drawCinematicEffects(ctx,sample,{picture:{}}),/decode\/render failure/);
  assert.equal(depth,0);
  assert.equal(saves,restores);
});
