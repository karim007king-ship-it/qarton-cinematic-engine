import { AssetManager } from "../assets/asset-manager.js";
import { sampleVisibleDialogueText } from "../character/text-cinematic-scene.js";
import { composeCameraPose, sampleCameraTrack } from "../camera/camera-track.js";
import { sampleCinematicDirector } from "../effects/cinematic-director.js";
import { createTimeline, getTimelineEvents } from "../motion/timeline.js";
import { createSceneClock } from "../motion/scene-clock.js";
import { SceneTransitionManager } from "./scene-transition-manager.js";
import { CINEMATIC_RUNTIME_STATE_VERSION, compileCinematicStoryV1, validateCinematicRuntimeState } from "./cinematic-scene-v1.js";

const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();
const defaultRequestFrame = callback => typeof globalThis.requestAnimationFrame === "function"
  ? globalThis.requestAnimationFrame(callback)
  : globalThis.setTimeout(() => callback(defaultNow()), 16);
const defaultCancelFrame = handle => typeof globalThis.cancelAnimationFrame === "function"
  ? globalThis.cancelAnimationFrame(handle)
  : globalThis.clearTimeout(handle);

function drawable(resource) {
  return Boolean(resource && Number(resource.width ?? resource.naturalWidth) > 0 && Number(resource.height ?? resource.naturalHeight) > 0);
}

async function decodeImage(url) {
  if (typeof Image !== "function") throw new Error("Supply decodeAsset() outside a browser runtime");
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

/**
 * Owns decoded assets by scene lease. The existing AssetManager continues to
 * own URL resolution/deduplication; this layer owns decoded bitmap lifetime.
 */
function createDecodedAssetPool({ assetById, decodeAsset, releaseAsset }) {
  const urls = new AssetManager({ loader: key => assetById.get(key)?.src ?? Promise.reject(new Error(`Unknown cinematic asset ${key}`)) });
  const decoded = new Map();
  const pending = new Map();
  const owners = new Map();
  const leaseAssets = new Map();
  let closed = false;

  async function acquire(leaseId, ids) {
    if (closed) throw new Error("Cinematic asset pool has been disposed");
    if (leaseAssets.has(leaseId)) throw new Error(`Asset lease ${leaseId} already exists`);
    const uniqueIds = [...new Set(ids)];
    leaseAssets.set(leaseId, new Set(uniqueIds));
    for (const key of uniqueIds) {
      let references = owners.get(key);
      if (!references) { references = new Set(); owners.set(key, references); }
      references.add(leaseId);
    }
    try {
      await Promise.all(uniqueIds.map(async key => {
        if (decoded.has(key)) return;
        let task = pending.get(key);
        if (!task) {
          task = (async () => {
            const descriptor = assetById.get(key);
            const url = await urls.load(key);
            const value = await decodeAsset(url, descriptor);
            if (!drawable(value)) {
              await releaseAsset(value, descriptor);
              throw new TypeError(`Decoded asset ${key} has no drawable dimensions`);
            }
            if (closed || owners.get(key)?.size === 0) await releaseAsset(value, descriptor);
            else decoded.set(key, value);
            return value;
          })().finally(() => pending.delete(key));
          pending.set(key, task);
        }
        await task;
      }));
      return new Map(uniqueIds.map(key => [key, decoded.get(key) ?? null]));
    } catch (error) {
      await release(leaseId);
      throw error;
    }
  }

  async function release(leaseId) {
    const ids = leaseAssets.get(leaseId);
    if (!ids) return false;
    leaseAssets.delete(leaseId);
    for (const key of ids) {
      const references = owners.get(key);
      references?.delete(leaseId);
      if (references?.size) continue;
      owners.delete(key);
      const resource = decoded.get(key);
      if (resource !== undefined) {
        decoded.delete(key);
        await releaseAsset(resource, assetById.get(key));
      }
      urls.release(key);
    }
    return true;
  }

  async function dispose() {
    if (closed) return;
    closed = true;
    for (const [key, resource] of decoded) await releaseAsset(resource, assetById.get(key));
    decoded.clear(); owners.clear(); leaseAssets.clear(); urls.destroy();
    await Promise.allSettled(pending.values());
    pending.clear();
  }

  return Object.freeze({ acquire, release, dispose, get count() { return decoded.size; },
    get decodedBytes() { return [...decoded.values()].reduce((total, resource) => total + Number(resource.width ?? resource.naturalWidth) * Number(resource.height ?? resource.naturalHeight) * 4, 0); },
    get leaseCount() { return leaseAssets.size; } });
}

/**
 * Host-agnostic story runtime. A host supplies drawing and decoded-image
 * adapters; no Motion Studio DOM, audio context, microphone, or remote service
 * is created here.
 */
export function createCinematicStoryRuntime({ scenes, render, decodeAsset = decodeImage, releaseAsset = resource => resource?.close?.(),
  transition, game = {}, music = {}, language = {}, now = defaultNow, requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame, onState = () => {}, onError = () => {}, autoPreload = true } = {}) {
  if (typeof render !== "function") throw new TypeError("Cinematic runtime requires render(frame)");
  if (typeof decodeAsset !== "function" || typeof releaseAsset !== "function") throw new TypeError("Asset adapters must be functions");
  if (transition !== undefined && typeof transition !== "function") throw new TypeError("transition must be a function");
  if (typeof now !== "function" || typeof requestFrame !== "function" || typeof cancelFrame !== "function") throw new TypeError("Clock and frame adapters must be functions");
  if (typeof onState !== "function" || typeof onError !== "function") throw new TypeError("onState and onError must be functions");
  for (const [name, adapter, methods] of [["game", game, ["emit", "evaluateCondition"]], ["music", music, ["setScene", "stop"]], ["language", language, ["resolve"]]]) {
    if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) throw new TypeError(`${name} adapter must be an object`);
    for (const method of methods) if (adapter[method] !== undefined && typeof adapter[method] !== "function") throw new TypeError(`${name}.${method} must be a function`);
  }
  if (typeof autoPreload !== "boolean") throw new TypeError("autoPreload must be boolean");

  const resolveText = language.resolve
    ? (line, locale) => language.resolve({ textId: line.textId ?? line.id, language: locale, fallback: line.translations[locale] ?? line.text })
    : undefined;
  const story = compileCinematicStoryV1(scenes, { resolveText });
  const assetById = new Map();
  for (const scene of story.scenes) for (const asset of scene.assets) {
    const existing = assetById.get(asset.id);
    if (existing && existing.src !== asset.src) throw new TypeError(`Shared asset ${asset.id} has conflicting sources`);
    assetById.set(asset.id, asset);
  }
  const assets = createDecodedAssetPool({ assetById, decodeAsset, releaseAsset });
  let state = "empty", activeClock = null, activeToken = null, currentScene = null, currentAssets = new Map();
  let currentTime = 0, eventCursor = -1, frameHandle = null, choiceWaitId = null, endingId = null;
  let dialogueMode = null, disposalPromise = null, loadSequence = 0, preloadToken = null;
  let commandQueue = Promise.resolve();
  const eventLedger = new Set(), selectedChoices = new Map(), busyEvents = new Set();
  const stateCallbacks = new Set([onState]);
  const transitions = new SceneTransitionManager({
    mount: async scene => {
      const token = `scene:${scene.id}:${++loadSequence}`;
      const imageAssets = await assets.acquire(token, scene.assets.map(item => item.id));
      return Object.freeze({ scene, token, assets: imageAssets });
    },
    crossfade: payload => transition ? transition({ ...payload, durationMs: payload.duration }) : true,
    unmount: handle => assets.release(handle.token),
    duration: 350
  });

  function run(command) {
    if (disposalPromise) return Promise.reject(new Error("Cinematic story runtime is disposed"));
    const work = commandQueue.then(command, command);
    commandQueue = work.catch(() => {});
    return work;
  }
  function snapshot() {
    if (!currentScene) return Object.freeze({ storyId: story.id, sceneId: null, timeMs: 0, transport: state, dialogueMode: dialogueMode ?? "auto", dialogueIndex: -1, visibleText: "", activeSpeakerId: null, pendingChoiceId: null, choices: Object.freeze({}), endingId });
    const timeMs = activeClock?.time() ?? currentTime;
    const turns = currentScene.textScene.turns;
    const dialogueIndex = turns.findIndex(turn => timeMs < turn.endMs);
    const candidate = dialogueIndex >= 0 ? turns[dialogueIndex] : turns.at(-1);
    const turn = candidate && timeMs >= candidate.startMs && timeMs < candidate.endMs ? candidate : null;
    const line = candidate;
    const localMs = line ? Math.max(0, Math.min(line.animation.durationMs, timeMs - line.startMs)) : 0;
    return Object.freeze({ storyId: story.id, sceneId: currentScene.id, chapterId: currentScene.chapterId, timeMs,
      transport: state, dialogueMode: dialogueMode ?? (currentScene.manualDialogue ? "manual" : "auto"),
      dialogueIndex, dialogueId: line?.id ?? null, activeSpeakerId: turn?.speakerId ?? null,
      visibleText: line ? sampleVisibleDialogueText(line.animation, localMs) : "",
      viseme: turn?.animation.sample(localMs).viseme ?? "rest", pendingChoiceId: choiceWaitId,
      choices: Object.freeze(Object.fromEntries([...selectedChoices].map(([sceneId, values]) => [sceneId, Object.freeze(Object.fromEntries(values))]))),
      endingId });
  }
  function notifyState() {
    const value = snapshot();
    for (const callback of stateCallbacks) { try { callback(value); } catch (error) { reportError(error); } }
    return value;
  }
  function reportError(error) { try { onError(error); } catch { /* host error reporting must not break clock cleanup */ } }
  async function emit(event) {
    const key = `${event.sceneId}:${event.id}`;
    if (eventLedger.has(key) || busyEvents.has(key)) return false;
    busyEvents.add(key);
    try {
      await game.emit?.(Object.freeze({ ...event, eventKey: key }));
      eventLedger.add(key);
      return true;
    } finally { busyEvents.delete(key); }
  }
  function cancelScheduledFrame() {
    if (frameHandle === null) return;
    cancelFrame(frameHandle); frameHandle = null;
  }
  function activeTime() { return activeClock ? activeClock.time() : currentTime; }
  function updateCurrentTime(value) { currentTime = Math.max(0, Math.min(currentScene.durationMs, value)); }
  function isChoiceSelected(scene, choice) { return selectedChoices.get(scene.id)?.has(choice.id) ?? false; }
  function choiceAt(scene, timeMs) {
    return scene.choices.find(choice => !isChoiceSelected(scene, choice) && scene.textScene.turns.find(turn => turn.id === choice.afterDialogueId)?.endMs <= timeMs) ?? null;
  }
  function manualBoundary(scene, timeMs) {
    if (dialogueMode !== "manual") return null;
    return scene.textScene.turns.find(turn => turn.endMs > timeMs && !isChoiceSelected(scene, scene.choices.find(choice => choice.afterDialogueId === turn.id) ?? { id: "" }))?.endMs ?? null;
  }
  async function drawAt(timeMs, transport = state) {
    if (!currentScene) return;
    updateCurrentTime(timeMs);
    const rawDirection = sampleCinematicDirector(currentScene.direction, currentTime);
    const camera = currentScene.camera.mode === "manual" && currentScene.camera.keyframes
      ? sampleCameraTrack(currentScene.camera.keyframes, currentTime)
      : rawDirection.effects.camera;
    const pose = composeCameraPose(camera, rawDirection.effects.shake);
    const currentHandle = transitions.current;
    const playback = snapshot();
    const activeTurn = playback.activeSpeakerId ? currentScene.textScene.turns[playback.dialogueIndex] ?? null : null;
    const activeElapsed = activeTurn ? Math.max(0, Math.min(activeTurn.animation.durationMs, currentTime - activeTurn.startMs)) : 0;
    const activeMouth = activeTurn?.animation.sample(activeElapsed) ?? null;
    const activeDialogue = activeTurn ? Object.freeze({ id: activeTurn.id, speakerId: activeTurn.speakerId,
      text: activeTurn.text, textId: activeTurn.textId ?? null, expression: activeTurn.expression ?? "neutral",
      visibleText: playback.visibleText, startMs: activeTurn.startMs, endMs: activeTurn.endMs,
      progress: activeTurn.animation.durationMs ? activeElapsed / activeTurn.animation.durationMs : 1,
      viseme: activeMouth?.viseme ?? "rest", motions: activeTurn.motions ?? Object.freeze({}) }) : null;
    const characterStates = Object.freeze(Object.fromEntries(currentScene.characters.map(character => {
      const speaking = activeTurn?.speakerId === character.id;
      return [character.id, Object.freeze({ characterId: character.id, isSpeaking: speaking,
        expression: speaking ? activeTurn.expression ?? "neutral" : "listening",
        viseme: speaking ? activeMouth?.viseme ?? "rest" : "rest",
        motions: speaking ? activeTurn.motions ?? Object.freeze({}) : Object.freeze({}),
        focused: Boolean(speaking && character.focus) })];
    })));
    const characterAssets = new Map();
    for (const character of currentScene.characters) {
      if (character.assetId) characterAssets.set(character.id, currentAssets.get(character.assetId));
      else characterAssets.set(character.id, { layers: character.layers.map(layer => ({ role: layer.role, variant: layer.variant, z: layer.z, ...(layer.layout ? { layout: layer.layout } : {}), image: currentAssets.get(layer.assetId) })) });
    }
    await render(Object.freeze({ scene: currentScene, timeMs: currentTime, transport,
      assets: currentAssets, characterAssets, camera: Object.freeze({ ...pose, zoom: pose.zoom * rawDirection.shotScale }),
      direction: rawDirection, dialogue: activeDialogue, characterStates,
      focusCharacterId: activeDialogue && currentScene.camera.mode === "auto" && currentScene.characters.find(character => character.id === activeDialogue.speakerId)?.focus !== false ? activeDialogue.speakerId : null,
      choice: choiceWaitId ? currentScene.choices.find(item => item.id === choiceWaitId) ?? null : null,
      endingId, transitionHandle: currentHandle }));
    notifyState();
  }
  async function moveForward(timeMs, { dispatch = true } = {}) {
    const next = Math.max(currentTime, Math.min(currentScene.durationMs, timeMs));
    if (dispatch && next > eventCursor) {
      const events = getTimelineEvents(currentScene.events, { fromMs: eventCursor, toMs: next });
      for (const item of events) await emit({ id: item.id, type: item.type, sceneId: currentScene.id, chapterId: currentScene.chapterId, atMs: item.atMs, payload: item.payload });
    }
    eventCursor = next; updateCurrentTime(next);
    activeClock?.seek(next);
    return next;
  }
  async function routeAfterScene(scene) {
    for (const condition of scene.flow.conditions) {
      if (await game.evaluateCondition?.(condition.expression, snapshot())) return condition.targetSceneId;
    }
    return scene.flow.nextSceneId;
  }
  async function preloadNext(scene = currentScene) {
    if (!autoPreload || !scene) return null;
    const targetId = await routeAfterScene(scene);
    if (!targetId) return null;
    return preloadAssetsInternal(targetId);
  }
  async function enterScene(scene, { restore = false, autoplay = false } = {}) {
    cancelScheduledFrame();
    const previousState = state;
    state = "loading"; notifyState();
    try {
      const result = await transitions.transitionTo(scene, null, { duration: scene.transition.durationMs });
      if (!result) { state = previousState; notifyState(); return false; }
      const handle = transitions.current;
      currentScene = handle.scene; activeToken = handle.token; currentAssets = handle.assets;
      activeClock = createSceneClock({ durationMs: currentScene.durationMs, now });
      currentTime = 0; eventCursor = -1; choiceWaitId = null; dialogueMode = currentScene.manualDialogue ? "manual" : "auto";
      activeClock.seek(0); activeClock.pause(); state = "ready";
      await drawAt(0, state);
      if (!restore) {
        await emit({ id: "scene-start", type: "scene:start", sceneId: currentScene.id, chapterId: currentScene.chapterId, atMs: 0, payload: { title: currentScene.title } });
        await music.setScene?.(Object.freeze({ sceneId: currentScene.id, chapterId: currentScene.chapterId, ...currentScene.music }));
      } else await music.setScene?.(Object.freeze({ sceneId: currentScene.id, chapterId: currentScene.chapterId, ...currentScene.music, restore: true }));
      if (preloadToken) { await assets.release(preloadToken); preloadToken = null; }
      if (autoPreload && !restore) void preloadNext(currentScene).catch(reportError);
      if (autoplay) await playInternal();
      return true;
    } catch (error) {
      state = previousState; notifyState(); throw error;
    }
  }
  async function preloadAssetsInternal(sceneId) {
    const scene = story.byId.get(sceneId);
    if (!scene) throw new TypeError(`Unknown scene ${sceneId}`);
    if (scene.id === currentScene?.id) return Object.freeze({ sceneId, assets: scene.assets.length, reused: true });
    const token = `preload:${scene.id}:${++loadSequence}`;
    const previous = preloadToken;
    preloadToken = token;
    try {
      await assets.acquire(token, scene.assets.map(asset => asset.id));
      if (previous) await assets.release(previous);
      return Object.freeze({ sceneId, assets: scene.assets.length, reused: false });
    } catch (error) {
      if (preloadToken === token) preloadToken = null;
      await assets.release(token);
      throw error;
    }
  }
  async function fireEventsUntil(timeMs) { await moveForward(timeMs, { dispatch: true }); }
  async function finishScene() {
    const scene = currentScene;
    await emit({ id: "scene-end", type: "scene:end", sceneId: scene.id, chapterId: scene.chapterId, atMs: scene.durationMs, payload: { endingId } });
    const target = await routeAfterScene(scene);
    if (target) { await enterScene(story.byId.get(target), { autoplay: true }); return; }
    state = "ended"; activeClock?.pause(); await music.stop?.({ sceneId: scene.id, fadeOutMs: scene.music.fadeOutMs });
    await drawAt(scene.durationMs, state);
  }
  async function processBoundary(timeMs) {
    const scene = currentScene;
    const choice = choiceAt(scene, timeMs);
    const lineBoundary = dialogueMode === "manual"
      ? scene.textScene.turns.find(turn => Math.abs(turn.endMs - timeMs) < 0.01)?.endMs ?? null
      : null;
    if (choice) {
      await moveForward(scene.textScene.turns.find(turn => turn.id === choice.afterDialogueId).endMs);
      activeClock.pause(); choiceWaitId = choice.id; state = "waitingForChoice";
      await emit({ id: `choice:${choice.id}`, type: "choice:available", sceneId: scene.id, chapterId: scene.chapterId, atMs: currentTime, payload: { choiceId: choice.id, prompt: choice.prompt, options: choice.options.map(({ id, text: label }) => ({ id, text: label })) } });
      await drawAt(currentTime, state); return true;
    }
    if (lineBoundary !== null && lineBoundary <= timeMs + 0.01) {
      await moveForward(lineBoundary); activeClock.pause(); state = "waitingForAdvance"; await drawAt(currentTime, state); return true;
    }
    if (timeMs >= scene.durationMs) { await moveForward(scene.durationMs); await finishScene(); return true; }
    return false;
  }
  async function playInternal() {
    if (!currentScene) throw new Error("Load a scene before play()");
    if (state === "waitingForChoice" || state === "waitingForAdvance") return false;
    if (state === "ended") return replayInternal();
    state = "playing"; activeClock.resume(); await drawAt(activeClock.time(), state); schedule(); return true;
  }
  async function frame() {
    frameHandle = null;
    if (state !== "playing" || !currentScene) return;
    try {
      let timeMs = activeClock.time();
      const barrier = currentScene.choices.filter(choice => !isChoiceSelected(currentScene, choice))
        .map(choice => currentScene.textScene.turns.find(turn => turn.id === choice.afterDialogueId).endMs)
        .concat(dialogueMode === "manual" ? currentScene.textScene.turns.map(turn => turn.endMs).filter(endMs => endMs > currentTime) : [])
        .filter(endMs => endMs > currentTime && endMs <= timeMs).sort((a, b) => a - b)[0];
      if (barrier !== undefined) timeMs = barrier;
      await fireEventsUntil(timeMs);
      if (await processBoundary(timeMs)) return;
      await drawAt(timeMs, state);
      schedule();
    } catch (error) { state = "paused"; activeClock?.pause(); reportError(error); notifyState(); }
  }
  function schedule() {
    cancelScheduledFrame();
    if (state === "playing") frameHandle = requestFrame(() => { void frame(); });
  }
  async function replayInternal() {
    if (!currentScene) throw new Error("No scene is loaded");
    cancelScheduledFrame(); activeClock.pause(); activeClock.seek(0); currentTime = 0; eventCursor = -1; choiceWaitId = null; state = "ready";
    await drawAt(0, state);
    return playInternal();
  }

  async function loadScene(sceneOrId, options = {}) {
    return run(async () => {
      const scene = typeof sceneOrId === "string" ? story.byId.get(sceneOrId) : story.byId.get(sceneOrId?.id);
      if (!scene) throw new TypeError(`Unknown cinematic scene ${typeof sceneOrId === "string" ? sceneOrId : sceneOrId?.id}`);
      return enterScene(scene, { autoplay: options.autoplay === true });
    });
  }
  async function preloadAssets(sceneId) {
    return run(() => {
      const nextId = sceneId ?? currentScene?.flow.nextSceneId ?? currentScene?.flow.conditions[0]?.targetSceneId;
      if (!nextId) return Promise.resolve(null);
      return preloadAssetsInternal(nextId);
    });
  }
  function play() { return run(playInternal); }
  function pause() { return run(async () => { if (state !== "playing") return false; cancelScheduledFrame(); currentTime = activeClock.pause(); await fireEventsUntil(currentTime); state = "paused"; await drawAt(currentTime, state); return true; }); }
  function resume() { return play(); }
  function stop() { return run(async () => { if (!currentScene) return false; cancelScheduledFrame(); activeClock.pause(); activeClock.seek(0); currentTime = 0; eventCursor = -1; choiceWaitId = null; state = "stopped"; await music.stop?.({ sceneId: currentScene.id }); await drawAt(0, state); return true; }); }
  function seek(timeMs) { return run(async () => {
    if (!currentScene || !Number.isFinite(timeMs)) throw new TypeError("seek() needs a loaded scene and finite time");
    cancelScheduledFrame();
    let target = Math.max(0, Math.min(currentScene.durationMs, timeMs));
    const nextChoice = currentScene.choices.find(choice => !isChoiceSelected(currentScene, choice));
    const barrier = nextChoice ? currentScene.textScene.turns.find(turn => turn.id === nextChoice.afterDialogueId).endMs : null;
    if (barrier !== null && target >= barrier) { target = barrier; choiceWaitId = nextChoice.id; state = "waitingForChoice"; }
    else { choiceWaitId = null; state = "paused"; }
    activeClock.pause(); activeClock.seek(target); currentTime = target; eventCursor = target;
    await drawAt(target, state); return snapshot();
  }); }
  function skipDialogue() { return run(async () => {
    if (!currentScene) return false;
    const time = activeTime();
    const turn = currentScene.textScene.turns.find(item => time >= item.startMs && time < item.endMs);
    if (!turn) return false;
    await fireEventsUntil(turn.endMs);
    const choice = currentScene.choices.find(item => item.afterDialogueId === turn.id && !isChoiceSelected(currentScene, item));
    if (choice) { choiceWaitId = choice.id; state = "waitingForChoice"; activeClock.pause(); }
    await drawAt(currentTime, state); return true;
  }); }
  function advanceDialogue() { return run(async () => {
    if (!currentScene) return false;
    if (state === "waitingForChoice") return false;
    const time = activeTime();
    const currentIndexFound = currentScene.textScene.turns.findIndex(turn => time <= turn.endMs);
    const currentIndex = currentIndexFound < 0 ? currentScene.textScene.turns.length - 1 : currentIndexFound;
    const current = currentScene.textScene.turns[currentIndex];
    if (!current) return false;
    if (time < current.endMs) { await fireEventsUntil(current.endMs); }
    const choice = currentScene.choices.find(item => item.afterDialogueId === current.id && !isChoiceSelected(currentScene, item));
    if (choice) { choiceWaitId = choice.id; state = "waitingForChoice"; activeClock.pause(); await drawAt(currentTime, state); return true; }
    const next = currentScene.textScene.turns[currentIndex + 1];
    if (!next) { await moveForward(currentScene.durationMs); await finishScene(); return true; }
    currentTime = next.startMs; activeClock.seek(next.startMs); eventCursor = Math.max(eventCursor, next.startMs); state = "paused"; await drawAt(next.startMs, state); return true;
  }); }
  function selectChoice(choiceId) { return run(async () => {
    if (state !== "waitingForChoice" || !choiceWaitId || !currentScene) throw new Error("No choice is currently awaiting selection");
    const choice = currentScene.choices.find(item => item.id === choiceWaitId);
    const option = choice?.options.find(item => item.id === choiceId);
    if (!option) throw new TypeError(`Unknown option ${choiceId} for choice ${choiceWaitId}`);
    if (option.condition && !(await game.evaluateCondition?.(option.condition, snapshot()))) throw new Error(`Choice option ${option.id} is not eligible`);
    if (isChoiceSelected(currentScene, choice)) throw new Error(`Choice ${choice.id} has already been committed`);
    const event = { id: `choice-selected:${choice.id}`, type: "choice:selected", sceneId: currentScene.id, chapterId: currentScene.chapterId, atMs: currentTime, payload: { choiceId: choice.id, optionId: option.id, targetSceneId: option.targetSceneId, endingId: option.endingId } };
    await emit(event);
    let selections = selectedChoices.get(currentScene.id);
    if (!selections) { selections = new Map(); selectedChoices.set(currentScene.id, selections); }
    selections.set(choice.id, option.id);
    choiceWaitId = null;
    if (option.endingId) { endingId = option.endingId; await finishScene(); return Object.freeze({ endingId }); }
    const target = option.targetSceneId;
    await enterScene(story.byId.get(target), { autoplay: true });
    return Object.freeze({ sceneId: target });
  }); }
  function getState() { return snapshot(); }
  function exportState() {
    if (!currentScene) throw new Error("Cannot export before loading a scene");
    const value = { version: CINEMATIC_RUNTIME_STATE_VERSION, storyId: story.id, sceneId: currentScene.id,
      timeMs: activeTime(), transport: state, dialogueMode: dialogueMode ?? (currentScene.manualDialogue ? "manual" : "auto"),
      choices: Object.fromEntries([...selectedChoices].map(([sceneId, selected]) => [sceneId, Object.fromEntries(selected)])),
      eventLedger: [...eventLedger].sort(), ...(endingId ? { endingId } : {}), ...(choiceWaitId ? { choiceId: choiceWaitId } : {}) };
    return JSON.stringify(value);
  }
  function restoreState(serialized) { return run(async () => {
    const raw = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    const restored = validateCinematicRuntimeState(raw, story);
    selectedChoices.clear(); eventLedger.clear();
    for (const [sceneId, values] of Object.entries(restored.choices)) selectedChoices.set(sceneId, new Map(Object.entries(values)));
    for (const key of restored.eventLedger) eventLedger.add(key);
    endingId = restored.endingId ?? null; dialogueMode = restored.dialogueMode;
    const loaded = await enterScene(story.byId.get(restored.sceneId), { restore: true });
    if (!loaded) return false;
    activeClock.seek(restored.timeMs); currentTime = restored.timeMs; eventCursor = restored.timeMs;
    state = restored.transport;
    choiceWaitId = restored.choiceId ?? null;
    if (state === "playing") activeClock.resume();
    else activeClock.pause();
    await drawAt(restored.timeMs, state);
    if (state === "playing") schedule();
    return true;
  }); }
  async function dispose() {
    if (disposalPromise) return disposalPromise;
    disposalPromise = (async () => {
      cancelScheduledFrame(); activeClock?.pause(); state = "disposed"; notifyState();
      const problems = [];
      for (const cleanup of [() => transitions.destroy(), () => preloadToken && assets.release(preloadToken), () => assets.dispose(), () => music.stop?.({ sceneId: currentScene?.id })]) {
        try { await cleanup(); } catch (error) { problems.push(error); }
      }
      currentScene = null; currentAssets = new Map(); activeToken = null; preloadToken = null;
      if (problems.length) throw new AggregateError(problems, "Cinematic runtime could not release every resource");
    })();
    return disposalPromise;
  }
  function subscribe(callback) {
    if (typeof callback !== "function") throw new TypeError("subscribe requires a function");
    stateCallbacks.add(callback); callback(snapshot());
    return () => stateCallbacks.delete(callback);
  }

  return Object.freeze({ loadScene, preloadAssets, play, pause, resume, stop, seek, replay: () => run(replayInternal),
    skipDialogue, advanceDialogue, selectChoice, getState, exportState, restoreState, dispose, subscribe,
    get story() { return story; }, get assetCount() { return assets.count; }, get decodedAssetBytes() { return assets.decodedBytes; }, get assetLeaseCount() { return assets.leaseCount; } });
}
