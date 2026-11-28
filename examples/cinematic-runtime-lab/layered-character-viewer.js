import { CHARACTER_LAYER_LAYOUTS, CinematicRenderer, compileTextScene, compileTextCinematicDirection } from "../../src/index.js";

const canvas = document.querySelector("#test-stage"), renderer = new CinematicRenderer(canvas, { quality: "high" }), assets = new Map();
const sources = {
  body:"body.svg", head:"head.svg", head_side:"head.svg", hair_back:"hair-back.svg", hair_front:"hair-front.svg",
  eye_left:"eye-left.svg", eye_left_closed:"eye-left-closed.svg", eye_right:"eye-right.svg", eye_right_closed:"eye-right-closed.svg",
  brow_left:"brow-left.svg", brow_right:"brow-right.svg", hand_left:"hand.svg", hand_right:"hand.svg",
  mouth_closed:"mouth-closed.svg", mouth_open:"mouth-open.svg", mouth_round:"mouth-round.svg", mouth_wide:"mouth-wide.svg", mouth_teeth:"mouth-teeth.svg", bg:"../backgrounds/day.svg"
};
await Promise.all(Object.entries(sources).map(async ([id, src]) => {
  const img = new Image(); img.src = `assets/layered-test/${src}`; await img.decode(); assets.set(id, img);
}));
const anchors = {
  head:{x:.5,y:.29,width:.4,height:.36,pivotX:.5,pivotY:.88},
  eye_left:{x:.405,y:.14,width:.13,height:.09,pivotX:.5,pivotY:.5}, eye_right:{x:.595,y:.14,width:.13,height:.09,pivotX:.5,pivotY:.5},
  brow_left:{x:.405,y:.095,width:.13,height:.07,pivotX:.5,pivotY:.5}, brow_right:{x:.595,y:.095,width:.13,height:.07,pivotX:.5,pivotY:.5},
  mouth:{x:.5,y:.22,width:.19,height:.075,pivotX:.5,pivotY:.5}
};
const layerRecords = [
  ["body","body","neutral"], ["head","head","neutral"], ["hair_back","hair_back","neutral"], ["hair_front","hair_front","neutral"],
  ["eye_left","eye_left","neutral"], ["eye_left","eye_left_closed","closed"], ["eye_right","eye_right","neutral"], ["eye_right","eye_right_closed","closed"],
  ["brow_left","brow_left","neutral"], ["brow_right","brow_right","neutral"], ["hand_left","hand_left","neutral"], ["hand_right","hand_right","neutral"],
  ...["closed","open","round","wide","teeth"].map(pose=>["mouth",`mouth_${pose}`,pose])
];
const makeRig = () => layerRecords.flatMap(([role,assetId,variant]) => {
  const base = {role,assetId,variant,z:CHARACTER_LAYER_LAYOUTS[role].z,...(anchors[role]?{layout:anchors[role]}:{})};
  if (anchors[role]) return [{...base,view:"front"},{...base,view:"side",layout:{...anchors[role],x:role.includes("right") ? .53 : role.includes("left") ? .47 : .5,width:role==="mouth" ? .15 : anchors[role].width}}];
  return [{...base,view:"any"}];
});
const bg = assets.get("bg"); assets.set("bg",bg);
function paint(pose="closed", characterId=document.querySelector("#character-id").value, view=document.querySelector("#view-id").value) {
  const character={id:characterId,name:characterId,x:.5,y:.92,scale:.82,z:0,facing:"right",pose,layers:makeRig()};
  const textScene=compileTextScene({id:"layered-visual",title:"اختبار الطبقات",language:"ar",theme:"ruins",characters:[character],dialogue:[{id:"line",speakerId:characterId,expression:"determined",text:"بَتْث واو إي ب"}]});
  const scene={id:"layered-visual",textScene,characters:[character],backgrounds:[{id:"test-bg",assetId:"bg",role:"background",z:0,depth:.2}],camera:{mode:"auto",keyframes:null},direction:compileTextCinematicDirection({durationMs:textScene.durationMs,mood:"calm",shot:"medium"}),lighting:{intensity:.12,tint:"#D5AE61"}};
  const times=textScene.turns[0].animation.events.filter(event=>event.viseme===pose).map(event=>event.atMs+8);
  const time=times[0]??textScene.turns[0].startMs;
  // `view` remains an authored rig choice; the full fixture has a separate anchor set for each view.
  character.pose=view;
  const drawStats=renderer.renderEndpoint(scene,assets,undefined,time);
  const geometry=drawStats.characterGeometry[characterId];
  document.querySelector("#mouth-state").textContent=`الشخصية: ${characterId} • الوجه: ${view==="side"?"جانبي":"أمامي"} • الفم: ${pose} • ${geometry?.faceRigValid?"Rig صالح":"تحريك الوجه معطّل"}`;
  globalThis.qartonLayeredVisualTest.lastDraw=drawStats;
  return time;
}
for(const button of document.querySelectorAll("[data-pose]")) button.onclick=()=>paint(button.dataset.pose);
document.querySelector("#character-id").onchange=()=>paint(document.querySelector("[data-pose].selected")?.dataset.pose??"closed");
document.querySelector("#view-id").onchange=()=>paint("closed");
globalThis.qartonLayeredVisualTest={paint,renderer,assets,makeRig};
paint(); document.querySelector("#commit").textContent=`Commit: ${globalThis.__QARTON_COMMIT__??"local preview"}`;
