import test from "node:test";
import assert from "node:assert/strict";
import {createStudioSequenceV1} from "../packages/motion-studio/index.js";
import {createPersistentAssetRegistry} from "../packages/motion-studio/asset-persistence.js";
const viewport={width:360,height:640,fps:24};
const assets=["a","b"].map(id=>({id,kind:"image",name:id+".png",mimeType:"image/png",size:4}));
const sequence=createStudioSequenceV1({viewport,assets,scenes:[{id:"scene",project:{version:1,durationMs:1000,viewport,layers:[{id:"layer",assetId:"a",z:0}]}}]});
const blob=()=>new Blob(["1234"],{type:"image/png"});
function fixture(maxBytes=8){
 const data=new Map();
 const storage={async put(p,id,b){data.set(p+"/"+id,b)},async get(p,id){return data.get(p+"/"+id)??null},async remove(p,id){data.delete(p+"/"+id)}};
 const open=()=>createPersistentAssetRegistry(sequence,{storage,projectId:"project",maxBytes});
 return {data,storage,open};
}
test("persistent links restore after reopening and report missing assets",async()=>{
 const {open}=fixture(); const r=open(); const b=blob();
 await r.relink("a",b);
 const reopened=open();
 assert.deepEqual(await reopened.restore(),["b"]);
 assert.equal(reopened.get("a"),b);
 assert.equal(reopened.linkedBytes,4);
});
test("failed writes preserve prior registry state and queue remains usable",async()=>{
 const {open,storage}=fixture(); const r=open(); const original=storage.put;
 storage.put=async()=>{throw new Error("quota")};
 await assert.rejects(r.relink("a",blob()),/quota/);
 assert.equal(r.linkedBytes,0);
 assert.equal(r.get("a"),null);
 storage.put=original;
 await r.relink("a",blob());
 assert.equal(r.linkedBytes,4);
});
test("concurrent links serialize preflight and never persist over budget",async()=>{
 const {open,data}=fixture(4); const r=open();
 const results=await Promise.allSettled([r.relink("a",blob()),r.relink("b",blob())]);
 assert.deepEqual(results.map(x=>x.status),["fulfilled","rejected"]);
 assert.equal(data.size,1);
 assert.equal(r.linkedBytes,4);
});

test("persistent deletion protects referenced assets and survives storage failure",async()=>{
 const {open,storage,data}=fixture(); const r=open();
 await r.relink("a",blob()); await r.relink("b",blob());
 await assert.rejects(r.remove("a"),/referenced/);
 const remove=storage.remove; storage.remove=async()=>{throw new Error("disk")};
 await assert.rejects(r.remove("b"),/disk/); assert.equal(r.linkedBytes,8);
 storage.remove=remove; await r.remove("b");
 assert.equal(r.linkedBytes,4); assert.equal(data.has("project/b"),false);
 assert.equal(data.has("project/a"),true); assert.equal(r.sequence.assets.length,1);
});
