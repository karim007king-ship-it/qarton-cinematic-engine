import { CinematicRenderer, createCinematicStoryRuntime } from "../../src/index.js";

const $ = id => document.getElementById(id), canvas = $("screen");
const storyData = globalThis.__QARTON_STORY__ ?? await (await fetch("story.json")).json();
const scenes = storyData.scenes, log = [], renderer = new CinematicRenderer(canvas, { quality: "medium" });
let runtime, showAll = false, lastFrame = null, choiceKey = "";

function resolvedAsset(src) { return globalThis.__QARTON_ASSETS__?.[src] ?? src; }
function decodeAsset(src, descriptor) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.decoding = "async";
    img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Image decode failed: ${descriptor.id}`));
    img.src = resolvedAsset(src);
  });
}
function fmt(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
function draw(frame) {
  if (!frame.isCurrent()) return false;
  renderer.render(frame);
  globalThis.__runtimeLastFrame = frame;
  globalThis.__runtimeFrameCount = (globalThis.__runtimeFrameCount ?? 0) + 1;
  const samples = globalThis.__runtimeFrameSamples ??= new Float64Array(18000);
  samples[(globalThis.__runtimeFrameSampleCursor ?? 0) % samples.length] = performance.now();
  globalThis.__runtimeFrameSampleCursor = ((globalThis.__runtimeFrameSampleCursor ?? 0) + 1) % samples.length;
  const { scene, timeMs } = frame, state = runtime.getState(), dialogue = frame.dialogue;
  $("scene-title").textContent = scene.title;
  $("time").textContent = fmt(timeMs);
  $("seek").value = String(Math.round(timeMs / scene.durationMs * 1000));
  $("speaker").textContent = dialogue?.speakerId ? scene.characters.find(item => item.id === dialogue.speakerId)?.name ?? "" : "";
  $("line").textContent = dialogue ? (showAll ? dialogue.text : state.visibleText) : "";
  const choice = frame.choice, host = $("choice");
  const nextChoiceKey = choice ? `${scene.id}:${choice.id}:${choice.options.map(item => item.id).join(",")}` : "";
  if (choiceKey !== nextChoiceKey) {
    choiceKey = nextChoiceKey; host.replaceChildren(); host.hidden = !choice;
    if (choice) {
      const label = document.createElement("b"); label.textContent = choice.prompt; host.append(label);
      for (const option of choice.options) {
        const button = document.createElement("button"); button.type = "button";
        button.dataset.choiceOptionId = option.id; button.textContent = option.text; host.append(button);
      }
    }
  }
  const ending = $("ending"); ending.hidden = !state.endingId; ending.textContent = state.endingId ? `النهاية: ${state.endingId}` : "";
  lastFrame = frame; return true;
}
function showError(error) { $("status").textContent = `خطأ: ${error.message}`; }
function record(event) {
  log.push(`${event.type} · ${event.sceneId}${event.payload?.endingId ? ` · ${event.payload.endingId}` : ""}`);
  $("log").textContent = log.slice(-24).join("\n");
}

runtime = createCinematicStoryRuntime({ scenes, render: draw, decodeAsset,
  transition: payload => renderer.transition(payload), autoPreload: true,
  game: { emit: record, evaluateCondition: async () => false },
  music: { setScene: item => record({ type: `mock-music:${item.mood}`, sceneId: item.sceneId }), stop: () => {} },
  language: { resolve: ({ fallback }) => fallback }
});
globalThis.qartonCinematicRuntime = runtime;
globalThis.qartonCinematicRenderer = renderer;
await runtime.loadScene("home");
$("commit").textContent = `Commit: ${globalThis.__QARTON_COMMIT__ ?? new URLSearchParams(location.search).get("commit") ?? "preview"}`;

$("choice").addEventListener("click", event => {
  const button = event.target.closest("[data-choice-option-id]");
  if (button) runtime.selectChoice(button.dataset.choiceOptionId).catch(showError);
});
$("play").onclick = () => runtime.play().catch(showError);
$("pause").onclick = () => runtime.pause().catch(showError);
$("resume").onclick = () => runtime.resume().catch(showError);
$("skip").onclick = () => runtime.skipDialogue().catch(showError);
$("advance").onclick = () => runtime.advanceDialogue().catch(showError);
$("replay").onclick = () => runtime.replay().catch(showError);
$("show-all").onclick = () => {
  showAll = !showAll;
  $("show-all").textContent = showAll ? "متابعة حركة الكتابة" : "إظهار النص كاملًا";
  if (lastFrame?.dialogue) $("line").textContent = showAll ? lastFrame.dialogue.text : runtime.getState().visibleText;
};
$("seek").onchange = event => {
  const scene = runtime.story.byId.get(runtime.getState().sceneId);
  runtime.seek(scene.durationMs * Number(event.target.value) / 1000).catch(showError);
};
$("save").onclick = () => { localStorage.setItem("qarton-cinematic-save", runtime.exportState()); $("status").textContent = "تم حفظ الحالة"; };
$("restore").onclick = () => {
  const value = localStorage.getItem("qarton-cinematic-save");
  if (!value) { $("status").textContent = "لا توجد حالة محفوظة"; return; }
  runtime.restoreState(value).then(() => $("status").textContent = "تم استرجاع الحالة").catch(showError);
};
window.addEventListener("pagehide", () => { renderer.dispose(); void runtime.dispose(); }, { once: true });
