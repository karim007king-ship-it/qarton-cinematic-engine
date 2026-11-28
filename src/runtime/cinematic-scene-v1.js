import { compileTextScene } from "../character/text-cinematic-scene.js";
import { createCameraTrack } from "../camera/camera-track.js";
import { createTimeline } from "../motion/timeline.js";
import { CINEMATIC_MOODS, CINEMATIC_SHOTS, CINEMATIC_TRANSITIONS, compileTextCinematicDirection } from "../effects/cinematic-director.js";

export const CINEMATIC_SCENE_VERSION = "CinematicSceneV1";
export const CINEMATIC_STORY_VERSION = "CinematicStoryV1";
export const CINEMATIC_RUNTIME_STATE_VERSION = "CinematicRuntimeStateV1";
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
const LANGUAGES = new Set(["tn", "ar", "fr", "en"]);
const EXPRESSIONS = new Set(["neutral", "happy", "sad", "angry", "afraid", "surprised", "thinking", "determined", "listening"]);
const SHAPES = new Set(["body", "hand_left", "hand_right", "head", "eyes", "eye_left", "eye_right", "brows", "brow_left", "brow_right", "mouth", "hair_back", "hair_front", "full"]);
const ROLES = new Set(["background", "midground", "foreground"]);
const MOODS = new Set(Object.keys(CINEMATIC_MOODS));
const SHOTS = new Set(Object.keys(CINEMATIC_SHOTS));
const TRANSITIONS = new Set(CINEMATIC_TRANSITIONS);

function object(value, label, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} has unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
  return value;
}
function array(value, label, min = 0, max = 256) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new TypeError(`${label} must contain ${min}–${max} items`);
  for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) throw new TypeError(`${label}[${i}] is missing`);
  return value;
}
function id(value, label) {
  if (typeof value !== "string" || !ID.test(value) || value !== value.toLowerCase()) throw new TypeError(`${label} must be a stable lowercase ID`);
  return value;
}
function text(value, label, max = 5000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(`${label} must be non-empty text of at most ${max} characters`);
  return value.normalize("NFC");
}
function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
  return value;
}
function whole(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  return value;
}
function unique(values, label) {
  const seen = new Set();
  for (const value of values) { if (seen.has(value)) throw new TypeError(`${label} contains duplicate ID ${value}`); seen.add(value); }
}

function normalizeAsset(item, index) {
  object(item, `assets[${index}]`, ["id", "src"], ["type"]);
  const assetId = id(item.id, `assets[${index}].id`);
  const src = text(item.src, `assets[${index}].src`, 2048).trim();
  if (/[\u0000-\u001f\\]/u.test(src) || /^(?:javascript|vbscript):/iu.test(src)) throw new TypeError(`assets[${index}].src is unsafe`);
  if (item.type !== undefined && item.type !== "image") throw new TypeError(`assets[${index}].type must be image`);
  return Object.freeze({ id: assetId, src, type: "image" });
}

function normalizeCharacter(item, index, assetIds) {
  object(item, `characters[${index}]`, ["id", "name", "x", "y", "scale", "z", "facing"], ["assetId", "layers", "expression", "pose", "face", "speed", "focus"]);
  const characterId = id(item.id, `characters[${index}].id`);
  const name = text(item.name, `characters[${index}].name`, 120);
  const x = finite(item.x, `${characterId}.x`, 0, 1), y = finite(item.y, `${characterId}.y`, 0.35, 1);
  const scale = finite(item.scale, `${characterId}.scale`, 0.12, 1.1), z = finite(item.z, `${characterId}.z`, -10000, 10000);
  if (!["left", "right"].includes(item.facing)) throw new TypeError(`${characterId}.facing must be left or right`);
  if ((item.assetId === undefined) === (item.layers === undefined)) throw new TypeError(`${characterId} needs exactly one of assetId or layers`);
  let assetId;
  let layers;
  if (item.assetId !== undefined) { assetId = id(item.assetId, `${characterId}.assetId`); if (!assetIds.has(assetId)) throw new TypeError(`${characterId} references missing asset ${assetId}`); }
  if (item.layers !== undefined) {
      array(item.layers, `${characterId}.layers`, 1, 32);
    const seen = new Set();
    layers = Object.freeze(item.layers.map((layer, layerIndex) => {
      object(layer, `${characterId}.layers[${layerIndex}]`, ["role", "assetId"], ["variant", "view", "layout", "z"]);
      if (!SHAPES.has(layer.role) || layer.role === "full") throw new TypeError(`${characterId}.layers[${layerIndex}].role is unsupported`);
      const partId = id(layer.assetId, `${characterId}.layers[${layerIndex}].assetId`);
      if (!assetIds.has(partId)) throw new TypeError(`${characterId} layer references missing asset ${partId}`);
      const variant = layer.variant ?? "neutral";
      if (!/^[a-z0-9_-]{1,24}$/iu.test(variant)) throw new TypeError(`${characterId} layer variant is invalid`);
      const view = layer.view ?? "any";
      if (!new Set(["any", "front", "side"]).has(view)) throw new TypeError(`${characterId} layer view is unsupported`);
      const key = `${layer.role}:${view}:${variant}`;
      if (seen.has(key)) throw new TypeError(`${characterId} has duplicate layer variant ${key}`);
      seen.add(key);
      const zOrder = whole(layer.z ?? layerIndex, `${characterId}.layers[${layerIndex}].z`, -10000, 10000);
      let layout;
      if (layer.layout !== undefined) {
        object(layer.layout, `${characterId}.layers[${layerIndex}].layout`, [], ["x", "y", "width", "height", "pivotX", "pivotY"]);
        layout = Object.freeze(Object.fromEntries(Object.entries(layer.layout).map(([keyName, value]) => [keyName, finite(value, `${characterId}.layout.${keyName}`, 0, 1)])));
        if (layout.width === 0 || layout.height === 0) throw new RangeError(`${characterId} layer width and height must be positive`);
      }
      return Object.freeze({ role: layer.role, assetId: partId, variant, view, z: zOrder, ...(layout ? { layout } : {}) });
    }));
  }
  const expression = item.expression ?? "listening";
  if (!EXPRESSIONS.has(expression)) throw new TypeError(`${characterId}.expression is unsupported`);
  const pose = item.pose ?? "front";
  if (!new Set(["front", "side", "pose1", "pose2"]).has(pose)) throw new TypeError(`${characterId}.pose is unsupported`);
  const speed = finite(item.speed ?? 1, `${characterId}.speed`, 0.5, 2);
  const focus = item.focus ?? true;
  if (typeof focus !== "boolean") throw new TypeError(`${characterId}.focus must be boolean`);
  let face;
  if (item.face !== undefined) {
    object(item.face, `${characterId}.face`, ["x", "y", "skin"]);
    face = Object.freeze({ x: finite(item.face.x, `${characterId}.face.x`, 0, 1), y: finite(item.face.y, `${characterId}.face.y`, 0, 1), skin: text(item.face.skin, `${characterId}.face.skin`, 24) });
  }
  return Object.freeze({ id: characterId, name, x, y, scale, z, facing: item.facing, expression, pose, speed, focus, ...(assetId ? { assetId } : {}), ...(layers ? { layers } : {}), ...(face ? { face } : {}) });
}

function normalizeLine(item, index, characterIds) {
  object(item, `dialogue[${index}]`, ["id", "speakerId"], ["text", "textId", "translations", "expression", "speed", "motions"]);
  const lineId = id(item.id, `dialogue[${index}].id`), speakerId = id(item.speakerId, `${lineId}.speakerId`);
  if (!characterIds.has(speakerId)) throw new TypeError(`${lineId} references unknown speaker ${speakerId}`);
  if (item.text === undefined && item.textId === undefined) throw new TypeError(`${lineId} requires text or textId`);
  const rawText = item.text === undefined ? null : text(item.text, `${lineId}.text`);
  const textId = item.textId === undefined ? null : id(item.textId, `${lineId}.textId`);
  const translations = {};
  if (item.translations !== undefined) {
    object(item.translations, `${lineId}.translations`, [], ["tn", "ar", "fr", "en"]);
    for (const [lang, value] of Object.entries(item.translations)) translations[lang] = text(value, `${lineId}.translations.${lang}`);
  }
  const expression = item.expression ?? "neutral";
  if (!EXPRESSIONS.has(expression)) throw new TypeError(`${lineId}.expression is unsupported`);
  const speed = item.speed === undefined ? undefined : finite(item.speed, `${lineId}.speed`, 0.5, 2);
  let motions;
  if (item.motions !== undefined) {
    object(item.motions, `${lineId}.motions`, [], ["headRotation", "eyeX", "eyeY", "bodySway", "gesture"]);
    motions = Object.freeze({
      ...(item.motions.headRotation === undefined ? {} : { headRotation: finite(item.motions.headRotation, `${lineId}.motions.headRotation`, -45, 45) }),
      ...(item.motions.eyeX === undefined ? {} : { eyeX: finite(item.motions.eyeX, `${lineId}.motions.eyeX`, -1, 1) }),
      ...(item.motions.eyeY === undefined ? {} : { eyeY: finite(item.motions.eyeY, `${lineId}.motions.eyeY`, -1, 1) }),
      ...(item.motions.bodySway === undefined ? {} : { bodySway: finite(item.motions.bodySway, `${lineId}.motions.bodySway`, -1, 1) }),
      ...(item.motions.gesture === undefined ? {} : { gesture: id(item.motions.gesture, `${lineId}.motions.gesture`) })
    });
  }
  return Object.freeze({ id: lineId, speakerId, text: rawText, textId, translations: Object.freeze(translations), expression, ...(speed === undefined ? {} : { speed }), ...(motions ? { motions } : {}) });
}

function normalizeChoice(item, index, dialogueIds) {
  object(item, `choices[${index}]`, ["id", "afterDialogueId", "prompt", "options"]);
  const choiceId = id(item.id, `choices[${index}].id`), afterDialogueId = id(item.afterDialogueId, `${choiceId}.afterDialogueId`);
  if (!dialogueIds.has(afterDialogueId)) throw new TypeError(`${choiceId} references unknown dialogue ${afterDialogueId}`);
  const options = array(item.options, `${choiceId}.options`, 2, 8).map((option, optionIndex) => {
    object(option, `${choiceId}.options[${optionIndex}]`, ["id", "text"], ["targetSceneId", "endingId", "condition"]);
    const optionId = id(option.id, `${choiceId}.option.id`);
    const targetSceneId = option.targetSceneId === undefined ? null : id(option.targetSceneId, `${choiceId}.${optionId}.targetSceneId`);
    const endingId = option.endingId === undefined ? null : id(option.endingId, `${choiceId}.${optionId}.endingId`);
    if ((targetSceneId === null) === (endingId === null)) throw new TypeError(`${choiceId}.${optionId} needs exactly one targetSceneId or endingId`);
    const condition = option.condition === undefined ? null : text(option.condition, `${choiceId}.${optionId}.condition`, 160);
    return Object.freeze({ id: optionId, text: text(option.text, `${choiceId}.${optionId}.text`, 500), targetSceneId, endingId, condition });
  });
  unique(options.map(option => option.id), `${choiceId}.options`);
  return Object.freeze({ id: choiceId, afterDialogueId, prompt: text(item.prompt, `${choiceId}.prompt`, 1000), options: Object.freeze(options) });
}

function normalizeEvent(item, index, dialogueIds) {
  object(item, `events[${index}]`, ["id", "type"], ["atMs", "afterDialogueId", "payload"]);
  const eventId = id(item.id, `events[${index}].id`);
  if (typeof item.type !== "string" || !/^[a-z][a-z0-9:_-]{0,63}$/u.test(item.type)) throw new TypeError(`${eventId}.type must be a stable lowercase event name`);
  const type = item.type;
  if ((item.atMs === undefined) === (item.afterDialogueId === undefined)) throw new TypeError(`${eventId} needs exactly one of atMs or afterDialogueId`);
  const atMs = item.atMs === undefined ? null : whole(item.atMs, `${eventId}.atMs`, 0, 3_600_000);
  const afterDialogueId = item.afterDialogueId === undefined ? null : id(item.afterDialogueId, `${eventId}.afterDialogueId`);
  if (afterDialogueId && !dialogueIds.has(afterDialogueId)) throw new TypeError(`${eventId} references unknown dialogue ${afterDialogueId}`);
  return Object.freeze({ id: eventId, type, atMs, afterDialogueId, payload: item.payload ?? null });
}

export function compileCinematicSceneV1(input, { resolveText } = {}) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  object(data, CINEMATIC_SCENE_VERSION, ["version", "id", "chapterId", "title", "language", "assets", "backgrounds", "characters", "dialogue", "camera", "direction", "lighting", "effects", "transition", "music", "choices", "flow", "events"], ["durationMs", "manualDialogue"]);
  if (data.version !== CINEMATIC_SCENE_VERSION) throw new TypeError(`Unsupported scene version; expected ${CINEMATIC_SCENE_VERSION}`);
  const sceneId = id(data.id, "scene.id"), chapterId = id(data.chapterId, "scene.chapterId");
  const title = text(data.title, "scene.title", 200);
  if (!LANGUAGES.has(data.language)) throw new TypeError("scene.language must be tn, ar, fr, or en");
  if (data.manualDialogue !== undefined && typeof data.manualDialogue !== "boolean") throw new TypeError("manualDialogue must be boolean");
  const assets = array(data.assets, "scene.assets", 1, 128).map(normalizeAsset);
  unique(assets.map(asset => asset.id), "scene.assets");
  const assetIds = new Set(assets.map(asset => asset.id));
  const backgrounds = array(data.backgrounds, "scene.backgrounds", 1, 32).map((item, index) => {
    object(item, `backgrounds[${index}]`, ["id", "assetId", "role", "z"], ["opacity", "depth", "x", "y", "scale", "fit"]);
    const layerId = id(item.id, `backgrounds[${index}].id`), assetId = id(item.assetId, `${layerId}.assetId`);
    if (!assetIds.has(assetId)) throw new TypeError(`${layerId} references missing asset ${assetId}`);
    if (!ROLES.has(item.role)) throw new TypeError(`${layerId}.role is unsupported`);
    const fit = item.fit ?? "cover";
    if (!new Set(["cover", "contain", "fill"]).has(fit)) throw new TypeError(`${layerId}.fit is unsupported`);
    return Object.freeze({ id: layerId, assetId, role: item.role, z: whole(item.z, `${layerId}.z`, -10000, 10000), opacity: finite(item.opacity ?? 1, `${layerId}.opacity`, 0, 1), depth: finite(item.depth ?? 0, `${layerId}.depth`, -4, 4), x: finite(item.x ?? 0, `${layerId}.x`, -4096, 4096), y: finite(item.y ?? 0, `${layerId}.y`, -4096, 4096), scale: finite(item.scale ?? 1, `${layerId}.scale`, 0.1, 8), fit });
  }).sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  unique(backgrounds.map(layer => layer.id), "scene.backgrounds");
  const characters = array(data.characters, "scene.characters", 1, 8).map((item, index) => normalizeCharacter(item, index, assetIds));
  unique(characters.map(character => character.id), "scene.characters");
  const characterIds = new Set(characters.map(character => character.id));
  const dialogue = array(data.dialogue, "scene.dialogue", 1, 120).map((item, index) => normalizeLine(item, index, characterIds));
  unique(dialogue.map(line => line.id), "scene.dialogue");
  const dialogueIds = new Set(dialogue.map(line => line.id));
  const choices = array(data.choices, "scene.choices", 0, 24).map((item, index) => normalizeChoice(item, index, dialogueIds));
  unique(choices.map(choice => choice.id), "scene.choices");
  const choiceLines = new Set();
  for (const choice of choices) { if (choiceLines.has(choice.afterDialogueId)) throw new TypeError(`Only one choice may follow ${choice.afterDialogueId}`); choiceLines.add(choice.afterDialogueId); }
  const events = array(data.events, "scene.events", 0, 128).map((item, index) => normalizeEvent(item, index, dialogueIds));
  unique(events.map(event => event.id), "scene.events");
  object(data.camera, "scene.camera", ["mode", "shot"], ["timeOfDay", "keyframes"]);
  if (!["auto", "manual"].includes(data.camera.mode)) throw new TypeError("camera.mode must be auto or manual");
  if (!SHOTS.has(data.camera.shot)) throw new TypeError("camera.shot is unsupported");
  const timeOfDay = data.camera.timeOfDay ?? "day";
  if (!["day", "dusk", "night"].includes(timeOfDay)) throw new TypeError("camera.timeOfDay is unsupported");
  const camera = data.camera.keyframes === undefined ? null : createCameraTrack(data.camera.keyframes);
  object(data.direction, "scene.direction", ["mood"], ["seed", "strength", "enabled"]);
  if (!MOODS.has(data.direction.mood)) throw new TypeError("direction.mood is unsupported");
  const directionSettings = Object.freeze({ mood: data.direction.mood, seed: whole(data.direction.seed ?? 1, "direction.seed", -1_000_000, 1_000_000), strength: finite(data.direction.strength ?? 0.75, "direction.strength", 0, 1), enabled: data.direction.enabled ?? true });
  if (typeof directionSettings.enabled !== "boolean") throw new TypeError("direction.enabled must be boolean");
  const lighting = data.lighting ?? {};
  object(lighting, "scene.lighting", [], ["intensity", "tint"]);
  if (lighting.intensity !== undefined) finite(lighting.intensity, "lighting.intensity", 0, 1);
  if (lighting.tint !== undefined && !/^#[\da-f]{6}$/iu.test(lighting.tint)) throw new TypeError("lighting.tint must be #RRGGBB");
  const effects = data.effects ?? {};
  object(effects, "scene.effects", [], ["enabled", "strength"]);
  if (effects.enabled !== undefined && typeof effects.enabled !== "boolean") throw new TypeError("effects.enabled must be boolean");
  if (effects.strength !== undefined) finite(effects.strength, "effects.strength", 0, 1);
  object(data.transition, "scene.transition", ["type", "durationMs"]);
  if (!TRANSITIONS.has(data.transition.type)) throw new TypeError("transition.type is unsupported");
  const transition = Object.freeze({ type: data.transition.type, durationMs: whole(data.transition.durationMs, "transition.durationMs", 0, 10000) });
  object(data.music, "scene.music", ["mood", "intensity", "fadeInMs", "fadeOutMs"]);
  const music = Object.freeze({ mood: text(data.music.mood, "music.mood", 80), intensity: finite(data.music.intensity, "music.intensity", 0, 1), fadeInMs: whole(data.music.fadeInMs, "music.fadeInMs", 0, 30000), fadeOutMs: whole(data.music.fadeOutMs, "music.fadeOutMs", 0, 30000) });
  object(data.flow, "scene.flow", [], ["nextSceneId", "conditions"]);
  const nextSceneId = data.flow.nextSceneId === undefined ? null : id(data.flow.nextSceneId, "flow.nextSceneId");
  const conditions = array(data.flow.conditions ?? [], "flow.conditions", 0, 16).map((condition, index) => {
    object(condition, `flow.conditions[${index}]`, ["id", "expression", "targetSceneId"]);
    return Object.freeze({ id: id(condition.id, `flow.conditions[${index}].id`), expression: text(condition.expression, `flow.conditions[${index}].expression`, 160), targetSceneId: id(condition.targetSceneId, `flow.conditions[${index}].targetSceneId`) });
  });
  unique(conditions.map(condition => condition.id), "flow.conditions");
  const languageAdapter = resolveText ?? ((line, language) => line.translations[language] ?? line.text);
  const resolvedDialogue = dialogue.map(line => {
    const translated = languageAdapter(line, data.language);
    const resolved = typeof translated === "string" && translated.trim() ? translated.normalize("NFC") : line.translations[data.language] ?? line.text;
    if (!resolved) throw new TypeError(`No text is available for dialogue ${line.id} in ${data.language}`);
    return Object.freeze({ id: line.id, speakerId: line.speakerId, text: resolved, expression: line.expression,
      ...(line.textId ? { textId: line.textId } : {}), ...(line.speed === undefined ? {} : { speed: line.speed }), ...(line.motions ? { motions: line.motions } : {}) });
  });
  const compilerLanguage = data.language === "tn" || data.language === "ar" ? data.language : "ar";
  const compiledText = compileTextScene({ id: sceneId, title, language: compilerLanguage, theme: directionSettings.mood === "siege" ? "siege" : directionSettings.mood === "mystery" ? "mystery" : directionSettings.mood === "sad" ? "ruins" : "family", characters, dialogue: resolvedDialogue });
  const dialogueEnd = new Map(compiledText.turns.map(turn => [turn.id, turn.endMs]));
  const durationMs = whole(data.durationMs ?? compiledText.durationMs, "scene.durationMs", compiledText.durationMs, 3_600_000);
  const eventTimeline = createTimeline(events.map(event => ({ id: event.id, type: event.type, atMs: event.atMs ?? dialogueEnd.get(event.afterDialogueId), payload: event.payload })));
  if (eventTimeline.events.some(event => event.atMs > durationMs)) throw new RangeError("Story event occurs after scene duration");
  for (const turn of compiledText.turns) if (turn.endMs > durationMs) throw new RangeError(`Scene duration truncates dialogue ${turn.id}`);
  for (const frame of camera?.keyframes ?? []) if (frame.atMs > durationMs) throw new RangeError("Camera keyframe occurs after scene duration");
  const direction = compileTextCinematicDirection({ durationMs, ...directionSettings, shot: data.camera.shot, timeOfDay, enabled: directionSettings.enabled && (effects.enabled ?? true), strength: effects.strength ?? directionSettings.strength });
  return Object.freeze({ version: CINEMATIC_SCENE_VERSION, id: sceneId, chapterId, title, language: data.language, assets: Object.freeze(assets), backgrounds: Object.freeze(backgrounds), characters: Object.freeze(characters), dialogue: Object.freeze(dialogue), resolvedDialogue: Object.freeze(resolvedDialogue), textScene: compiledText, durationMs, manualDialogue: data.manualDialogue ?? false, choices: Object.freeze(choices), camera: Object.freeze({ mode: data.camera.mode, shot: data.camera.shot, timeOfDay, keyframes: camera }), direction, transition, lighting: Object.freeze({ ...lighting }), effects: Object.freeze({ enabled: effects.enabled ?? true, strength: effects.strength ?? directionSettings.strength }), music, flow: Object.freeze({ nextSceneId, conditions: Object.freeze(conditions) }), events: eventTimeline });
}

export function compileCinematicStoryV1(scenes, { resolveText } = {}) {
  array(scenes, "story.scenes", 1, 128);
  const compiled = scenes.map(scene => compileCinematicSceneV1(scene, { resolveText }));
  unique(compiled.map(scene => scene.id), "story.scenes");
  const byId = new Map(compiled.map(scene => [scene.id, scene]));
  for (const scene of compiled) {
    const targets = [scene.flow.nextSceneId, ...scene.flow.conditions.map(condition => condition.targetSceneId), ...scene.choices.flatMap(choice => choice.options.map(option => option.targetSceneId))].filter(Boolean);
    for (const target of targets) if (!byId.has(target)) throw new TypeError(`Scene ${scene.id} references missing next scene ${target}`);
  }
  return Object.freeze({ version: CINEMATIC_STORY_VERSION, id: `story-${compiled.map(scene => scene.id).join("-").slice(0, 50)}`, scenes: Object.freeze(compiled), byId });
}

export function validateCinematicRuntimeState(state, story) {
  object(state, CINEMATIC_RUNTIME_STATE_VERSION, ["version", "storyId", "sceneId", "timeMs", "transport", "choices", "eventLedger"], ["endingId", "choiceId", "dialogueMode"]);
  if (state.version !== CINEMATIC_RUNTIME_STATE_VERSION || state.storyId !== story.id) throw new TypeError("Runtime state version or story ID does not match");
  const scene = story.byId.get(id(state.sceneId, "state.sceneId"));
  if (!scene) throw new TypeError(`Runtime state references unknown scene ${state.sceneId}`);
  finite(state.timeMs, "state.timeMs", 0, scene.durationMs);
  if (!["ready", "playing", "paused", "waitingForChoice", "waitingForAdvance", "ended", "stopped"].includes(state.transport)) throw new TypeError("state.transport is unsupported");
  if (!["auto", "manual"].includes(state.dialogueMode ?? (scene.manualDialogue ? "manual" : "auto"))) throw new TypeError("state.dialogueMode is unsupported");
  object(state.choices, "state.choices", [], Object.keys(state.choices));
  const choices = {};
  for (const [sceneId, selected] of Object.entries(state.choices)) {
    const owner = story.byId.get(sceneId);
    if (!owner || !selected || typeof selected !== "object" || Array.isArray(selected)) throw new TypeError("state.choices contains an unknown scene or malformed selection");
    choices[sceneId] = {};
    for (const [choiceId, optionId] of Object.entries(selected)) {
      const choice = owner.choices.find(item => item.id === choiceId);
      if (!choice || !choice.options.some(option => option.id === optionId)) throw new TypeError(`state.choices has invalid selection for ${sceneId}.${choiceId}`);
      choices[sceneId][choiceId] = optionId;
    }
  }
  const eventLedger = array(state.eventLedger, "state.eventLedger", 0, 10000).map((key, index) => text(key, `eventLedger[${index}]`, 160));
  unique(eventLedger, "state.eventLedger");
  const endingId = state.endingId === undefined ? null : id(state.endingId, "state.endingId");
  const choiceId = state.choiceId === undefined ? null : id(state.choiceId, "state.choiceId");
  if (state.transport === "waitingForChoice") {
    const pending = scene.choices.find(choice => choice.id === choiceId);
    if (!pending || state.choices?.[scene.id]?.[choiceId]) throw new TypeError("Waiting-choice state must reference an uncommitted choice in the current scene");
    const turn = scene.textScene.turns.find(item => item.id === pending.afterDialogueId);
    if (state.timeMs < turn.endMs) throw new TypeError("Waiting-choice state occurs before its dialogue barrier");
  } else if (choiceId) throw new TypeError("choiceId is only valid while waiting for a choice");
  return Object.freeze({ version: CINEMATIC_RUNTIME_STATE_VERSION, storyId: story.id, sceneId: scene.id, timeMs: state.timeMs, transport: state.transport, choices: Object.freeze(choices), eventLedger: Object.freeze(eventLedger), ...(endingId ? { endingId } : {}), ...(choiceId ? { choiceId } : {}), dialogueMode: state.dialogueMode ?? (scene.manualDialogue ? "manual" : "auto") });
}
