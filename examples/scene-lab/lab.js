import {
  BackgroundRenderer, createCharacterStage, createCinematicRuntime,
  createScenePackage, sampleCameraTrack, toCameraCSS
} from "../../src/index.js";

const stage = document.querySelector("#stage");
const status = document.querySelector("#status");
const play = document.querySelector("#play");
const stop = document.querySelector("#stop");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let runtime, pack, active, frame;

async function loadImage(key) {
  const image = new Image();
  image.src = new URL(key, import.meta.url).href;
  await image.decode();
  return image.src;
}

async function prepareScene(scene, profile, { assets }) {
  const camera = document.createElement("div");
  camera.className = "camera";
  const layers = document.createElement("div");
  layers.className = "layers";
  const cast = document.createElement("div");
  cast.className = "cast";
  camera.append(layers, cast);
  const renderer = new BackgroundRenderer({ root: layers, resolveAsset: key => assets.load(key) });
  await renderer.render(scene, profile);
  const characters = createCharacterStage({
    root: cast, characters: pack.characters, resolveSprite: key => assets.load(key)
  });
  await characters.mount();
  return Object.assign(camera, { playback: {
    camera, characters, layers: [...layers.children].filter(layer => pack.layerTracks[layer.dataset.layerId])
  } });
}

async function animate(time, session) {
  if (session !== active) return;
  const elapsed = Math.min(pack.scene.durationMs, Math.max(0, time - session.start));
  const displayTime = reducedMotion ? pack.scene.durationMs : elapsed;
  session.camera.style.transform = toCameraCSS(sampleCameraTrack(pack.camera, displayTime));
  for (const layer of session.layers) {
    const track = pack.layerTracks[layer.dataset.layerId];
    layer.style.transform = toCameraCSS(sampleCameraTrack(track, displayTime));
  }
  await session.characters.update(displayTime);
  if (session === active && displayTime < pack.scene.durationMs) schedule(session);
}

function schedule(session) {
  frame = requestAnimationFrame(time => animate(time, session).catch(report));
}

function report(error) {
  status.textContent = `تعذّر تشغيل المشهد — ${error.message}`;
}

async function show() {
  play.disabled = stop.disabled = true;
  cancelAnimationFrame(frame);
  const previous = active;
  active = null;
  try {
    await runtime.preloadAssets(pack.imageKeys(runtime.getProfile()));
    await runtime.transitionTo(pack.scene, { duration: pack.transitionMs });
    await previous?.characters.destroy();
    active = runtime.currentScene.firstElementChild.playback;
    active.start = performance.now();
    schedule(active);
    status.textContent = "المشهد جاهز";
  } catch (error) {
    active = previous;
    if (active) schedule(active);
    report(error);
  } finally {
    play.disabled = stop.disabled = false;
  }
}

async function close() {
  play.disabled = stop.disabled = true;
  cancelAnimationFrame(frame);
  const previous = active;
  active = null;
  try {
    await previous?.characters.destroy();
  } finally {
    await runtime.destroy();
  }
  status.textContent = "تم إغلاق المشهد";
}

try {
  const response = await fetch(new URL("./scene.json", import.meta.url));
  if (!response.ok) throw new Error(String(response.status));
  pack = createScenePackage(await response.json());
  runtime = createCinematicRuntime({
    root: stage, loadAsset: loadImage, renderScene: prepareScene,
    device: { reducedMotion, saveData: navigator.connection?.saveData, hardwareConcurrency: navigator.hardwareConcurrency }
  });
  play.onclick = show;
  stop.onclick = () => close().catch(report);
  await show();
} catch (error) {
  report(error);
}
