import test from "node:test";
import assert from "node:assert/strict";
import { CINEMATIC_RUNTIME_STATE_VERSION, CINEMATIC_SCENE_VERSION, compileCinematicSceneV1, compileCinematicStoryV1, createCinematicStoryRuntime } from "../src/index.js";

function scene(id, { nextSceneId, choice = false, assetId = "bg-day", manualDialogue = false } = {}) {
  return {
    version: CINEMATIC_SCENE_VERSION, id, chapterId: "chapter-1", title: `مشهد ${id}`, language: "tn",
    assets: [{ id: assetId, src: `assets/${assetId}.svg` }, { id: "layla-art", src: "assets/layla.webp" }],
    backgrounds: [{ id: "city", assetId, role: "background", z: 0, depth: 0.2 }],
    characters: [{ id: "layla", name: "ليلى", assetId: "layla-art", x: 0.5, y: 0.9, scale: 0.6, z: 1, facing: "right" }],
    dialogue: [{ id: `${id}-line-1`, speakerId: "layla", text: "نمشيو لقرطاج؟", expression: "thinking", speed: 1 }],
    camera: { mode: "auto", shot: "medium", timeOfDay: "night" },
    direction: { mood: "mystery", seed: 55, strength: 0.45 }, lighting: { intensity: 0.7, tint: "#53627a" },
    effects: { enabled: true, strength: 0.6 }, transition: { type: "crossfade", durationMs: 10 },
    music: { mood: "mystery", intensity: 0.5, fadeInMs: 400, fadeOutMs: 300 },
    choices: choice ? [{ id: "route", afterDialogueId: `${id}-line-1`, prompt: "شنوة نعملو؟", options: [
      { id: "stay", text: "نبقاو", targetSceneId: "ending" }, { id: "leave", text: "نمشيوا", endingId: "leave" }
    ] }] : [],
    flow: nextSceneId ? { nextSceneId, conditions: [] } : { conditions: [] },
    events: [{ id: `${id}-beat`, atMs: 0, type: "story:beat", payload: { id } }], manualDialogue
  };
}

function makeHarness(scenes, options = {}) {
  let now = 0, scheduled = null, serial = 0, conditionValue = options.conditionValue ?? true;
  const rendered = [], released = [], events = [], musicCalls = [], transitions = [];
  const runtime = createCinematicStoryRuntime({
    scenes, now: () => now,
    requestFrame: callback => { scheduled = callback; return ++serial; },
    cancelFrame: () => { scheduled = null; },
    decodeAsset: async (_url, descriptor) => {
      if (options.failAsset === descriptor.id) throw new Error(`decode ${descriptor.id} failed`);
      return { width: 64, height: 64, key: descriptor.id };
    },
    releaseAsset: resource => { released.push(resource.key); },
    render: async frame => { await options.beforeRender?.(frame); rendered.push({ scene: frame.scene.id, timeMs: frame.timeMs, transport: frame.transport, viseme: frame.direction.effects.timeMs, activeSpeakerId: frame.dialogue?.speakerId ?? null, expression: frame.dialogue?.expression ?? null, characterViseme: frame.characterStates?.layla?.viseme ?? null, focusCharacterId: frame.focusCharacterId, motions: frame.dialogue?.motions ?? null, assets: frame.assets.size }); },
    transition: payload => { transitions.push([payload.from?.scene.id ?? null, payload.to.scene.id, payload.durationMs, payload.type]); if (options.failTransitionScene === payload.to.scene.id) { options.failTransitionScene = null; throw new Error(`transition ${payload.to.scene.id} failed`); } return true; },
    game: { emit: event => { events.push(event); }, evaluateCondition: expression => expression === "always-false" ? conditionValue : false },
    music: { setScene: value => musicCalls.push(value.sceneId), stop() {} },
    autoPreload: false
  });
  async function step(time) {
    now = time;
    const callback = scheduled; scheduled = null;
    assert.ok(callback, "a frame should be scheduled while playing");
    callback();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }
  return { runtime, rendered, released, events, musicCalls, transitions, step, setNow(value) { now = value; }, setCondition(value) { conditionValue = value; }, get now() { return now; }, get scheduled() { return scheduled; } };
}

test("CinematicSceneV1 validates stable IDs, references, camera, direction and dialogue", () => {
  const valid = scene("one");
  const compiled = compileCinematicSceneV1(JSON.stringify(valid));
  assert.equal(compiled.id, "one");
  assert.equal(compiled.textScene.turns.length, 1);
  assert.equal(compiled.language, "tn");
  assert.throws(() => compileCinematicSceneV1({ ...valid, version: "CinematicSceneV2" }), /Unsupported scene version/u);
  assert.throws(() => compileCinematicSceneV1({ ...valid, id: "Bad ID" }), /stable lowercase ID/u);
  assert.throws(() => compileCinematicSceneV1({ ...valid, backgrounds: [{ id: "x", assetId: "missing", role: "background", z: 0 }] }), /missing asset/u);
  assert.throws(() => compileCinematicSceneV1({ ...valid, dialogue: [{ id: "bad", speakerId: "nobody", text: "وينو؟" }] }), /unknown speaker/u);
  assert.throws(() => compileCinematicSceneV1({ ...valid, direction: { mood: "unlisted" } }), /direction.mood/u);
});

test("story validation checks cross-scene references and language fallback contract", () => {
  const translated = scene("start", { nextSceneId: "next" });
  translated.language = "fr";
  translated.dialogue[0] = { ...translated.dialogue[0], textId: "line.1", translations: { fr: "Nous allons à Carthage ?" } };
  const result = compileCinematicStoryV1([translated, scene("next")]);
  assert.equal(result.byId.get("start").resolvedDialogue[0].text, "Nous allons à Carthage ?");
  assert.throws(() => compileCinematicStoryV1([scene("start", { nextSceneId: "absent" })]), /missing next scene/u);
});

test("runtime shares one clock for dialogue, effects, and camera and seeks without replaying story events", async () => {
  const only = scene("only");
  only.dialogue[0].motions = { headRotation: 12, eyeX: 0.25, gesture: "raise-hand" };
  only.events[0].atMs = 950;
  const h = makeHarness([only]);
  await h.runtime.loadScene("only");
  await h.runtime.seek(900);
  assert.equal(h.rendered.at(-1).activeSpeakerId, "layla");
  assert.equal(h.rendered.at(-1).expression, "thinking");
  assert.equal(h.rendered.at(-1).focusCharacterId, "layla");
  assert.equal(h.rendered.at(-1).motions.headRotation, 12);
  assert.equal(h.rendered.at(-1).characterViseme, h.runtime.getState().viseme);
  await h.runtime.play();
  await h.step(700);
  assert.equal(h.runtime.getState().transport, "playing");
  assert.equal(h.events.filter(event => event.type === "story:beat").length, 1);
  const first = h.rendered.at(-1);
  await h.runtime.pause();
  const pausedAt = h.runtime.getState().timeMs;
  assert.equal(h.runtime.getState().transport, "paused");
  await h.runtime.seek(900);
  assert.equal(h.runtime.getState().timeMs, 900);
  assert.equal(h.events.filter(event => event.type === "story:beat").length, 1, "seek must not execute old story events");
  await h.runtime.replay();
  assert.equal(h.runtime.getState().timeMs, 0);
  assert.equal(h.events.filter(event => event.type === "story:beat").length, 1, "replay preserves exactly-once event history");
  assert.equal(h.runtime.getState().timeMs, 0);
  assert.ok(pausedAt > 0);
  assert.notEqual(h.runtime.getState().viseme, undefined);
  await h.runtime.dispose();
});

test("pause commits story events crossed since the last rendered frame", async () => {
  const h = makeHarness([scene("pause-events")]);
  await h.runtime.loadScene("pause-events");
  await h.runtime.play();
  h.setNow(640);
  await h.runtime.pause();
  assert.equal(h.runtime.getState().timeMs, 640);
  assert.equal(h.events.filter(event => event.type === "story:beat").length, 1);
  await h.runtime.dispose();
});

test("choice pauses the shared clock, commits once, branches, and exports a JSON-only save", async () => {
  const start = scene("start", { choice: true });
  start.choices[0].options[0].condition = "always-false";
  start.events.push({ id: "after-line", afterDialogueId: "start-line-1", type: "line:done" });
  const h = makeHarness([start, scene("ending")]);
  await h.runtime.loadScene("start");
  const barrier = h.runtime.story.byId.get("start").textScene.turns[0].endMs;
  await h.runtime.play();
  await h.step(barrier + 10);
  assert.equal(h.runtime.getState().transport, "waitingForChoice");
  assert.equal(h.runtime.getState().viseme, "rest");
  const previousEvents = h.events.length;
  const saved = h.runtime.exportState();
  assert.equal(JSON.parse(saved).version, CINEMATIC_RUNTIME_STATE_VERSION);
  h.setCondition(false);
  await assert.rejects(h.runtime.selectChoice("stay"), /not eligible/u);
  h.setCondition(true);
  await h.runtime.selectChoice("stay");
  assert.equal(h.runtime.getState().sceneId, "ending");
  assert.equal(h.runtime.getState().transport, "playing");
  assert.equal(h.events.filter(event => event.type === "choice:selected").length, 1);
  assert.ok(h.events.length > previousEvents);
  await assert.rejects(h.runtime.selectChoice("stay"), /No choice is currently awaiting/u);
  await h.runtime.dispose();
  assert.equal(h.runtime.assetCount, 0);
  assert.equal(h.runtime.assetLeaseCount, 0);
  assert.ok(h.released.includes("layla-art"));
});

test("restore rebuilds scene resources and waiting-choice state without replaying enter/events", async () => {
  const start = scene("start", { choice: true });
  const initial = makeHarness([start, scene("ending")]);
  await initial.runtime.loadScene("start");
  const barrier = initial.runtime.story.byId.get("start").textScene.turns[0].endMs;
  await initial.runtime.seek(barrier);
  const checkpoint = initial.runtime.exportState();
  const restored = makeHarness([start, scene("ending")]);
  await restored.runtime.restoreState(checkpoint);
  assert.equal(restored.runtime.getState().transport, "waitingForChoice");
  assert.equal(restored.runtime.getState().pendingChoiceId, "route");
  assert.equal(restored.events.length, 0);
  assert.equal(restored.musicCalls.length, 1, "music is reconciled once for the restored scene");
  await restored.runtime.selectChoice("leave");
  assert.equal(restored.runtime.getState().endingId, "leave");
  assert.equal(restored.runtime.getState().transport, "ended");
  await initial.runtime.dispose(); await restored.runtime.dispose();
});

test("failed image decoding rolls back candidate scene assets and preserves the current scene", async () => {
  const h = makeHarness([scene("good"), scene("bad", { assetId: "bad-bg" })], { failAsset: "bad-bg" });
  await h.runtime.loadScene("good");
  await assert.rejects(h.runtime.loadScene("bad"), /decode bad-bg failed/u);
  assert.equal(h.runtime.getState().sceneId, "good");
  assert.equal(h.runtime.assetCount, 2);
  assert.equal(h.runtime.decodedAssetBytes, 2 * 64 * 64 * 4);
  assert.equal(h.runtime.assetLeaseCount, 1);
  await h.runtime.dispose();
  assert.equal(h.runtime.assetCount, 0);
  assert.equal(h.runtime.decodedAssetBytes, 0);
  assert.equal(h.runtime.assetLeaseCount, 0);
});

test("failed transactional restore preserves the loaded scene, selection ledger, and committed story events", async () => {
  const h = makeHarness([scene("good"), scene("bad", { assetId: "bad-bg" })], { failAsset: "bad-bg" });
  await h.runtime.loadScene("good");
  const prior = h.runtime.exportState();
  const before = JSON.parse(prior); before.sceneId = "bad";
  await assert.rejects(h.runtime.restoreState(before), /decode bad-bg failed/u);
  assert.equal(h.runtime.getState().sceneId, "good");
  assert.equal(h.runtime.exportState(), prior);
  assert.equal(h.events.filter(event => event.type === "scene:start").length, 1);
  assert.equal(h.runtime.assetLeaseCount, 1);
  await h.runtime.dispose();
});

test("choice transition failure retains the pending choice and a retry reuses its idempotency key", async () => {
  const h = makeHarness([scene("start", { choice: true }), scene("ending")], { failTransitionScene: "ending" });
  await h.runtime.loadScene("start");
  await h.runtime.seek(h.runtime.story.byId.get("start").textScene.turns[0].endMs);
  assert.equal(h.runtime.getState().transport, "waitingForChoice");
  await assert.rejects(h.runtime.selectChoice("stay"), /transition ending failed/u);
  assert.equal(h.runtime.getState().transport, "waitingForChoice");
  assert.equal(h.runtime.getState().pendingChoiceId, "route");
  assert.equal(h.runtime.getState().choices.start, undefined);
  await h.runtime.selectChoice("stay");
  assert.equal(h.runtime.getState().sceneId, "ending");
  assert.equal(h.events.filter(event => event.type === "choice:selected").length, 1);
  await h.runtime.dispose();
});

test("runtime supports explicit manual dialogue advancement and stop resets only visual state", async () => {
  const manual = scene("manual", { manualDialogue: true });
  const h = makeHarness([manual]);
  await h.runtime.loadScene("manual");
  await h.runtime.play();
  const end = h.runtime.story.byId.get("manual").textScene.turns[0].endMs;
  await h.step(end + 1);
  assert.equal(h.runtime.getState().transport, "waitingForAdvance");
  await h.runtime.advanceDialogue();
  assert.equal(h.runtime.getState().transport, "ended");
  await h.runtime.stop();
  assert.equal(h.runtime.getState().timeMs, 0);
  await h.runtime.dispose();
});

test("manual dialogue advance dispatches story events in the pause between lines", async () => {
  const value = scene("manual-events", { manualDialogue: true });
  value.dialogue.push({ id: "manual-events-line-2", speakerId: "layla", text: "نمشيوا توة." });
  value.events.push({ id: "between-lines", atMs: 0, type: "story:between-lines", payload: { ok: true } });
  const compiled = compileCinematicSceneV1(value);
  value.events[1].atMs = compiled.textScene.turns[0].endMs + 120;
  const h = makeHarness([value]);
  await h.runtime.loadScene("manual-events"); await h.runtime.play();
  await h.step(h.runtime.story.byId.get("manual-events").textScene.turns[0].endMs + 1);
  assert.equal(h.runtime.getState().transport, "waitingForAdvance");
  await h.runtime.advanceDialogue();
  assert.equal(h.events.filter(event => event.id === "between-lines").length, 1);
  assert.equal(h.runtime.getState().dialogueIndex, 1);
  await h.runtime.dispose();
});

test("an in-flight asynchronous frame cannot render over a newly selected scene", async () => {
  let startedResolve, releaseResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const blocked = new Promise(resolve => { releaseResolve = resolve; });
  const h = makeHarness([scene("one"), scene("two")], { beforeRender: async frame => {
    if (frame.scene.id === "one" && frame.transport === "playing" && frame.timeMs > 0) { startedResolve(); await blocked; }
  } });
  await h.runtime.loadScene("one"); await h.runtime.play();
  const callback = h.scheduled; h.setNow(750); callback();
  await started;
  const switching = h.runtime.loadScene("two");
  releaseResolve(); await switching;
  assert.equal(h.runtime.getState().sceneId, "two");
  assert.equal(h.rendered.at(-1).scene, "two");
  assert.equal(h.rendered.some((frame, index) => frame.scene === "one" && index > h.rendered.findLastIndex(item => item.scene === "two")), false);
  await h.runtime.dispose();
});
