import { VISUAL_EFFECT_TYPES } from "./studio-visual-effects-model.js";

const LABELS=Object.freeze({fade:"Fade",dissolve:"Dissolve",vignette:"Vignette",letterbox:"Letterbox",shake:"Shake",flash:"Flash",tint:"Tint"});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Touch-first effect lanes; state and validation stay owned by the Studio host. */
export function createStudioVisualEffectsTimeline({root,ruler,getTrack,getDuration,getCurrentTime,isBusy,onSelect,onMove,onSeek,onDragEnd,documentRef=document,formatTime=ms=>`${(ms/1000).toFixed(2)}s`}){
  const required={root,getTrack,getDuration,getCurrentTime,isBusy,onSelect,onMove};
  for(const [name,value] of Object.entries(required))if(value===null||value===undefined)throw new TypeError(`Visual Effects Timeline requires ${name}`);
  let selectedId=null,drag=null,locked=Boolean(isBusy());
  root.addEventListener("pointermove",movePointer);
  root.addEventListener("pointerup",event=>finishPointer(event,false));
  root.addEventListener("pointercancel",event=>finishPointer(event,true));
  root.addEventListener("lostpointercapture",event=>finishPointer(event,true));
  root.addEventListener("keydown",event=>{if(event.key==="Escape"&&drag){event.preventDefault();cancelDrag();}});
  documentRef.addEventListener("visibilitychange",()=>{if(documentRef.hidden)cancelDrag();});
  documentRef.defaultView?.addEventListener("blur",cancelDrag);

  function renderRuler(){
    if(!ruler)return;
    ruler.replaceChildren();
    for(let i=0;i<=4;i++){const label=documentRef.createElement("span");label.textContent=formatTime(Math.round(getDuration()*i/4));ruler.append(label);}
  }
  function renderPlayhead(){
    const position=`${clamp(getCurrentTime()/getDuration()*100,0,100)}%`;
    for(const head of root.querySelectorAll(".visual-effect-playhead"))head.style.left=position;
  }
  function render({focusId=null}={}){
    const focused=focusId??(root.contains(documentRef.activeElement)?documentRef.activeElement.closest?.(".visual-effect-clip")?.dataset.effectId:null);
    root.replaceChildren();
    const duration=getDuration(),track=getTrack();
    for(const type of VISUAL_EFFECT_TYPES){
      const row=documentRef.createElement("section");row.className="visual-effect-row";row.dataset.effectType=type;
      const heading=documentRef.createElement("strong");heading.className="visual-effect-label";heading.textContent=LABELS[type];
      const lane=documentRef.createElement("div");lane.className="visual-effect-lane";lane.dataset.effectType=type;lane.setAttribute("role","group");lane.setAttribute("aria-label",`مسار ${LABELS[type]}`);
      lane.addEventListener("click",event=>{if((event.target===lane||event.target.classList?.contains("visual-effect-grid"))&&onSeek){const box=lane.getBoundingClientRect();if(box.width>0)onSeek(Math.round(clamp((event.clientX-box.left)/box.width,0,1)*duration));}});
      const grid=documentRef.createElement("span");grid.className="visual-effect-grid";grid.setAttribute("aria-hidden","true");lane.append(grid);
      const head=documentRef.createElement("span");head.className="visual-effect-playhead";head.setAttribute("aria-hidden","true");head.style.left=`${getCurrentTime()/duration*100}%`;lane.append(head);
      for(const clip of track.clips.filter(item=>item.type===type)){
        const button=documentRef.createElement("button");button.type="button";button.className="visual-effect-clip";
        button.dataset.effectId=clip.id;button.dataset.effectType=type;
        button.style.setProperty("--effect-left",`${clip.atMs/duration*100}%`);
        button.style.setProperty("--effect-width",`${clip.durationMs/duration*100}%`);
        button.textContent=LABELS[type];button.title=`${LABELS[type]} · ${formatTime(clip.atMs)} · ${formatTime(clip.durationMs)}`;
        button.setAttribute("aria-label",`${LABELS[type]}، يبدأ ${formatTime(clip.atMs)}، المدة ${formatTime(clip.durationMs)}`);
        button.setAttribute("aria-pressed",String(selectedId===clip.id));button.disabled=locked;
        button.addEventListener("pointerdown",event=>{
          if(locked||isBusy()||!event.isPrimary||event.button!==0)return;
          event.preventDefault();event.stopPropagation();selectedId=clip.id;onSelect(clip.id);
          const box=lane.getBoundingClientRect();drag={pointerId:event.pointerId,id:clip.id,type,originX:event.clientX,originStart:clip.atMs,durationMs:clip.durationMs,width:box.width,lastStart:clip.atMs};
          root.dataset.dragging="true";
          try{root.setPointerCapture(event.pointerId);}catch{/* Automation may synthesize pointers without capture ownership. */}
          render({focusId:clip.id});
        });
        button.addEventListener("click",event=>{event.stopPropagation();selectedId=clip.id;onSelect(clip.id);render({focusId:clip.id});});
        lane.append(button);
      }
      row.append(heading,lane);root.append(row);
    }
    renderPlayhead();
    if(focused)Array.from(root.querySelectorAll(".visual-effect-clip")).find(button=>button.dataset.effectId===focused)?.focus({preventScroll:true});
  }
  function movePointer(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(locked||isBusy()){finishPointer(event,true);return;}
    const delta=drag.width>0?Math.round((event.clientX-drag.originX)/drag.width*getDuration()):0;
    const next=clamp(drag.originStart+delta,0,getDuration()-drag.durationMs);
    if(next===drag.lastStart)return;
    try{onMove(drag.id,next);drag.lastStart=next;render({focusId:drag.id});}
    catch{/* Preserve last valid move; editor reports validation failures through the host. */}
  }
  function finishPointer(event,cancelled=false){
    if(!drag||event.pointerId!==drag.pointerId)return;
    const {pointerId}=drag;drag=null;delete root.dataset.dragging;
    try{if(root.hasPointerCapture(pointerId))root.releasePointerCapture(pointerId);}catch{/* Capture may already be lost. */}
    onDragEnd?.({cancelled});render();
  }
  function cancelDrag(){
    if(!drag)return;
    const pointerId=drag.pointerId;drag=null;delete root.dataset.dragging;
    try{if(root.hasPointerCapture(pointerId))root.releasePointerCapture(pointerId);}catch{/* Platform already released capture. */}
    onDragEnd?.({cancelled:true});render();
  }
  function setBusy(value){
    locked=Boolean(value);
    if(locked)cancelDrag();
    render();
  }
  return Object.freeze({render,renderPlayhead,setBusy,getSelection:()=>selectedId,isDragging:()=>drag!==null,
    select(id){selectedId=id;render({focusId:id});},clearSelection(){selectedId=null;render();}});
}
