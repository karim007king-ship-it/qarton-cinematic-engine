import { AssetManager, createCharacterStage, createCinematicDirector, createSceneClock,
  createScenePackage, sampleCameraTrack, toCameraCSS } from "../../src/index.js";

const stage = document.querySelector("#stage");
const camera = document.querySelector("#camera");
const cast = document.querySelector("#cast");
const status = document.querySelector("#status");
const toggle = document.querySelector("#toggle");
const switcher = document.querySelector("#switch");
const close = document.querySelector("#close");
const seek = document.querySelector("#seek");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let session, frame, revision = 0;

function controls(disabled) {
  for (const element of [toggle, switcher, close, seek]) element.disabled = disabled;
}

async function draw(current, generation) {
  const time = current.clock.time();
  await current.director.update(time);
  if (session !== current || generation !== revision) return;
  camera.style.transform = toCameraCSS(sampleCameraTrack(current.pack.camera, reducedMotion ? 0 : time));
  seek.value = String(time);
  if (time >= current.pack.scene.durationMs) current.clock.pause();
  toggle.textContent = current.clock.paused ? "تشغيل" : "إيقاف مؤقت";
  if (!current.clock.paused) frame = requestAnimationFrame(() => draw(current, generation).catch(fail));
}

function refresh() {
  cancelAnimationFrame(frame);
  return draw(session, ++revision);
}

async function release() {
  ++revision;
  cancelAnimationFrame(frame);
  const previous = session;
  session = null;
  if (previous) {
    try { await previous.director.destroy(); } finally { previous.assets.destroy(); }
  }
}

async function openScene(data, evening) {
  controls(true);
  await release();
  const definition = evening ? { ...data, id: "evening", camera: [{atMs: 0, zoom: 1.08}, {atMs: 5000}] } : data;
  const pack = createScenePackage(definition, { reducedMotion });
  const assets = new AssetManager({ loader: async key => {
    const image = new Image();
    image.src = new URL(key, import.meta.url).href;
    await image.decode();
    return image.src;
  } });
  const characters = createCharacterStage({ root: cast, characters: pack.characters,
    resolveSprite: key => assets.load(key) });
  const director = createCinematicDirector({ characterStage: characters, timeline: pack.timeline,
    onEvent: event => { status.textContent = event.type; } });
  const clock = createSceneClock({ durationMs: pack.scene.durationMs });
  session = { pack, clock, assets, director };
  await assets.preload(pack.imageKeys({maxBackgroundLayers: 2}));
  await director.mount();
  stage.dataset.scene = pack.scene.id;
  await refresh();
  controls(false);
}

async function fail(error) {
  controls(true);
  await release();
  status.textContent = "تعذّر تشغيل المشهد — " + error.message;
}

try {
  const response = await fetch(new URL("./scene.json", import.meta.url));
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  toggle.onclick = () => {
    const {clock, pack} = session;
    if (clock.paused) {
      if (clock.time() >= pack.scene.durationMs) clock.seek(0);
      clock.resume();
    } else clock.pause();
    refresh().catch(fail);
  };
  seek.oninput = () => { session.clock.seek(seek.valueAsNumber); refresh().catch(fail); };
  switcher.onclick = () => openScene(data, stage.dataset.scene !== "evening").catch(fail);
  close.onclick = async () => {
    controls(true);
    await release();
    status.textContent = "تم إغلاق المشهد";
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && session && !session.clock.paused) {
      session.clock.pause();
      refresh().catch(fail);
    }
  });
  await openScene(data, false);
} catch (error) { await fail(error); }
