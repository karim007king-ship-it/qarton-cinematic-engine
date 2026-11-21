import { AssetManager, BackgroundRenderer, createAudioCueController, createCharacterStage,
  createCinematicPlayback, createScenePackage, resolveQualityProfile, toCameraCSS } from "../../src/index.js";

const el = id => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const profile = resolveQualityProfile({ reducedMotion, hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory, saveData: navigator.connection?.saveData });
let active, busy = true, frame, generation = 0;

function controls() {
  const state = active?.player.state;
  for (const id of ["seek","play","pause","replay","switch","close"]) el(id).disabled = busy || !active;
  if (active && !busy) {
    el("pause").disabled = state !== "playing";
    el("play").disabled = state === "playing";
    el("play").textContent = state === "paused" ? "استئناف" : "تشغيل";
  }
}

function stopFrames() {
  generation++;
  cancelAnimationFrame(frame);
}

function schedule() {
  stopFrames();
  const token = generation;
  async function tick() {
    if (!active || token !== generation) return;
    try { await active.player.tick(); } catch (error) { return fail(error); }
    if (token !== generation) return;
    if (active.player.state === "playing") frame = requestAnimationFrame(tick);
    else controls();
  }
  if (active?.player.state === "playing") frame = requestAnimationFrame(tick);
}

function fail(error) {
  stopFrames();
  el("status").textContent = "تعذّر تشغيل المشهد — " + error.message;
}

function definition(base, night) {
  return { ...base, id: night ? "moon" : "sun",
    layers: [
      { id:"sky", role:"background", asset:night ? "night.svg" : "sky.svg" },
      { id:"ridge", role:"midground", asset:"ridge.svg",
        keyframes:[{atMs:0, zoom:1.09}, {atMs:5000, x:night ? -10 : 10, zoom:1.09}] }
    ],
    camera: [{atMs:0, zoom:1.02}, {atMs:5000, zoom:night ? 1.15 : 1.09, y:-4}],
    audioCues: [{id:"step",atMs:1000,asset:"step",volume:.08}, {id:"signal",atMs:3000,asset:"signal",volume:.09}]
  };
}

async function prepare(data) {
  const pack = createScenePackage(data, { reducedMotion });
  const root = document.createElement("div");
  root.className = "camera";
  const layers = document.createElement("div"), cast = document.createElement("div");
  layers.className = "layers";
  cast.className = "cast";
  root.append(layers, cast);
  const assets = new AssetManager({ loader: async key => {
    const path = key.startsWith("frames/") ? "../character-lab/" + key :
      key === "night.svg" ? key : "../scene-lab/" + key;
    const image = new Image();
    image.src = new URL(path, import.meta.url).href;
    await image.decode();
    return image.src;
  } });
  const layerRenderer = new BackgroundRenderer({root: layers, resolveAsset:key => assets.load(key)});
  const characterStage = createCharacterStage({root:cast, characters:pack.characters, resolveSprite:key => assets.load(key)});
  let context;
  const audio = createAudioCueController({ cues:pack.audioCues, play(key, options) {
    if (context?.state !== "running") return;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.frequency.value = key === "signal" ? 740 : 180;
    gain.gain.setValueAtTime(options.volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .24);
    osc.connect(gain).connect(context.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      audio.releaseVoice(options.id, osc);
    };
    osc.start(); osc.stop(context.currentTime + .25);
    return osc;
  }, stop(osc) { osc.stop(); } });
  let tracked = [];
  const player = createCinematicPlayback({ pack, characterStage, audio, reducedMotion, present(view) {
    root.style.transform = toCameraCSS(view.camera);
    for (const layer of tracked) layer.style.transform = toCameraCSS(view.layers[layer.dataset.layerId]);
    root.dataset.time = String(view.timeMs);
    if (active?.root === root) display();
  } });
  function display() {
    const t = Number(root.dataset.time);
    const marker = pack.timeline.events.findLast(event => event.atMs <= t);
    const label = (data.id === "moon" ? "ضوء القمر" : "آخر النهار") + " · " + (marker?.type ?? "");
    if (el("status").textContent !== label) el("status").textContent = label;
    el("seek").value = String(t);
    el("time").textContent = (t / 1000).toFixed(1) + " / 5.0 ث";
  }
  async function dispose() {
    try { await player.destroy(); } finally {
      layerRenderer.destroy();
      root.remove();
      assets.destroy();
      if (context && context.state !== "closed") await context.close();
    }
  }
  try {
    await assets.preload(pack.imageKeys(profile));
    await layerRenderer.render(pack.scene, profile);
    tracked = [...layers.children].filter(layer => Object.hasOwn(pack.layerTracks, layer.dataset.layerId));
    await player.mount();
  } catch (error) { await dispose(); throw error; }
  return {root, player, display, dispose, id:data.id, async unlock() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) { context ??= new Audio(); await context.resume(); }
  } };
}

async function change(base, night) {
  const old = active;
  stopFrames();
  await old?.player.pause();
  const next = await prepare(definition(base, night));
  active = next;
  el("stage").replaceChildren(next.root);
  next.display();
  await old?.dispose();
}

async function action(work) {
  if (busy) return;
  busy = true;
  controls();
  stopFrames();
  try { await work(); }
  catch (error) { fail(error); }
  finally { busy = false; controls(); schedule(); }
}

try {
  const response = await fetch(new URL("../character-lab/scene.json", import.meta.url));
  if (!response.ok) throw new Error(String(response.status));
  const base = await response.json();
  await change(base, false);
  el("play").onclick = () => action(async () => { await active.unlock(); await active.player.play(); });
  el("pause").onclick = () => action(() => active.player.pause());
  el("replay").onclick = () => action(async () => { await active.unlock(); await active.player.replay(); });
  el("seek").oninput = () => {
    if (!busy && active) active.player.seek(el("seek").valueAsNumber).then(controls).catch(fail);
  };
  el("switch").onclick = () => action(() => change(base, active.id !== "moon"));
  el("close").onclick = () => action(async () => {
    const previous = active;
    active = null;
    await previous.dispose();
    el("status").textContent = "تم إغلاق المشهد";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && active?.player.state === "playing") action(() => active.player.pause());
  });
  busy = false;
  controls();
} catch (error) { fail(error); }
