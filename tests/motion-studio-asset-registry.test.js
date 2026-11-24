import test from "node:test";
import assert from "node:assert/strict";
import { createStudioSequenceV1 } from "../packages/motion-studio/index.js";
import { createAssetRegistry } from "../packages/motion-studio/asset-registry.js";
const viewport = {width:360,height:640,fps:24};
const asset = id => ({id,kind:"image",name:id+".png",mimeType:"image/png",size:4});
const blob = () => new Blob(["1234"],{type:"image/png"});
function registry(maxBytes=8) {
  const scenes = ["a","b"].map(id=>({id,project:{version:1,durationMs:1000,viewport,layers:[{id:"layer",assetId:"shared",z:0}]}}));
  return createAssetRegistry(createStudioSequenceV1({viewport,scenes,assets:[asset("shared"),asset("unused")]}),{maxBytes});
}
test("shared references prevent deletion and use one linked blob",()=>{
  const r=registry();
  assert.deepEqual(r.references("shared"),["a","b"]);
  const b=blob(); r.relink("shared",b);
  assert.equal(r.get("shared"),b);
  assert.equal(r.linkedBytes,4);
  assert.throws(()=>r.remove("shared"),/referenced/);
  r.relink("shared",blob());
  assert.equal(r.linkedBytes,4);
});
test("quota and metadata mismatch leave previous state intact",()=>{
  const r=registry(4); r.relink("shared",blob());
  assert.throws(()=>r.relink("unused",blob()),/budget/);
  assert.throws(()=>r.relink("shared",new Blob(["x"],{type:"image/png"})),TypeError);
  assert.equal(r.get("unused"),null);
  assert.equal(r.linkedBytes,4);
});
test("unused asset removal releases bytes without changing original snapshot",()=>{
  const r=registry(); const before=r.sequence;
  r.relink("unused",blob()); r.remove("unused");
  assert.equal(r.linkedBytes,0);
  assert.equal(r.get("unused"),null);
  assert.equal(before.assets.length,2);
  assert.equal(r.sequence.assets.length,1);
  r.add(asset("new")); assert.equal(r.sequence.assets.length,2);
  assert.throws(()=>r.add(asset("new")),TypeError);
});

test("character frames, blink frames and sprite sheets protect shared assets",()=>{
 const assets=["background","face","blink","sheet","unused"].map(asset);
 const characterTracks=[{character:{id:"hero",animation:{blink:{intervalMs:1000,durationMs:100},clips:{
 idle:{frames:["face"],blinkFrames:["blink"],fps:1},
 moving:{frames:[0],fps:1,spriteSheet:{asset:"sheet",frameWidth:32,frameHeight:32,columns:1,frameCount:1}}
 }}},keyframes:[]}];
 const sequence=createStudioSequenceV1({viewport,assets,scenes:[{id:"scene",characterTracks,project:{version:1,durationMs:1000,viewport,layers:[{id:"layer",assetId:"background",z:0}]}}]});
 const r=createAssetRegistry(sequence);
 for(const id of ["face","blink","sheet"]){
  assert.deepEqual(r.references(id),["scene"]);
  assert.throws(()=>r.remove(id),/referenced/);
 }
 assert.equal(r.remove("unused").assets.length,4);
});
