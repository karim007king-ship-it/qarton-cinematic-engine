import { compileTextVisemes } from "./text-viseme.js";
import { drawLayeredCharacter } from "./sprite-character.js";

const portraits = Object.freeze({
  layla: Object.freeze({ name: "ليلى", x: 0.31, scale: 0.72, z: 2, face: Object.freeze({ x: 0.55, y: 0.113, skin: "#d99a78" }) }),
  youssef: Object.freeze({ name: "يوسف", x: 0.69, scale: 0.72, z: 1, face: Object.freeze({ x: 0.55, y: 0.109, skin: "#dca47e" }) }),
  nour: Object.freeze({ name: "نور", x: 0.69, scale: 0.72, z: 1, face: Object.freeze({ x: 0.56, y: 0.111, skin: "#d99c76" }) }),
  salim: Object.freeze({ name: "سليم", x: 0.5, scale: 0.56, z: 2, face: Object.freeze({ x: 0.56, y: 0.105, skin: "#d69a74" }) })
});

const characters = (ids) => Object.freeze(ids.map((id, index) => Object.freeze({
  id, name: portraits[id].name, spriteKey: id, x: portraits[id].x, y: 0.82, scale: portraits[id].scale,
  z: portraits[id].z ?? index, face: portraits[id].face, speed: 1
})));

export const TEXT_SCENE_DEMOS = Object.freeze([
  Object.freeze({
    id: "family-promise", title: "وعد في قرطاج", language: "tn", theme: "family",
    characters: characters(["layla", "youssef"]),
    dialogue: Object.freeze([
      Object.freeze({ id: "family-01", speakerId: "layla", expression: "thinking", text: "نحسّ اللي الحكاية هاذي مخبّية سرّ كبير… وما نعرفش شكون نصدّق." }),
      Object.freeze({ id: "family-02", speakerId: "youssef", expression: "determined", text: "ما نخليوش الخوف يوقفنا. نمشيو مع بعضنا ونكتشفو الحقيقة." }),
      Object.freeze({ id: "family-03", speakerId: "layla", expression: "afraid", text: "وإذا كانت الحقيقة توجعنا؟" }),
      Object.freeze({ id: "family-04", speakerId: "youssef", expression: "happy", text: "وقتها نواجهوها مع بعضنا. هذا وعد." })
    ])
  }),
  Object.freeze({
    id: "city-confrontation", title: "مواجهة في المدينة", language: "ar", theme: "ruins",
    characters: characters(["layla", "youssef", "salim"]).map((character, index) => Object.freeze({ ...character, x: [0.22, 0.5, 0.78][index], scale: 0.55, z: index })),
    dialogue: Object.freeze([
      Object.freeze({ id: "confront-01", speakerId: "salim", expression: "angry", text: "كفانا وعودًا كاذبة! لقد انتظرت الحقيقة طويلًا." }),
      Object.freeze({ id: "confront-02", speakerId: "layla", expression: "determined", text: "لن تجدها بالصراخ. أخبرنا أولًا، من أرسل الرسالة؟" }),
      Object.freeze({ id: "confront-03", speakerId: "youssef", expression: "afraid", text: "سليم، فكر في عائلتك. ما زال بإمكاننا حل هذا بهدوء." }),
      Object.freeze({ id: "confront-04", speakerId: "salim", expression: "sad", text: "بعد كل ما حدث، تطلبون مني أن أثق بكم؟" })
    ])
  }),
  Object.freeze({
    id: "rooftop-confession", title: "اعتراف تحت النجوم", language: "tn", theme: "rooftop",
    characters: characters(["nour", "youssef"]),
    dialogue: Object.freeze([
      Object.freeze({ id: "heart-01", speakerId: "nour", expression: "sad", text: "كل ليلة نقول غدوة باش ننسى… أما الذكرى ديما ترجع." }),
      Object.freeze({ id: "heart-02", speakerId: "youssef", expression: "thinking", text: "يمكن ما يلزمكش تنسى. يمكن يلزمك تلقى معنى للي صار." }),
      Object.freeze({ id: "heart-03", speakerId: "nour", expression: "surprised", text: "وتتصور نجم نبدأ من جديد؟" }),
      Object.freeze({ id: "heart-04", speakerId: "youssef", expression: "happy", text: "إي. وموش وحدك المرّة هاذي." })
    ])
  }),
  Object.freeze({
    id: "carthage-siege", title: "دخان فوق قرطاج", language: "ar", theme: "siege",
    characters: characters(["layla", "youssef", "salim"]).map((character, index) => Object.freeze({ ...character, x: [0.23, 0.5, 0.77][index], scale: 0.55, z: index })),
    dialogue: Object.freeze([
      Object.freeze({ id: "siege-01", speakerId: "layla", expression: "afraid", text: "الدخان يقترب من البوابة… علينا أن نخرج الآن!" }),
      Object.freeze({ id: "siege-02", speakerId: "salim", expression: "determined", text: "سأبقى هنا حتى تعبروا. لا تضيّعوا الوقت." }),
      Object.freeze({ id: "siege-03", speakerId: "youssef", expression: "angry", text: "لن نترك أحدًا خلفنا. نخرج معًا!" })
    ])
  })
]);

const EXPRESSION_MOUTH = Object.freeze({ happy: "smile", sad: "frown", angry: "frown", afraid: "small", surprised: "round", thinking: "small", determined: "line", listening: "line", neutral: "line" });
const EXPRESSION_BROW = Object.freeze({ happy: 0.08, sad: -0.2, angry: 0.33, afraid: 0.24, surprised: 0.02, thinking: -0.06, determined: 0.27, listening: 0.04, neutral: 0 });

export function createTextSceneModel({ characters: definitions, dialogue } = {}) {
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 8) throw new TypeError("A cinematic scene needs 1–8 stable character definitions");
  if (!Array.isArray(dialogue) || dialogue.length < 1 || dialogue.length > 120) throw new TypeError("A cinematic scene needs 1–120 dialogue roles");
  const ids = new Set();
  const stableCharacters = definitions.map((item, index) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(item.id) || ids.has(item.id)) throw new TypeError(`Character ${index + 1} needs a unique stable character ID`);
    ids.add(item.id);
    const x = Number(item.x ?? (index + 1) / (definitions.length + 1));
    const y = Number(item.y ?? 0.82);
    const scale = Number(item.scale ?? 0.6);
    const z = Number(item.z ?? index);
    if (![x, y, scale, z].every(Number.isFinite) || x < 0 || x > 1 || y < 0.35 || y > 1 || scale < 0.12 || scale > 1.1) throw new RangeError(`Character ${item.id} has invalid placement or size`);
    return Object.freeze({ ...item, id: item.id, name: String(item.name ?? item.id), x, y, scale, z });
  });
  const byId = new Map(stableCharacters.map(item => [item.id, item]));
  const lines = dialogue.map((line, index) => {
    if (!line || typeof line.id !== "string" || !line.id || typeof line.text !== "string" || !line.text.length || line.text.length > 5000) throw new TypeError(`Dialogue line ${index + 1} is invalid`);
    if (!byId.has(line.speakerId)) throw new TypeError(`Dialogue line ${line.id} references unknown character ${line.speakerId}`);
    return Object.freeze({ ...line, id: line.id, speakerId: line.speakerId, text: line.text.normalize("NFC"), expression: line.expression ?? "neutral" });
  });
  return Object.freeze({ characters: Object.freeze(stableCharacters), dialogue: Object.freeze(lines), characterById: byId });
}

export function sampleVisibleDialogueText(animation, elapsedMs) {
  if (!animation || typeof animation.text !== "string" || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("A compiled text-viseme animation and non-negative elapsed time are required");
  const text = animation.text.normalize("NFC");
  let eventIndex = 0, visible = "", previousWasVisible = false;
  for (const character of text) {
    const isNewline = character === "\n";
    const isMark = /[\u064b-\u065f\u0670]/u.test(character);
    if (isNewline) {
      const event = animation.events[eventIndex++];
      if (!event || elapsedMs < event.atMs - animation.startMs) break;
      visible += character;
      previousWasVisible = false;
      continue;
    }
    if (/\s/u.test(character) || isMark) { if (previousWasVisible) visible += character; continue; }
    const event = animation.events[eventIndex++];
    if (!event || elapsedMs < event.atMs - animation.startMs) break;
    visible += character;
    previousWasVisible = true;
  }
  return visible.trimEnd();
}

export function compileTextScene(input, { language = "tn", speed = 1 } = {}) {
  const model = Array.isArray(input) ? createTextSceneModel({
    characters: [...new Map(input.map((line, index) => [line.speakerId ?? `legacy-${line.speaker}`, { id: line.speakerId ?? `legacy-${line.speaker}`, name: line.speaker, x: line.x, y: 0.82, scale: line.scale ?? 0.6, z: index, color: line.color }])).values()],
    dialogue: input.map((line, index) => ({ ...line, id: line.id ?? `legacy-line-${index + 1}`, speakerId: line.speakerId ?? `legacy-${line.speaker}` }))
  }) : createTextSceneModel(input);
  let cursor = 500;
  const speakingSpeeds = new Map(model.characters.map(character => [character.id, character.speed ?? speed]));
  const turns = model.dialogue.map((line, index) => {
    const character = model.characterById.get(line.speakerId);
    const lineSpeed = line.speed ?? speakingSpeeds.get(character.id) ?? speed;
    const animation = compileTextVisemes(line.text, { startMs: cursor, speed: lineSpeed, language, expression: line.expression });
    const turn = Object.freeze({ ...line, speaker: character.name, character, animation, startMs: cursor, endMs: cursor + animation.durationMs });
    cursor = turn.endMs + (/[.!؟?…]$/u.test(line.text) ? 520 : 300);
    return turn;
  });
  return Object.freeze({ id: input?.id ?? "custom-scene", title: input?.title ?? "مشهد جديد", theme: input?.theme ?? "family", language, characters: model.characters, dialogue: model.dialogue, durationMs: cursor + 450, turns: Object.freeze(turns) });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}

function drawBackdrop(ctx, theme) {
  const { width, height } = ctx.canvas;
  const presets = {
    family: ["#2d241e", "#12141a", "#c69448"],
    ruins: ["#25273a", "#101116", "#7897bc"],
    rooftop: ["#553c4e", "#12131d", "#e5a66f"],
    mystery: ["#101b32", "#080d17", "#98aeca"],
    siege: ["#45271f", "#140e12", "#e87538"]
  };
  const [top, bottom, glowColor] = presets[theme] ?? presets.family;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, top); sky.addColorStop(0.7, bottom); sky.addColorStop(1, "#090a0d");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  const halo = ctx.createRadialGradient(width * 0.5, height * 0.38, 8, width * 0.5, height * 0.38, width * 0.75);
  halo.addColorStop(0, `${glowColor}38`); halo.addColorStop(1, `${glowColor}00`);
  ctx.fillStyle = halo; ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (theme === "family") {
    ctx.fillStyle = "#1011169e"; ctx.beginPath(); ctx.moveTo(width * .08, height * .63); ctx.lineTo(width * .08, height * .22); ctx.quadraticCurveTo(width * .5, height * -.05, width * .92, height * .22); ctx.lineTo(width * .92, height * .63); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#dfbf8740"; ctx.lineWidth = width * .012; ctx.beginPath(); ctx.moveTo(width * .18, height * .62); ctx.lineTo(width * .18, height * .28); ctx.quadraticCurveTo(width * .5, height * .04, width * .82, height * .28); ctx.lineTo(width * .82, height * .62); ctx.stroke();
    ctx.fillStyle = "#b8744330"; ctx.fillRect(0, height * .59, width, height * .13);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(238,194,117,${.025 + i * .006})`; ctx.fillRect(width * (.12 + i * .18), height * .63, width * .035, height * .13); }
  } else if (theme === "ruins") {
    ctx.fillStyle = "#080a12a8"; ctx.fillRect(0, height * .43, width, height * .29);
    for (let i = 0; i < 4; i++) { const x = width * (.08 + i * .23); ctx.fillStyle = "#131721"; ctx.fillRect(x, height * (.31 + (i % 2) * .04), width * .1, height * .4); ctx.beginPath(); ctx.arc(x + width * .05, height * (.31 + (i % 2) * .04), width * .05, Math.PI, 0); ctx.fill(); }
    ctx.strokeStyle = "#c5b9954a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, height * .71); ctx.lineTo(width, height * .71); ctx.stroke();
  } else if (theme === "mystery") {
    ctx.fillStyle = "#080a12c9"; ctx.fillRect(0, height * .42, width, height * .3);
    for (let i = 0; i < 5; i++) { const x = width * (.04 + i * .22), base = height * (.68 - (i % 2) * .08); ctx.fillStyle = i % 2 ? "#121b2a" : "#0d1421"; ctx.fillRect(x, base - height * .23, width * .11, height * .33); ctx.beginPath(); ctx.arc(x + width * .055, base - height * .23, width * .055, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = "#cbd8e8"; ctx.globalAlpha = .58; ctx.beginPath(); ctx.arc(width * .77, height * .19, width * .045, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#080c14"; ctx.fillRect(0, height * .69, width, height * .04);
  } else if (theme === "siege") {
    ctx.fillStyle = "#171115"; ctx.fillRect(0, height * .45, width, height * .28);
    for (let i = 0; i < 4; i++) { const x = width * (.06 + i * .24); ctx.fillStyle = "#241b1b"; ctx.fillRect(x, height * .36, width * .08, height * .35); ctx.fillStyle = "#351d18"; ctx.fillRect(x + width * .11, height * .49, width * .03, height * .22); }
    const fire = ctx.createRadialGradient(width * .25, height * .63, 2, width * .25, height * .63, width * .37); fire.addColorStop(0, "#ed713a75"); fire.addColorStop(1, "#d3422500"); ctx.fillStyle = fire; ctx.fillRect(0, height * .3, width * .8, height * .55);
    ctx.fillStyle = "#090a0d"; ctx.fillRect(0, height * .7, width, height * .04);
  } else {
    ctx.fillStyle = "#11121b99"; ctx.fillRect(0, height * .46, width, height * .22);
    ctx.fillStyle = "#0b0d12"; ctx.beginPath(); ctx.moveTo(0, height * .7); ctx.lineTo(0, height * .58); ctx.lineTo(width * .12, height * .58); ctx.lineTo(width * .12, height * .52); ctx.lineTo(width * .3, height * .52); ctx.lineTo(width * .3, height * .61); ctx.lineTo(width * .49, height * .61); ctx.lineTo(width * .49, height * .54); ctx.lineTo(width * .72, height * .54); ctx.lineTo(width * .72, height * .6); ctx.lineTo(width, height * .6); ctx.lineTo(width, height * .72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e5a66f"; ctx.globalAlpha = .75; ctx.beginPath(); ctx.arc(width * .77, height * .24, width * .065, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.restore();
  const vignette = ctx.createRadialGradient(width / 2, height * .45, height * .18, width / 2, height * .45, height * .85);
  vignette.addColorStop(0, "#0000"); vignette.addColorStop(1, "#040509aa"); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
}

function drawTextBox(ctx, text, speaker, expression, progress, showAll) {
  const { width, height } = ctx.canvas;
  const x = width * .055, y = height * .713, boxW = width * .89, boxH = height * .24;
  ctx.save();
  ctx.fillStyle = "#090a0de8"; roundRect(ctx, x, y, boxW, boxH, width * .028);
  ctx.strokeStyle = "#d5ae6170"; ctx.lineWidth = Math.max(1.5, width / 360); ctx.stroke();
  ctx.fillStyle = "#d5ae61"; ctx.font = `600 ${Math.max(14, width * .029)}px system-ui, sans-serif`; ctx.textAlign = "right"; ctx.direction = "rtl";
  ctx.fillText(`${speaker}  ·  ${expression}`, x + boxW - width * .045, y + height * .044);
  ctx.fillStyle = "#f5f0e6"; ctx.font = `500 ${Math.max(18, width * .034)}px system-ui, sans-serif`;
  const visibleText = showAll ? text : text.slice(0, Math.max(0, Math.ceil(text.length * progress)));
  const maxWidth = boxW - width * .09, lineHeight = Math.max(23, width * .046), maxLines = showAll ? 7 : 3;
  const words = visibleText.split(/(\s+)/u); const lines = []; let line = "";
  for (const word of words) {
    if (word === "\n") { lines.push(line); line = ""; continue; }
    const candidate = line + word;
    if (!line && ctx.measureText(word).width > maxWidth && !/^\s+$/u.test(word)) {
      let chunk = "";
      for (const cluster of [...word]) {
        if (chunk && ctx.measureText(chunk + cluster).width > maxWidth) { lines.push(chunk); chunk = cluster; }
        else chunk += cluster;
      }
      line = chunk;
    } else if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line.trimEnd()); line = word.trimStart();
    } else line = candidate;
  }
  if (line || !lines.length) lines.push(line);
  const pageCount = Math.max(1, Math.ceil(lines.length / maxLines));
  const pageIndex = showAll ? 0 : Math.min(pageCount - 1, Math.floor(progress * pageCount));
  const pageLines = lines.slice(pageIndex * maxLines, (pageIndex + 1) * maxLines);
  pageLines.forEach((item, index) => ctx.fillText(item, x + boxW - width * .045, y + height * .09 + lineHeight * index, maxWidth));
  if (pageCount > 1) { ctx.fillStyle = "#b8a77d"; ctx.font = `${Math.max(10, width * .019)}px system-ui`; ctx.fillText(`صفحة ${pageIndex + 1} / ${pageCount}`, x + boxW - width * .045, y + boxH - height * .018); }
  ctx.restore();
}

function drawFaceRig(ctx, character, x, top, spriteW, spriteH, pose, expression, speaking, expressionWeight, activeSpeakerX) {
  // Full-body anime portraits need a usable mouth/eye rig even when an author
  // has not supplied a bespoke anchor. Prefer explicit anchors for production
  // art; the fallback is calibrated for the local transparent full-body demo.
  const face = character.face ?? { x: 0.53, y: 0.125, skin: "#cf967c" };
  const mirrored = character.facing === "left";
  ctx.save();
  if (mirrored) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
  const fx = x + (face.x - .5) * spriteW, fy = top + face.y * spriteH;
  const width = spriteW * .034, scale = spriteH / 700;
  const mouthOpen = speaking ? pose.mouthOpen : 0;
  const viseme = speaking ? pose.viseme : "rest";
  const brow = (EXPRESSION_BROW[expression] ?? 0) * expressionWeight;
  ctx.save();
  // A small skin patch hides the original painted mouth before the live mouth pose is drawn.
  ctx.fillStyle = face.skin; ctx.beginPath(); ctx.ellipse(fx, fy, width * .56, width * .34, -.08, 0, Math.PI * 2); ctx.fill();
  const mouthW = width * (viseme === "round" ? .48 : viseme === "wide" ? .86 : viseme === "teeth" ? .72 : viseme === "open" ? .62 : .46);
  // Keep each timed pose legible at phone-preview scale: closed is a line, round is
  // nearly circular, wide is a flattened oval, teeth exposes a bright bar, and open
  // is a taller oval. The previous wide/open heights collapsed to about two pixels.
  const open = Math.max(1.2 * scale, viseme === "round" ? width * .52 : viseme === "wide" ? width * .34 : viseme === "teeth" ? width * .46 : viseme === "open" ? width * .78 : mouthOpen * width * .5);
  ctx.fillStyle = "#54232c";
  if (viseme === "round" && speaking) { ctx.beginPath(); ctx.ellipse(fx, fy, width * .23, width * .3, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (speaking && viseme !== "closed" && viseme !== "rest") { ctx.beginPath(); ctx.ellipse(fx, fy, mouthW, Math.max(open, 2), 0, 0, Math.PI * 2); ctx.fill(); }
  else {
    ctx.strokeStyle = expression === "happy" ? "#874b45" : "#65353c"; ctx.lineWidth = Math.max(1, scale * 2.2); ctx.beginPath();
    if (!speaking && expression === "happy") ctx.arc(fx, fy - width * .04, width * .42, .12, Math.PI - .12);
    else if (!speaking && expression === "sad") ctx.arc(fx, fy + width * .38, width * .36, Math.PI + .15, Math.PI * 2 - .15);
    else ctx.moveTo(fx - width * .34, fy); ctx.lineTo(fx + width * .34, fy); ctx.stroke();
  }
  if (speaking && viseme === "teeth" && open > 2) { ctx.fillStyle = "#fff0dc"; ctx.fillRect(fx - mouthW * .6, fy - open * .1, mouthW * 1.2, Math.max(1, open * .28)); }
  // Brows and eyelids add expression while retaining the source character's painted identity.
  const eyeY = fy - width * 2.25, eyeDX = width * 1.55;
  ctx.strokeStyle = "#382623"; ctx.lineWidth = Math.max(1.3, scale * 2.6); ctx.lineCap = "round";
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(fx + side * eyeDX - width * .34, eyeY - brow * width); ctx.quadraticCurveTo(fx + side * eyeDX, eyeY - width * .14 + brow * width, fx + side * eyeDX + width * .34, eyeY - width * .08); ctx.stroke(); }
  ctx.fillStyle = "#5a392e"; ctx.globalAlpha = .62;
  const gaze = Math.max(-1, Math.min(1, (activeSpeakerX - character.x) * 2.2 * (mirrored ? -1 : 1)));
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(fx + side * eyeDX + gaze * width * .2, eyeY + width * .42, width * .11, width * .13, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (pose.blink > .62) { ctx.strokeStyle = face.skin; ctx.lineWidth = Math.max(2, scale * 4); ctx.beginPath(); ctx.moveTo(fx - eyeDX - width * .26, eyeY); ctx.lineTo(fx - eyeDX + width * .26, eyeY); ctx.moveTo(fx + eyeDX - width * .26, eyeY); ctx.lineTo(fx + eyeDX + width * .26, eyeY); ctx.stroke(); }
  ctx.restore();
}

function drawCharacter(ctx, character, art, turn, localMs, sceneMs, active, activeSpeakerX) {
  const { width, height } = ctx.canvas;
  const sampledPose = { ...(turn?.animation.sample(localMs) ?? { headRotation: 0, eyeX: 0, eyeY: 0, blink: 0, mouthOpen: 0, viseme: "rest" }) };
  if (turn?.motions) {
    sampledPose.headRotation += turn.motions.headRotation ?? 0;
    sampledPose.eyeX = turn.motions.eyeX ?? sampledPose.eyeX;
    sampledPose.eyeY = turn.motions.eyeY ?? sampledPose.eyeY;
  }
  const blinkPhase = (sceneMs + character.x * 930) % 4100;
  const naturalBlink = blinkPhase < 155 ? Math.sin(Math.PI * blinkPhase / 155) : 0;
  const pose = { ...sampledPose, blink: Math.max(sampledPose.blink ?? 0, naturalBlink) };
  const expression = active ? turn.expression : (character.expression ?? "listening");
  const image = art?.get?.(character.id) ?? art?.get?.(character.spriteKey) ?? art?.[character.spriteKey];
  if (image?.layers?.length) {
    const spriteH = height * .7 * character.scale * (1 + Math.sin(sceneMs / 1600 + character.x * 5) * .007);
    const spriteW = spriteH * .64;
    const x = width * character.x, top = height * character.y - spriteH + Math.sin(sceneMs / 720 + character.x * 8) * 2.6;
    ctx.save(); ctx.globalAlpha = active ? 1 : .82;
    drawLayeredCharacter(ctx, image.layers, { x, top, width: spriteW, height: spriteH,
      headRotation: (pose.headRotation + Math.sin(sceneMs / 2300 + character.x) * 2.2) * Math.PI / 180,
      armMotion: active ? Math.sin(localMs / 390) * (turn?.motions?.gesture ? .28 : .18) : Math.sin(sceneMs / 1900 + character.x) * .035,
      bodySway: Math.sin(sceneMs / 2700 + character.x) * .012, eyeX: pose.eyeX ?? 0, eyeY: pose.eyeY ?? 0,
      expression, pose: character.pose ?? "front", viseme: pose.viseme, blink: pose.blink > .62, facing: character.facing ?? "right" });
    ctx.restore();
    return { x, pose, expression, top, spriteW, spriteH };
  }
  const source = image?.portrait ?? image?.bitmap ?? image;
  if (!source || !source.width || !source.height) return null;
  const bob = Math.sin(sceneMs / 720 + character.x * 8) * 2.6;
  const breathe = 1 + Math.sin(sceneMs / 1600 + character.x * 5) * .007;
  const spriteH = height * .7 * character.scale * breathe;
  const spriteW = spriteH * source.width / source.height;
  const x = width * character.x, top = height * character.y - spriteH + bob;
  ctx.save(); ctx.globalAlpha = active ? 1 : .82;
  ctx.translate(x, top + spriteH); ctx.scale(character.facing === "left" ? -1 : 1, 1);
  ctx.drawImage(source, -spriteW / 2, -spriteH, spriteW, spriteH);
  ctx.restore();
  const expressionWeight = active ? Math.min(1, Math.max(0, localMs / 340)) : 1;
  drawFaceRig(ctx, character, x, top, spriteW, spriteH, pose, expression, active && pose.active, expressionWeight, activeSpeakerX);
  const focus = ctx.createRadialGradient(x, height * .61, 5, x, height * .61, width * .31);
  focus.addColorStop(0, active ? "#d5ae612b" : "#d5ae610a"); focus.addColorStop(1, "#d5ae6100");
  ctx.fillStyle = focus; ctx.fillRect(Math.max(0, x - width * .32), height * .34, width * .64, height * .39);
  return { x, pose, expression, top, spriteW, spriteH };
}

export function drawTextCinematicScene(ctx, scene, timeMs, { background, transparent = false, assets = new Map(), showAll = false, camera = null, drawSceneOverlay = null, drawDialogue = true } = {}) {
  if (!ctx || !scene || !Number.isFinite(timeMs)) throw new TypeError("Canvas context, compiled scene, and time are required");
  const { width, height } = ctx.canvas;
  const cameraPose = camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 };
  ctx.save();
  ctx.translate(width / 2 + cameraPose.x, height / 2 + cameraPose.y);
  ctx.rotate(cameraPose.rotation * Math.PI / 180);
  ctx.scale(cameraPose.zoom, cameraPose.zoom);
  ctx.translate(-width / 2, -height / 2);
  if (!transparent) drawBackdrop(ctx, scene.theme);
  const active = scene.turns.find(turn => timeMs >= turn.startMs && timeMs < turn.endMs);
  const mostRecent = new Map();
  for (const turn of scene.turns) { if (turn.startMs <= timeMs) mostRecent.set(turn.speakerId, turn); }
  const actors = scene.characters.slice().sort((a, b) => a.z - b.z);
  const drawnCharacterIds = [];
  for (const character of actors) {
    const turn = active?.speakerId === character.id ? active : mostRecent.get(character.id);
    const elapsed = active?.speakerId === character.id ? Math.max(0, timeMs - active.startMs) : turn ? Math.min(turn.animation.durationMs, timeMs - turn.startMs) : 0;
    if (drawCharacter(ctx, character, assets, turn, elapsed, timeMs, active?.speakerId === character.id, active?.character.x ?? .5)) drawnCharacterIds.push(character.id);
  }
  ctx.restore();
  if (typeof drawSceneOverlay === "function") drawSceneOverlay(ctx);
  if (drawDialogue && active) {
    const elapsed = Math.max(0, timeMs - active.startMs);
    const fullText = active.text;
    const visible = showAll ? fullText : sampleVisibleDialogueText(active.animation, elapsed);
    const progress = showAll ? 1 : Math.min(1, elapsed / Math.max(1, active.animation.durationMs));
    drawTextBox(ctx, visible, active.speaker, active.expression, progress, showAll);
  }
  return Object.freeze({ activeSpeaker: active?.speaker ?? "", activeCharacterId: active?.speakerId ?? "", viseme: active ? active.animation.sample(timeMs - active.startMs).viseme : "rest", expression: active?.expression ?? "neutral", speechActive: Boolean(active), renderedCharacterIds: Object.freeze(actors.map(item => item.id)), drawnCharacterIds: Object.freeze(drawnCharacterIds) });
}
