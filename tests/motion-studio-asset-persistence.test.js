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
 const storage={async put(p,id,b){data.set(p+"/"+id,b)},async get(p,id){return data.get(p+"/"+id)??null}};
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
