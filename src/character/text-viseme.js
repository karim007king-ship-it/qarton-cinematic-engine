import { createCharacterAnimation } from "./animation-core.js";

const REST = "rest";
const GROUPS = Object.freeze({
  closed: new Set(["m", "b", "p", "م", "ب", "پ"]),
  round: new Set(["u", "o", "w", "و", "ؤ"]),
  wide: new Set(["i", "e", "y", "ي", "ئ"]),
  teeth: new Set(["f", "v", "s", "z", "ث", "ذ", "ف", "س", "ز", "ش", "ص"]),
  open: new Set(["a", "ا", "أ", "إ", "آ", "ه", "ح", "ع", "خ", "غ", "ق", "ك", "ج", "د", "ض", "ط", "ت", "ر", "ل", "ن"])
});
const PAUSE_MS = Object.freeze({ ",": 190, "،": 260, ";": 250, "؛": 300, ".": 340, "!": 380, "؟": 430, "?": 430, "…": 620, "\n": 420 });
const EXPRESSIONS = new Set(["neutral", "happy", "sad", "angry", "afraid", "surprised", "thinking", "determined", "listening"]);

export function classifyViseme(character) {
  const letter = String(character ?? "").toLowerCase();
  for (const [viseme, letters] of Object.entries(GROUPS)) if (letters.has(letter)) return viseme;
  return /[\p{L}\p{N}]/u.test(letter) ? "open" : REST;
}

export function compileTextVisemes(text, { startMs = 0, speed = 1, language = "tn", expression = "neutral" } = {}) {
  if (typeof text !== "string" || text.length > 5000) throw new TypeError("Dialogue text must be a string of at most 5000 characters");
  if (!Number.isSafeInteger(startMs) || startMs < 0) throw new RangeError("Dialogue start must be a non-negative integer");
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new RangeError("Dialogue speed must be between 0.5 and 2");
  if (!EXPRESSIONS.has(expression)) throw new TypeError("Unsupported dramatic expression");
  if (!new Set(["tn", "ar"]).has(language)) throw new TypeError("Text visemes support Tunisian Arabic (tn) and Modern Standard Arabic (ar)");
  const unitMs = 88 / speed;
  const events = [];
  let cursor = startMs;
  for (const character of text.normalize("NFC")) {
    const pause = PAUSE_MS[character];
    if (pause) {
      events.push(Object.freeze({ atMs: Math.round(cursor), durationMs: Math.round(pause), viseme: REST, character }));
      cursor += pause;
      continue;
    }
    if (/\s|[\u064b-\u065f\u0670]/u.test(character)) { cursor += unitMs * 0.38; continue; }
    const viseme = classifyViseme(character);
    events.push(Object.freeze({ atMs: Math.round(cursor), durationMs: Math.max(36, Math.round(unitMs)), viseme, character }));
    cursor += unitMs;
  }
  const durationMs = Math.max(1, Math.round(cursor - startMs));
  const keyframes = events.map(event => ({
    atMs: Math.min(durationMs, event.atMs - startMs),
    values: { mouthOpen: event.viseme === "rest" || event.viseme === "closed" ? 0 : event.viseme === "wide" || event.viseme === "teeth" ? 0.38 : 0.72 }
  })).filter((key, index, all) => index === 0 || key.atMs !== all[index - 1].atMs);
  const base = createCharacterAnimation({
    character: { id: "text-dialogue", initial: { expression, mouthOpen: 0 } }, durationMs, keyframes
  });
  function sample(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new RangeError("Text-viseme sample time must be non-negative");
    if (timeMs >= durationMs) return Object.freeze({ ...base.sample(durationMs), mouthOpen: 0, viseme: REST, active: false, expression });
    const event = events.find(item => timeMs >= item.atMs - startMs && timeMs < item.atMs - startMs + item.durationMs);
    const state = base.sample(timeMs);
    return Object.freeze({ ...state, viseme: event?.viseme ?? REST, active: Boolean(event && event.viseme !== REST), expression });
  }
  return Object.freeze({ language, text, startMs, durationMs, events: Object.freeze(events), sample });
}

