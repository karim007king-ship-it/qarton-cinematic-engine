import { createCharacterAnimation } from "../../src/character/animation-core.js";

export const CHARACTER_CHANNELS = Object.freeze({
  headRotation: Object.freeze([-60, 60]), eyeX: Object.freeze([-1, 1]), eyeY: Object.freeze([-1, 1]),
  blink: Object.freeze([0, 1]), mouthOpen: Object.freeze([0, 1]), bodyRotation: Object.freeze([-30, 30])
});
export const CHARACTER_INITIAL = Object.freeze({ headRotation: 0, eyeX: 0, eyeY: 0, blink: 0,
  mouthOpen: 0, bodyRotation: 0, expression: "neutral", gesture: "neutral" });
const PLAIN = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ALLOWED_POSE_CHANNELS = new Set([...Object.keys(CHARACTER_CHANNELS), "expression", "gesture"]);
const MAX_CHARACTER_KEYS = 512;

export function makeCharacterTrack() {
  return { character: { id: "studio-character", initial: { ...CHARACTER_INITIAL } }, keyframes: [] };
}

export function compileCharacterTrack(track, durationMs) {
  if (!PLAIN(track) || Object.keys(track).sort().join(",") !== "character,keyframes" ||
      !PLAIN(track.character) || Object.keys(track.character).some(key => !["id", "initial"].includes(key)) ||
      typeof track.character.id !== "string" || !track.character.id.trim() || track.character.id.length > 64 ||
      !Array.isArray(track.keyframes) || track.keyframes.length > MAX_CHARACTER_KEYS) throw new TypeError("مسار الشخصية غير صالح أو يتجاوز 512 مفتاحًا.");
  if (track.character.initial !== undefined && (!PLAIN(track.character.initial) ||
      Object.keys(track.character.initial).some(key => !ALLOWED_POSE_CHANNELS.has(key)))) {
    throw new TypeError("الوضعية الابتدائية للشخصية تحتوي خصائص غير مدعومة.");
  }
  return createCharacterAnimation({ character: track.character, durationMs, keyframes: track.keyframes });
}

function checked(track, keyframes, durationMs) {
  const candidate = { ...track, keyframes: keyframes.map(key => ({ ...key, values: { ...key.values } }))
    .sort((a, b) => a.atMs - b.atMs) };
  compileCharacterTrack(candidate, durationMs);
  return candidate;
}

export function addCharacterKeyframe(track, { atMs, values, easing = "easeInOutCubic" }, durationMs) {
  const animation = compileCharacterTrack(track, durationMs);
  return checked(track, [...track.keyframes, { atMs, values: values ?? animation.sample(atMs), easing }], durationMs);
}
export function updateCharacterKeyframe(track, atMs, values, durationMs) {
  const index = track.keyframes.findIndex(key => key.atMs === atMs);
  if (index < 0) throw new RangeError("لم يتم العثور على المفتاح المحدد.");
  const next = track.keyframes.slice();
  next[index] = { ...next[index], values: { ...next[index].values, ...values } };
  return checked(track, next, durationMs);
}
export function moveCharacterKeyframe(track, fromMs, toMs, durationMs) {
  if (track.keyframes.some(key => key.atMs === toMs && key.atMs !== fromMs)) {
    throw new RangeError("يوجد مفتاح آخر في هذا التوقيت.");
  }
  const index = track.keyframes.findIndex(key => key.atMs === fromMs);
  if (index < 0) throw new RangeError("لم يتم العثور على المفتاح المحدد.");
  const next = track.keyframes.slice();
  next[index] = { ...next[index], atMs: toMs };
  return checked(track, next, durationMs);
}
export function deleteCharacterKeyframe(track, atMs, durationMs) {
  if (!track.keyframes.some(key => key.atMs === atMs)) throw new RangeError("لم يتم العثور على المفتاح المحدد.");
  return checked(track, track.keyframes.filter(key => key.atMs !== atMs), durationMs);
}

/** Paint a lightweight, resolution-independent character overlay using the sampled L7-A pose. */
export function drawCharacter(ctx, pose, width, height) {
  const cx = width * 0.5, cy = height * 0.57, unit = Math.min(width, height) * 0.17;
  ctx.save();
  try {
    ctx.translate(cx, cy);
    ctx.rotate((pose.bodyRotation || 0) * Math.PI / 180);
    ctx.fillStyle = "#e7bd69";
    ctx.beginPath(); ctx.ellipse(0, unit * 1.08, unit * .66, unit * .88, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e8b98c"; ctx.lineWidth = Math.max(3, unit * .095); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const arm = (side, gesture) => {
      const startX = side * unit * .47, startY = unit * .64;
      ctx.beginPath(); ctx.moveTo(startX, startY);
      if (gesture === "shrug") ctx.quadraticCurveTo(side * unit * .78, unit * .15, side * unit * .72, -unit * .05);
      else if (gesture === "wave" && side > 0) ctx.quadraticCurveTo(unit * .9, unit * .25, unit * .74, -unit * .55);
      else if (gesture === "point" && side > 0) ctx.lineTo(unit * 1.08, unit * .42);
      else ctx.quadraticCurveTo(side * unit * .83, unit * .82, side * unit * .88, unit * 1.2);
      ctx.stroke();
    };
    if (pose.gesture === "shrug") { arm(-1, "shrug"); arm(1, "shrug"); }
    else if (pose.gesture === "wave" || pose.gesture === "point") { arm(-1, "neutral"); arm(1, pose.gesture); }
    else { arm(-1, "neutral"); arm(1, "neutral"); }
    ctx.save(); ctx.translate(0, -unit * .35); ctx.rotate((pose.headRotation || 0) * Math.PI / 180);
    ctx.fillStyle = "#e8b98c"; ctx.beginPath(); ctx.arc(0, 0, unit * .58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#292631";
    for (const side of [-1, 1]) {
      const ex = side * unit * .21 + (pose.eyeX || 0) * unit * .12;
      const ey = -unit * .06 + (pose.eyeY || 0) * unit * .12;
      if ((pose.blink || 0) > .82) {
        ctx.strokeStyle = "#292631"; ctx.lineWidth = Math.max(2, unit * .035);
        ctx.beginPath(); ctx.moveTo(ex - unit * .08, ey); ctx.lineTo(ex + unit * .08, ey); ctx.stroke();
      } else { ctx.beginPath(); ctx.ellipse(ex, ey, unit * .055, unit * .09 * (1 - (pose.blink || 0)), 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.strokeStyle = "#292631"; ctx.lineWidth = Math.max(2, unit * .035);
    if (pose.expression === "angry" || pose.expression === "sad") {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        const y = -unit * .19;
        ctx.moveTo(side * unit * .31, y + (pose.expression === "angry" ? side : -side) * unit * .045);
        ctx.lineTo(side * unit * .12, y - (pose.expression === "angry" ? side : -side) * unit * .025);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#6f2838";
    if (pose.expression === "happy" && (pose.mouthOpen || 0) < .12) {
      ctx.beginPath(); ctx.arc(0, unit * .19, unit * .16, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
    } else if (pose.expression === "sad" && (pose.mouthOpen || 0) < .12) {
      ctx.beginPath(); ctx.arc(0, unit * .39, unit * .14, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    } else if (pose.expression === "surprised" && (pose.mouthOpen || 0) < .12) {
      ctx.beginPath(); ctx.ellipse(0, unit * .25, unit * .08, unit * .12, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(0, unit * .25, unit * .13, unit * (.025 + (pose.mouthOpen || 0) * .13), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#f2eee5"; ctx.font = `${Math.max(12, Math.round(unit * .17))}px system-ui`;
    ctx.textAlign = "center"; ctx.fillText(`${pose.expression} · ${pose.gesture}`, 0, unit * 2.25);
  } finally { ctx.restore(); }
}
