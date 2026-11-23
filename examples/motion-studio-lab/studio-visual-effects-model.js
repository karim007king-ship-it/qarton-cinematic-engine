import { compileCinematicEffects, sampleCinematicEffects } from "../../src/effects/cinematic-effects.js";

export const VISUAL_EFFECT_TYPES = Object.freeze([
  "fade", "dissolve", "vignette", "letterbox", "shake", "flash", "tint"
]);
export const VISUAL_EFFECT_CHANNELS = Object.freeze({
  fade: Object.freeze([{key:"opacity",label:"الشفافية",min:0,max:1,step:.01},{key:"color",label:"اللون",kind:"color"}]),
  dissolve: Object.freeze([{key:"progress",label:"التقدم",min:0,max:1,step:.01},{key:"color",label:"اللون",kind:"color"}]),
  vignette: Object.freeze([{key:"intensity",label:"الشدة",min:0,max:1,step:.01}]),
  letterbox: Object.freeze([{key:"ratio",label:"ارتفاع الإطار",min:0,max:.2,step:.005}]),
  shake: Object.freeze([{key:"amplitude",label:"السعة",min:0,max:64,step:.1},{key:"frequencyHz",label:"التردد",min:0,max:60,step:.1},{key:"seed",label:"Seed",min:-1000000,max:1000000,step:1,integer:true}]),
  flash: Object.freeze([{key:"intensity",label:"الشدة",min:0,max:1,step:.01},{key:"color",label:"اللون",kind:"color"}]),
  tint: Object.freeze([{key:"strength",label:"القوة",min:0,max:1,step:.01},{key:"color",label:"اللون",kind:"color"}])
});
const TYPES = new Set(VISUAL_EFFECT_TYPES);
const ownObject = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function makeVisualEffectsTrack(seed = 1) {
  if (!Number.isSafeInteger(seed) || Math.abs(seed) > 1_000_000) throw new RangeError("Seed المؤثرات يجب أن يكون عددًا صحيحًا آمنًا بين ±1,000,000.");
  return { version: 1, seed, clips: [] };
}

/** Compile editor metadata by deriving dimensions, duration, and camera from the current Studio project. */
export function compileVisualEffectsTrack(track, project) {
  if (!ownObject(track) || Object.keys(track).sort().join(",") !== "clips,seed,version" || track.version !== 1 ||
      !Number.isSafeInteger(track.seed) || Math.abs(track.seed) > 1_000_000 || !Array.isArray(track.clips)) {
    throw new TypeError("مسار المؤثرات المرئية غير صالح.");
  }
  if (!project?.viewport || !Number.isSafeInteger(project.durationMs)) throw new TypeError("مشروع Motion Studio غير صالح لمسار المؤثرات.");
  const camera = project.camera?.map(({atMs,value}) => ({atMs,...value})) ?? [{atMs:0}];
  return compileCinematicEffects({version:"CinematicEffectsV1",width:project.viewport.width,height:project.viewport.height,
    durationMs:project.durationMs,seed:track.seed,camera,layers:[],clips:track.clips});
}

export function sampleVisualEffects(compiled, atMs) { return sampleCinematicEffects(compiled, atMs); }

function validateCandidate(track, project) {
  compileVisualEffectsTrack(track, project);
  return track;
}

export function addVisualEffect(track, project, type, atMs = 0) {
  if (!TYPES.has(type)) throw new TypeError("نوع المؤثر المرئي غير معروف.");
  if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs > project.durationMs) throw new RangeError("بداية المؤثر خارج مدة المشروع.");
  const defaults = {
    fade:{from:{opacity:0,color:"#000000"},to:{opacity:1,color:"#000000"}},
    dissolve:{from:{progress:0,color:"#000000"},to:{progress:1,color:"#000000"}},
    vignette:{from:{intensity:0},to:{intensity:.65}},
    letterbox:{from:{ratio:0},to:{ratio:.08}},
    shake:{from:{amplitude:8,frequencyHz:8,seed:track.seed},to:{amplitude:0,frequencyHz:8,seed:track.seed}},
    flash:{from:{intensity:1,color:"#ffffff"},to:{intensity:0,color:"#ffffff"}},
    tint:{from:{strength:0,color:"#e7bd69"},to:{strength:.3,color:"#e7bd69"}}
  }[type];
  const durationMs=Math.min(1000,project.durationMs-atMs);
  let suffix=1; while(track.clips.some(clip=>clip.id===`effect-${suffix}`)) suffix++;
  const clip={id:`effect-${suffix}`,type,atMs,durationMs,...defaults,easing:"easeInOutCubic"};
  const next={...track,clips:[...track.clips.map(item=>({...item,from:{...item.from},to:{...item.to}})),clip]};
  return validateCandidate(next,project);
}

export function editVisualEffect(track, project, id, patch) {
  if (!ownObject(patch) || Object.keys(patch).some(key=>!['atMs','durationMs','easing','from','to'].includes(key))) {
    throw new TypeError("تعديل المؤثر يحتوي حقولًا غير مسموحة.");
  }
  let found=false;
  const clips=track.clips.map(clip=>{
    if(clip.id!==id)return {...clip,from:{...clip.from},to:{...clip.to}};
    found=true;
    return {...clip,...patch,
      ...(patch.from?{from:{...clip.from,...patch.from}}:{}),
      ...(patch.to?{to:{...clip.to,...patch.to}}:{})};
  });
  if(!found)throw new TypeError("لم يتم العثور على المؤثر المحدد.");
  return validateCandidate({...track,clips},project);
}

export function moveVisualEffect(track, project, id, atMs) {
  const clip=track.clips.find(item=>item.id===id);
  if(!clip)throw new TypeError("لم يتم العثور على المؤثر المحدد.");
  return editVisualEffect(track,project,id,{atMs});
}

export function deleteVisualEffect(track, project, id) {
  if(!track.clips.some(clip=>clip.id===id))throw new TypeError("لم يتم العثور على المؤثر المحدد.");
  return validateCandidate({...track,clips:track.clips.filter(clip=>clip.id!==id).map(clip=>({...clip,from:{...clip.from},to:{...clip.to}}))},project);
}
