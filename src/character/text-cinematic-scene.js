import { compileTextVisemes } from "./text-viseme.js";

export const TEXT_SCENE_DEMOS = Object.freeze([
  Object.freeze({
    title: "وعد في قرطاج", language: "tn", background: ["#282018", "#101116"],
    dialogue: Object.freeze([
      Object.freeze({ speaker: "ليلى", x: 0.31, color: "#bd7364", expression: "thinking", text: "نحسّ اللي الحكاية هاذي مخبّية سرّ كبير…" }),
      Object.freeze({ speaker: "يوسف", x: 0.69, color: "#6888a2", expression: "determined", text: "ما نخليوش الخوف يوقفنا. نمشيو مع بعضنا؟" }),
      Object.freeze({ speaker: "ليلى", x: 0.31, color: "#bd7364", expression: "happy", text: "إي، مع بعضنا نلقاو الحقيقة!" })
    ])
  }),
  Object.freeze({
    title: "رسالة من المدينة", language: "ar", background: ["#27202c", "#0e1118"],
    dialogue: Object.freeze([
      Object.freeze({ speaker: "مريم", x: 0.30, color: "#b78657", expression: "surprised", text: "وصلتني رسالة غريبة قبل قليل… من الذي أرسلها؟" }),
      Object.freeze({ speaker: "آدم", x: 0.69, color: "#64879b", expression: "thinking", text: "لنقرأها بهدوء. ربما تحمل دليلاً مهماً." }),
      Object.freeze({ speaker: "مريم", x: 0.30, color: "#b78657", expression: "afraid", text: "إذاً يجب أن نعرف الحقيقة قبل حلول الليل." })
    ])
  }),
  Object.freeze({
    title: "قرار المواجهة", language: "tn", background: ["#2c1e1c", "#101116"],
    dialogue: Object.freeze([
      Object.freeze({ speaker: "سليم", x: 0.30, color: "#8d645f", expression: "angry", text: "كفّانا وعود كاذبة! الحقيقة لازم تظهر توّة." }),
      Object.freeze({ speaker: "نور", x: 0.69, color: "#7788a1", expression: "sad", text: "نفهم غضبك، أما فمّا عباد تنجم تتضرر…" }),
      Object.freeze({ speaker: "سليم", x: 0.30, color: "#8d645f", expression: "determined", text: "باش نواجهوه، أما نحميوا بعضنا." })
    ])
  })
]);

const EXPRESSION_MOUTH = Object.freeze({ happy: "smile", sad: "frown", angry: "frown", afraid: "small", surprised: "round", thinking: "small", determined: "line", listening: "smile", neutral: "line" });

export function sampleVisibleDialogueText(animation, elapsedMs) {
  if (!animation || typeof animation.text !== "string" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new TypeError("A compiled text-viseme animation and non-negative elapsed time are required");
  }
  const text = animation.text.normalize("NFC");
  let eventIndex = 0, visible = "", previousWasVisible = false;
  for (const character of text) {
    if (/\s/u.test(character)) {
      if (previousWasVisible) visible += character;
      continue;
    }
    if (/[\u064b-\u065f\u0670]/u.test(character)) { if (previousWasVisible) visible += character; continue; }
    const event = animation.events[eventIndex++];
    if (!event || elapsedMs < event.atMs - animation.startMs) break;
    visible += character;
    previousWasVisible = true;
  }
  return visible.trimEnd();
}

export function compileTextScene(dialogue, { language = "tn", speed = 1 } = {}) {
  if (!Array.isArray(dialogue) || dialogue.length < 1 || dialogue.length > 8) throw new TypeError("A text scene needs between 1 and 8 dialogue turns");
  let cursor = 450;
  const turns = dialogue.map((line, index) => {
    if (!line || typeof line.speaker !== "string" || typeof line.text !== "string") throw new TypeError(`Dialogue turn ${index} is invalid`);
    const animation = compileTextVisemes(line.text, { startMs: cursor, speed, language, expression: line.expression });
    const turn = Object.freeze({ ...line, animation, startMs: cursor, endMs: cursor + animation.durationMs });
    cursor = turn.endMs + (/[.!؟?…]$/u.test(line.text) ? 550 : 300);
    return turn;
  });
  return Object.freeze({ language, durationMs: cursor + 500, turns: Object.freeze(turns) });
}

function colorWithAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match) return `rgba(210,174,97,${alpha})`;
  const hex = match[1];
  return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${alpha})`;
}

function drawCharacter(ctx, turn, localMs, sceneMs, active, activeSpeakerX = 0.5) {
  const width = ctx.canvas.width, height = ctx.canvas.height;
  const x = width * turn.x, baseY = height * 0.79;
  const scale = Math.min(width / 720, height / 1280);
  const bob = Math.sin(sceneMs / 620 + turn.x * 8) * 4 * scale;
  const breathe = 1 + Math.sin(sceneMs / 1150 + turn.x * 5) * 0.012;
  const blinkPhase = (sceneMs + turn.x * 930) % 4100;
  const blink = blinkPhase < 190 ? Math.sin(Math.PI * blinkPhase / 190) : 0;
  const pose = turn.animation.sample(Math.max(0, localMs));
  const listening = !active;
  const expression = listening ? "listening" : turn.expression;
  const skin = turn.x < 0.5 ? "#d6a184" : "#c99576";
  const dark = "#17171b";
  ctx.save();
  ctx.translate(x, baseY + bob);
  ctx.scale(scale * (turn.x < 0.5 ? 1 : -1), scale * breathe);

  // Coat, neck and hair form separate layers so each part can move naturally.
  ctx.save(); ctx.rotate(Math.sin(sceneMs / 1750 + turn.x) * 0.035);
  const coat = ctx.createLinearGradient(-122, 0, 126, 0);
  coat.addColorStop(0, colorWithAlpha(turn.color, 0.72)); coat.addColorStop(0.5, turn.color); coat.addColorStop(1, colorWithAlpha(turn.color, 0.7));
  ctx.fillStyle = coat; ctx.beginPath(); ctx.moveTo(-122, 120); ctx.quadraticCurveTo(-104, 20, -48, 12); ctx.lineTo(0, 34); ctx.lineTo(48, 12); ctx.quadraticCurveTo(106, 20, 122, 120); ctx.lineTo(132, 270); ctx.lineTo(-132, 270); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e4d1ba"; ctx.beginPath(); ctx.moveTo(-38, 10); ctx.lineTo(0, 49); ctx.lineTo(38, 10); ctx.lineTo(22, 112); ctx.lineTo(0, 130); ctx.lineTo(-22, 112); ctx.closePath(); ctx.fill();
  ctx.fillStyle = skin; ctx.fillRect(-17, -32, 34, 60);
  const listeningTilt = listening ? Math.sin(sceneMs / 1450 + turn.x * 4) * 0.055 : 0;
  ctx.save(); ctx.translate(0, -108); ctx.rotate(pose.headRotation * Math.PI / 180 + listeningTilt + Math.sin(sceneMs / 2300) * 0.025);
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, 0, 76, 93, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, 8, 62, 76, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, -35, 69, 43, -0.08, Math.PI, Math.PI * 2); ctx.fill();
  // Eyes and brows express the current dramatic state.
  const eyeY = -3, gazeX = pose.eyeX * 4 + (listening ? (activeSpeakerX - turn.x) * 9 : 0);
  const surprised = expression === "surprised" || expression === "afraid";
  const eyeHeight = Math.max(0.2, (surprised ? 9 : 6) * (1 - Math.max(pose.blink, blink)));
  const browTilt = expression === "angry" || expression === "determined" ? 0.22 : expression === "sad" ? -0.17 : 0;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 24, eyeY); ctx.rotate(side * browTilt);
    ctx.fillStyle = "#fff1df"; ctx.beginPath(); ctx.ellipse(0, 0, 12, eyeHeight, 0, 0, Math.PI * 2); ctx.fill();
    if (eyeHeight > 2) { ctx.fillStyle = "#30282a"; ctx.beginPath(); ctx.ellipse(gazeX, 0, 4, Math.min(eyeHeight - 1, 4), 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(0, -16 + browTilt * 18, 12, -11); ctx.stroke(); ctx.restore();
  }
  // Nose and speech mouth are a distinct animated face layer.
  ctx.strokeStyle = "#885c50"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-3, 18); ctx.lineTo(3, 20); ctx.stroke();
  const jaw = active ? pose.mouthOpen : 0;
  ctx.fillStyle = "#552d35"; ctx.beginPath(); ctx.ellipse(0, 43, 12 + jaw * 6, Math.max(2, 2 + jaw * 15), 0, 0, Math.PI * 2); ctx.fill();
  if (!active) {
    ctx.strokeStyle = "#753f44"; ctx.lineWidth = 3; ctx.beginPath();
    const mouth = EXPRESSION_MOUTH[expression];
    if (mouth === "smile") ctx.arc(0, 34, 14, 0.18, Math.PI - 0.18);
    else if (mouth === "frown") ctx.arc(0, 53, 13, Math.PI + 0.22, Math.PI * 2 - 0.22);
    else if (mouth === "round") { ctx.fillStyle = "#552d35"; ctx.ellipse(0, 43, 8, 11, 0, 0, Math.PI * 2); }
    else if (mouth === "small") ctx.ellipse(0, 43, 5, 4, 0, 0, Math.PI * 2);
    else ctx.moveTo(-9, 44), ctx.lineTo(9, 44);
    if (mouth !== "round") ctx.stroke(); else ctx.fill();
  }
  if (active && pose.viseme === "teeth" && jaw > 0.1) { ctx.fillStyle = "#fff0df"; ctx.fillRect(-7, 41, 14, 4); }
  ctx.restore();
  // Hands gesture with the spoken line and settle into a listening pose.
  const gesture = active ? Math.sin(localMs / 370) : Math.sin(sceneMs / 1800) * 0.18;
  ctx.strokeStyle = coat; ctx.lineWidth = 25; ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 79, 50); ctx.rotate(side * (-0.35 + gesture * 0.42));
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(side * (21 + Math.abs(gesture) * 16), 75); ctx.stroke();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(side * (21 + Math.abs(gesture) * 16), 83, 13, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.restore(); ctx.restore();
  return { x, baseY, pose, expression };
}

export function drawTextCinematicScene(ctx, scene, timeMs, { background, transparent = false } = {}) {
  if (!ctx || !scene || !Number.isFinite(timeMs)) throw new TypeError("Canvas context, compiled scene, and time are required");
  const width = ctx.canvas.width, height = ctx.canvas.height;
  const active = scene.turns.find(turn => timeMs >= turn.startMs && timeMs < turn.endMs);
  if (!transparent) {
    const colors = background ?? ["#282018", "#101116"];
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const halo = ctx.createRadialGradient(width / 2, height * 0.42, 12, width / 2, height * 0.42, width * 0.7);
    halo.addColorStop(0, "rgba(213,174,97,.17)"); halo.addColorStop(1, "rgba(213,174,97,0)");
    ctx.fillStyle = halo; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(222,190,126,.15)"; ctx.lineWidth = Math.max(1, width / 500);
    ctx.beginPath(); ctx.moveTo(width * .12, height * .76); ctx.lineTo(width * .12, height * .27); ctx.quadraticCurveTo(width * .5, height * -.04, width * .88, height * .27); ctx.lineTo(width * .88, height * .76); ctx.stroke();
  }
  const activeX = active?.x ?? 0.5;
  for (const turn of scene.turns) {
    const speaking = turn === active;
    const elapsed = Math.max(0, timeMs - turn.startMs);
    const localMs = speaking ? elapsed : timeMs < turn.startMs ? 0 : Math.min(turn.animation.durationMs, timeMs - turn.startMs);
    const actor = drawCharacter(ctx, turn, localMs, timeMs, speaking, active?.x ?? 0.5);
    const glow = speaking ? 0.17 : 0.055;
    const focus = ctx.createRadialGradient(actor.x, height * .71, 15, actor.x, height * .71, width * .30);
    focus.addColorStop(0, `rgba(213,174,97,${glow})`); focus.addColorStop(1, "rgba(213,174,97,0)");
    ctx.fillStyle = focus; ctx.fillRect(0, height * .4, width, height * .46);
    if (speaking) {
      ctx.save(); ctx.direction = "rtl"; ctx.textAlign = "center";
      ctx.font = `600 ${Math.max(18, width * .035)}px system-ui, sans-serif`;
      ctx.fillStyle = "#f7f2e7"; ctx.shadowColor = "#000"; ctx.shadowBlur = 12;
      const fullText = turn.text.length > 100 ? turn.text.slice(0, 98) + "…" : turn.text;
      const text = sampleVisibleDialogueText(turn.animation, elapsed).slice(0, fullText.length);
      ctx.fillText(text, width / 2, height * .91, width * .86);
      ctx.font = `600 ${Math.max(14, width * .025)}px system-ui, sans-serif`; ctx.fillStyle = "#e2bd70";
      ctx.fillText(`${turn.speaker} · ${turn.expression}`, activeX * width, height * .965, width * .4);
      ctx.restore();
    }
  }
  return Object.freeze({ activeSpeaker: active?.speaker ?? "", viseme: active ? active.animation.sample(timeMs - active.startMs).viseme : "rest", expression: active?.expression ?? "neutral", speechActive: Boolean(active) });
}

