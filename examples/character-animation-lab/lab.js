import { createCharacterAnimation, createCharacterAnimationPlayer } from "../../src/index.js";

const durationMs = 4000;
const configurations = {
  greeting: [
    { atMs: 0, values: { headRotation: -7, eyeX: 0, eyeY: 0, expression: "neutral", gesture: "neutral" } },
    { atMs: 400, values: { headRotation: 13, eyeX: 0.35, expression: "curious", gesture: "wave" } },
    { atMs: 760, values: { blink: 1 }, easing: "linear" },
    { atMs: 900, values: { blink: 0, mouthOpen: 0.2 } },
    { atMs: 1250, values: { headRotation: -8, eyeX: -0.3, expression: "happy", mouthOpen: 0.8, gesture: "wave" } },
    { atMs: 1650, values: { mouthOpen: 0, gesture: "neutral" } },
    { atMs: 2250, values: { blink: 1 }, easing: "linear" },
    { atMs: 2380, values: { blink: 0, bodyRotation: -4, expression: "focused" } },
    { atMs: 3100, values: { bodyRotation: 4, mouthOpen: 0.55, gesture: "talk" } },
    { atMs: 3520, values: { bodyRotation: 0, mouthOpen: 0, expression: "happy", gesture: "neutral" } }
  ],
  night: [
    { atMs: 0, values: { headRotation: 8, eyeX: -0.2, expression: "focused", gesture: "neutral" } },
    { atMs: 650, values: { headRotation: -13, eyeX: 0.3, expression: "surprised", gesture: "wave" } },
    { atMs: 1000, values: { blink: 1 }, easing: "linear" },
    { atMs: 1140, values: { blink: 0, mouthOpen: 1 } },
    { atMs: 1480, values: { mouthOpen: 0, bodyRotation: 6, expression: "happy" } },
    { atMs: 2160, values: { headRotation: 4, bodyRotation: -5, gesture: "talk", mouthOpen: 0.6 } },
    { atMs: 2650, values: { headRotation: 0, bodyRotation: 0, gesture: "neutral", mouthOpen: 0 } },
    { atMs: 3250, values: { blink: 1 }, easing: "linear" },
    { atMs: 3380, values: { blink: 0, expression: "neutral" } }
  ]
};

const $ = selector => document.querySelector(selector);
const slider = $("#seek");
const stage = $("#stage");
const character = $("#character");
const head = $("#head");
const body = $("#body");
const lids = $("#lids");
const mouth = $("#mouth");
const status = $("#status");
const timeOutput = $("#time");
const spritePreview = $("#spritePreview");
const frameLabel = $("#frameLabel");
let sceneName = "greeting";
let player;
let animation;
let request = 0;
let generation = 0;

function createScene(name) {
  const controller = {
    id: "qarton-original-hero",
    initial: { expression: "neutral" },
    animation: {
      clips: {
        idle: {
          fps: 5,
          loop: true,
          frames: [0, 1, 2, 3],
          spriteSheet: { asset: "greeting-sheet", frameWidth: 80, frameHeight: 60, columns: 2, frameCount: 4 }
        }
      }
    }
  };
  animation = createCharacterAnimation({ character: controller, durationMs, keyframes: configurations[name] });
  player = createCharacterAnimationPlayer(animation);
  stage.dataset.scene = name;
  slider.value = "0";
  $("#channels").textContent = Object.keys(configurations[name][0].values).join(" · ");
  status.textContent = "المشهد جاهز · " + (name === "greeting" ? "التحية" : "ضوء المساء");
}

function paint(state) {
  const headRotate = `rotate(${state.headRotation} 160 140)`;
  const bodyRotate = `rotate(${state.bodyRotation} 160 300)`;
  head.setAttribute("transform", headRotate);
  body.setAttribute("transform", bodyRotate);
  $("#eyes").setAttribute("transform", `translate(${state.eyeX * 5} ${state.eyeY * 5})`);
  lids.setAttribute("opacity", String(state.blink));
  $("#eyes").setAttribute("opacity", String(1 - state.blink));
  mouth.setAttribute("ry", String(2 + state.mouthOpen * 13));
  mouth.setAttribute("rx", String(8 + state.mouthOpen * 5));
  mouth.setAttribute("fill", state.mouthOpen > 0.1 ? "#542639" : "#7d3645");
  const brows = {
    neutral: "M126 113 Q139 107 151 113 M172 113 Q185 107 198 113",
    curious: "M126 108 Q139 99 151 109 M172 113 Q185 107 198 113",
    focused: "M126 117 Q139 108 151 112 M172 112 Q185 108 198 117",
    happy: "M126 112 Q139 102 151 111 M172 111 Q185 102 198 112",
    surprised: "M126 105 Q139 96 151 105 M172 105 Q185 96 198 105"
  };
  $("#browLeft").setAttribute("d", brows[state.expression] ?? brows.neutral);
  if (state.expression === "happy" && state.mouthOpen < 0.1) mouth.setAttribute("ry", "5");
  if (state.expression === "surprised") mouth.setAttribute("rx", "11");
  const waving = state.gesture === "wave" || state.gesture === "talk";
  $("#rightArm").setAttribute("transform", waving ? "rotate(-36 205 253)" : "rotate(0 205 253)");
  $("#leftArm").setAttribute("transform", state.gesture === "talk" ? "rotate(20 113 253)" : "rotate(0 113 253)");
  const labels = { neutral: "محايد", curious: "فضولي", focused: "مركّز", happy: "سعيد", surprised: "متفاجئ" };
  $("#expressionLabel").textContent = labels[state.expression] ?? state.expression;
  character.dataset.expression = state.expression;
  character.dataset.gesture = state.gesture;
  character.dataset.time = String(state.timeMs);
  character.dataset.headRotation = String(state.headRotation);
  character.dataset.eyeX = String(state.eyeX);
  character.dataset.blink = String(state.blink);
  character.dataset.mouthOpen = String(state.mouthOpen);
  if (state.spriteFrame) {
    const frame = state.spriteFrame;
    spritePreview.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
    frameLabel.textContent = `#${frame.index + 1}`;
  }
  slider.value = String(state.timeMs);
  timeOutput.value = (state.timeMs / 1000).toFixed(2);
}

function draw(generationAtRequest) {
  if (generationAtRequest !== generation || !player) return;
  const state = player.sample();
  paint(state);
  if (!player.paused && player.timeMs < durationMs) {
    request = requestAnimationFrame(() => draw(generationAtRequest));
  } else if (player.timeMs >= durationMs) {
    player.pause();
    status.textContent = "اكتمل المشهد · أعد التشغيل أو حرّك المؤشر";
  }
}

function stopScene() {
  generation += 1;
  cancelAnimationFrame(request);
  player?.destroy();
  player = null;
}

function renderNow() {
  cancelAnimationFrame(request);
  paint(player.sample());
}

$("#play").addEventListener("click", () => {
  player.play();
  draw(generation);
});
$("#pause").addEventListener("click", () => {
  paint(player.pause());
});
$("#replay").addEventListener("click", () => {
  player.replay();
  status.textContent = "إعادة من البداية";
  draw(generation);
});
$("#switch").addEventListener("click", () => {
  const next = sceneName === "greeting" ? "night" : "greeting";
  stopScene();
  sceneName = next;
  createScene(sceneName);
  renderNow();
});
slider.addEventListener("input", () => {
  player.seek(slider.valueAsNumber);
  renderNow();
});
window.addEventListener("pagehide", stopScene, { once: true });

createScene(sceneName);
renderNow();
