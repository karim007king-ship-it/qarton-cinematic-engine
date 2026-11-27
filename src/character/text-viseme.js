import { createCharacterAnimation } from "./animation-core.js";

const REST = "rest";
const GROUPS = Object.freeze({
  closed: new Set(["m", "b", "p", "م", "ب", "پ"]),
  round: new Set(["u", "o", "w", "و", "ؤ"]),
  wide: new Set(["i", "e", "y", "ي", "ى", "ئ"]),
  teeth: new Set(["f", "v", "s", "z", "ث", "ذ", "ف", "س", "ز", "ش", "ص"]),
  open: new Set(["a", "ا", "أ", "إ", "آ", "ء", "ة", "ه", "ح", "ع", "خ", "غ", "ق", "ك", "ج", "د", "ض", "ط", "ت", "ر", "ل", "ن", "ظ", "ث", "ذ"])
});
const PAUSE_MS = Object.freeze({ ",": 190, "،": 260, ";": 250, "؛": 300, ".": 340, "!": 380, "؟": 430, "?": 430, "…": 620, "\n": 420, "\r": 0 });
const EXPRESSIONS = new Set(["neutral", "happy", "sad", "angry", "afraid", "surprised", "thinking", "determined", "listening"]);
const DIACRITICS = /[\u064b-\u065f\u0670]/u;

export function classifyViseme(character) {
  const source = String(character ?? "").normalize("NFC").toLowerCase();
  const letter = [...source].find(value => !DIACRITICS.test(value)) ?? "";
  const marks = [...source].filter(value => DIACRITICS.test(value));
  if (marks.includes("\u0652")) return "closed";
  if (marks.includes("\u064f") || marks.includes("\u064c")) return "round";
  if (marks.includes("\u0650") || marks.includes("\u064d")) return "wide";
  if (marks.includes("\u064e") || marks.includes("\u064b")) return "open";
  for (const [viseme, letters] of Object.entries(GROUPS)) if (letters.has(letter)) return viseme;
  return /[\p{L}\p{N}]/u.test(letter) ? "open" : REST;
}

function graphemes(text, language) {
  if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter(language === "ar" ? "ar" : "aeb", { granularity: "grapheme" }).segment(text)].map(entry => entry.segment);
  return [...text];
}

export function compileTextVisemes(text, { startMs = 0, speed = 1, language = "tn", expression = "neutral" } = {}) {
  if (typeof text !== "string" || text.length > 5000) throw new TypeError("Dialogue text must be a string of at most 5000 characters");
  if (!Number.isSafeInteger(startMs) || startMs < 0) throw new RangeError("Dialogue start must be a non-negative integer");
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new RangeError("Dialogue speed must be between 0.5 and 2");
  if (!EXPRESSIONS.has(expression)) throw new TypeError("Unsupported dramatic expression");
  if (!new Set(["tn", "ar"]).has(language)) throw new TypeError("Text visemes support Tunisian Arabic (tn) and Modern Standard Arabic (ar)");
  const unitMs = 88 / speed;
  const normalizedText = text.normalize("NFC").replace(/\r\n?/gu, "\n");
  const events = [];
  let cursor = startMs;
  let sourceIndex = 0;
  const parts = graphemes(normalizedText, language);
  for (const cluster of parts) {
    const first = [...cluster][0] ?? "";
    const length = cluster.length;
    const pause = PAUSE_MS[first];
    if (pause !== undefined) {
      if (pause) events.push(Object.freeze({ atMs: Math.round(cursor), durationMs: Math.round(pause), viseme: REST, character: first, sourceIndex }));
      cursor += pause;
      sourceIndex += length;
      continue;
    }
    if (/\s/u.test(first)) { cursor += unitMs * 0.38; sourceIndex += length; continue; }
    if (DIACRITICS.test(first)) { sourceIndex += length; continue; }
    const viseme = classifyViseme(cluster);
    const marks = [...cluster].filter(character => DIACRITICS.test(character));
    const duration = unitMs * (marks.includes("\u0651") ? 1.34 : 1);
    events.push(Object.freeze({ atMs: Math.round(cursor), durationMs: Math.max(36, Math.round(duration)), viseme, character: cluster, sourceIndex }));
    cursor += duration;
    sourceIndex += length;
  }
  const durationMs = Math.max(1, Math.round(cursor - startMs));
  const keyframes = events.map(event => ({
    atMs: Math.min(durationMs, event.atMs - startMs),
    values: { mouthOpen: event.viseme === REST || event.viseme === "closed" ? 0 : event.viseme === "wide" || event.viseme === "teeth" ? 0.36 : event.viseme === "round" ? 0.58 : 0.72 }
  })).filter((key, index, all) => index === 0 || key.atMs !== all[index - 1].atMs);
  const base = createCharacterAnimation({ character: { id: "text-dialogue", initial: { expression, mouthOpen: 0 } }, durationMs, keyframes });
  function sample(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new RangeError("Text-viseme sample time must be non-negative");
    if (timeMs >= durationMs) return Object.freeze({ ...base.sample(durationMs), mouthOpen: 0, viseme: REST, active: false, expression });
    const absolute = startMs + timeMs;
    let low = 0, high = events.length;
    while (low < high) { const middle = (low + high) >> 1; if (events[middle].atMs <= absolute) low = middle + 1; else high = middle; }
    const event = events[low - 1];
    const state = base.sample(timeMs);
    const viseme = event && absolute < event.atMs + event.durationMs ? event.viseme : REST;
    return Object.freeze({ ...state, viseme, active: viseme !== REST, mouthOpen: viseme === REST || viseme === "closed" ? 0 : state.mouthOpen, expression });
  }
  return Object.freeze({ language, text: normalizedText, startMs, durationMs, events: Object.freeze(events), sample });
}
