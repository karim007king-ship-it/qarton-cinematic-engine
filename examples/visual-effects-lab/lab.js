import { compileCinematicEffects, createCinematicEffectsPlayer, drawCinematicEffects } from "../../src/effects/cinematic-effects.js";

const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", {alpha:false});
const seek = document.querySelector("#seek");
const clockLabel = document.querySelector("#clock");
const status = document.querySelector("#status");
const project = compileCinematicEffects({version:"CinematicEffectsV1",width:390,height:690,durationMs:6000,seed:28,
  camera:[{atMs:0,x:0,y:0,zoom:1},{atMs:6000,x:-12,y:3,zoom:1.04}],
  layers:[
    {id:"sky",depth:.12,color:"#172b43",speedX:-1,z:0},
    {id:"distant-ridge",depth:.42,color:"#34465b",speedX:-3,z:1},
    {id:"foreground",depth:.9,color:"#426052",speedX:-7,z:2}
  ],clips:[
    {id:"fade-in",type:"fade",atMs:0,durationMs:750,from:{opacity:0,color:"#070b12"},to:{opacity:1,color:"#070b12"},easing:"easeInOutCubic"},
    {id:"camera-shake",type:"shake",atMs:1200,durationMs:1200,from:{amplitude:5,frequencyHz:7,seed:12},to:{amplitude:0,frequencyHz:7,seed:12}},
    {id:"vignette",type:"vignette",atMs:0,durationMs:800,from:{intensity:0},to:{intensity:.58}},
    {id:"bars",type:"letterbox",atMs:600,durationMs:800,from:{ratio:0},to:{ratio:.075}},
    {id:"flash",type:"flash",atMs:1900,durationMs:260,from:{intensity:.85,color:"#fff0cf"},to:{intensity:0,color:"#fff0cf"}},
    {id:"tint",type:"tint",atMs:2700,durationMs:1000,from:{strength:0,color:"#bd493a"},to:{strength:.24,color:"#bd493a"}},
    {id:"dissolve",type:"dissolve",atMs:5000,durationMs:1000,from:{progress:0,color:"#080b10"},to:{progress:1,color:"#080b10"}}
  ]});
const player = createCinematicEffectsPlayer(project);
let frameId = 0;

function draw(time = player.timeMs) {
  const sample = player.seek(time);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Scene landmarks are part of the Canvas 2D sample and stay independent from export.
  for (const layer of sample.layers) {
    ctx.fillStyle=layer.color; ctx.fillRect(layer.x,layer.y,canvas.width,canvas.height);
  }
  ctx.save();
  ctx.translate(195+sample.camera.x,345+sample.camera.y); ctx.rotate(sample.camera.rotation*Math.PI/180); ctx.scale(sample.camera.zoom,sample.camera.zoom); ctx.translate(-195,-345);
  ctx.fillStyle="#d5a865"; ctx.beginPath(); ctx.arc(268+sample.layers[1].x,290+sample.layers[1].y,36,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#cfb99b"; ctx.fillRect(110+sample.layers[2].x,385+sample.layers[2].y,165,172);
  ctx.fillStyle="#17212a"; ctx.fillRect(145+sample.layers[2].x,430+sample.layers[2].y,34,52); ctx.fillRect(207+sample.layers[2].x,430+sample.layers[2].y,34,52);
  ctx.restore();
  // Paint the same authored screen-space effects on the stage, then layer the scene artwork above them.
  drawCinematicEffects(ctx,{...sample,layers:[],camera:{x:0,y:0,zoom:1,rotation:0}});
  seek.value=String(Math.round(time)); clockLabel.value=(time/1000).toFixed(1)+"s"; clockLabel.textContent=clockLabel.value;
}

function stopLoop(){cancelAnimationFrame(frameId);frameId=0;}
function tick(){draw();if(player.timeMs>=player.durationMs){player.pause();status.textContent="انتهى المشهد — اضغط إعادة من البداية";stopLoop();return;}frameId=requestAnimationFrame(tick);}
document.querySelector("#play").addEventListener("click",()=>{player.play();status.textContent="المشهد يعمل";stopLoop();tick();});
document.querySelector("#pause").addEventListener("click",()=>{player.pause();stopLoop();draw();status.textContent="المشهد متوقف مؤقتًا";});
document.querySelector("#replay").addEventListener("click",()=>{player.replay();stopLoop();status.textContent="أُعيد المشهد من البداية";draw(0);});
seek.addEventListener("input",()=>{stopLoop();player.pause();draw(Number(seek.value));status.textContent="تم الانتقال إلى الوقت المحدد";});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&!player.paused){player.pause();stopLoop();draw();status.textContent="أُوقف المشهد عند مغادرة الصفحة";}});
draw(0);
