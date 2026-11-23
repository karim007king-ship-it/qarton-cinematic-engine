import { compileCinematicAudioProject, createCinematicAudioPlayer } from "../../src/audio/cinematic-audio-core.js";

const durationMs = 10_000;
const project = compileCinematicAudioProject({
  durationMs,
  tracks: [
    { id: "dialogue-main", type: "dialogue", volume: 1, clips: [{
      id: "arabic-line", asset: "synthetic-dialogue", startMs: 500, durationMs: 8_000, language: "ar",
      visemes: [
        { atMs: 0, phoneme: "salaam", viseme: "closed" },
        { atMs: 260, phoneme: "a", viseme: "open" },
        { atMs: 680, phoneme: "i", viseme: "wide" },
        { atMs: 1_200, phoneme: "m", viseme: "closed" },
        { atMs: 1_500, phoneme: "alaykum", viseme: "round" },
        { atMs: 2_500, phoneme: "shnuwa", viseme: "wide" },
        { atMs: 3_000, phoneme: "akhbar", viseme: "open" },
        { atMs: 4_050, phoneme: "kum", viseme: "round" },
        { atMs: 5_100, phoneme: "lyum", viseme: "wide" },
        { atMs: 6_400, phoneme: "silence", viseme: "rest" }
      ]
    }] },
    { id: "score", type: "music", volume: 0.28, clips: [{
      id: "ambient-tone", asset: "synthetic-music", startMs: 0, durationMs, loop: true
    }] },
    { id: "effects", type: "sfx", volume: 0.7, clips: [{
      id: "soft-chime", asset: "synthetic-chime", startMs: 3_000, durationMs: 450
    }] }
  ]
});

const character = document.querySelector("#character");
const seek = document.querySelector("#seek");
const status = document.querySelector("#status");
const timeLabel = document.querySelector("#timeLabel");
const visemeLabel = document.querySelector("#visemeLabel");
let context = null;
let animationFrame = 0;
let player;

function ensureAudioContext() {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) throw new Error("Web Audio غير متاح في هذا المتصفح.");
  if (!context) context = new AudioContextType();
  return context.resume();
}

function playTone(asset, options) {
  const audio = context;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const lowpass = audio.createBiquadFilter();
  const frequencies = {
    "synthetic-dialogue": 178,
    "synthetic-music": 110,
    "synthetic-chime": 660
  };
  oscillator.type = asset === "synthetic-chime" ? "sine" : "triangle";
  oscillator.frequency.value = frequencies[asset] ?? 150;
  lowpass.type = "lowpass";
  lowpass.frequency.value = asset === "synthetic-dialogue" ? 780 : 1_600;
  gain.gain.value = 0;
  oscillator.connect(lowpass).connect(gain).connect(audio.destination);
  const now = audio.currentTime;
  const remaining = Math.max(0.04, (durationMsFor(options.id) - options.offsetMs) / 1000);
  const loudness = asset === "synthetic-dialogue" ? 0.12 : asset === "synthetic-chime" ? 0.18 : 0.035;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(loudness * options.volume, now + 0.035);
  if (asset === "synthetic-chime") gain.gain.exponentialRampToValueAtTime(0.0001, now + remaining);
  oscillator.start(now);
  oscillator.stop(now + remaining + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect(); lowpass.disconnect(); gain.disconnect();
  };
  return { oscillator, gain, lowpass, loudness };
}

function durationMsFor(id) {
  return project.clips.find(clip => clip.id === id)?.durationMs ?? 1_000;
}

player = createCinematicAudioPlayer(project, {
  now: () => performance.now(),
  play: playTone,
  stop(voice) {
    try { voice.oscillator.stop(); } catch { /* already ended */ }
    voice.oscillator.disconnect(); voice.lowpass.disconnect(); voice.gain.disconnect();
  },
  setVolume(voice, next) {
    voice.gain.gain.setTargetAtTime(next * voice.loudness, context.currentTime, 0.02);
  }
});

function render(sample = player.sample()) {
  seek.value = String(sample.timeMs);
  timeLabel.value = (sample.timeMs / 1000).toFixed(2);
  const pose = sample.dialogue.at(-1);
  const viseme = pose?.viseme ?? "rest";
  character.dataset.viseme = viseme;
  visemeLabel.textContent = `الفم: ${viseme} • phoneme: ${pose?.phoneme ?? "—"} • اللغة: ${pose?.language === "tn" ? "تونسية" : "عربية"}`;
  status.textContent = player.state === "playing" ? "المشهد يعمل على ساعة واحدة للصوت وحركة الفم." :
    player.state === "ended" ? "انتهى المشهد. اضغط إعادة للتشغيل من البداية." : "المشهد متوقف مؤقتًا؛ تحريك المؤشر لا يغيّر ملف الصوت.";
}

function frame() {
  if (player.state !== "playing") return;
  render(player.tick());
  if (player.state === "playing") animationFrame = requestAnimationFrame(frame);
}

async function play() {
  try {
    await ensureAudioContext();
    render(player.play());
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error.message || "تعذّر تشغيل الصوت في هذا المتصفح.";
  }
}

document.querySelector("#playButton").addEventListener("click", play);
document.querySelector("#pauseButton").addEventListener("click", () => {
  cancelAnimationFrame(animationFrame);
  render(player.pause());
});
document.querySelector("#replayButton").addEventListener("click", async () => {
  try {
    await ensureAudioContext();
    render(player.replay());
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error.message || "تعذّرت إعادة المشهد.";
  }
});
seek.addEventListener("input", () => render(player.seek(Number(seek.value))));
document.querySelector("#masterVolume").addEventListener("input", event => player.setMasterVolume(Number(event.target.value)));
document.querySelector("#dialogueVolume").addEventListener("input", event => player.setTrackVolume("dialogue-main", Number(event.target.value)));
document.querySelector("#musicVolume").addEventListener("input", event => player.setTrackVolume("score", Number(event.target.value)));
document.querySelector("#sfxVolume").addEventListener("input", event => player.setTrackVolume("effects", Number(event.target.value)));
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  player.destroy();
  context?.close();
});

render();
window.cinematicAudioLab = Object.freeze({ player, project });
