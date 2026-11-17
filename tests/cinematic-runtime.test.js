import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicRuntime } from "../src/runtime/cinematic-runtime.js";
import { createCinematicDirector } from "../src/runtime/cinematic-director.js";
import { createAudioCueController } from "../src/audio/audio-cue-controller.js";

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {} };
    this.parentNode = null;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
}
class Document {
  createElement(tag) { return new Element(tag, this); }
}

test("cinematic runtime composes scene transitions, asset loading and adaptive profile", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const rendered = [];
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => `https://assets.test/${key}.png`,
    renderScene: async (scene, profile, { assets }) => {
      rendered.push({ scene: scene.id, tier: profile.tier });
      const url = await assets.load(scene.asset);
      const content = document.createElement("section");
      content.dataset.assetUrl = url;
      return content;
    },
    device: { quality: "medium" },
    animate: () => ({ finished: Promise.resolve(), cancel() {} })
  });
  assert.equal(await runtime.transitionTo({ id: "one", asset: "bg-one" }), true);
  const first = runtime.currentScene;
  assert.ok(first);
  assert.equal(root.children.length, 1);
  assert.equal(await runtime.transitionTo({ id: "two", asset: "bg-two" }), true);
  assert.notEqual(runtime.currentScene, first);
  assert.equal(root.children.length, 1);
  assert.equal(rendered.length, 2);
  assert.equal(await runtime.loadAsset("bg-two"), "https://assets.test/bg-two.png");
  await runtime.destroy();
  assert.equal(root.children.length, 0);
  await assert.rejects(runtime.loadAsset("late"), /destroyed/);
});

test("cinematic runtime validates required host adapters and lifecycle", async () => {
  assert.throws(() => createCinematicRuntime({}), /loadAsset/);
  const document = new Document();
  const root = new Element("main", document);
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div")
  });
  runtime.setActive(false);
  runtime.setActive(true);
  await runtime.destroy();
  await runtime.destroy();
  await assert.rejects(runtime.transitionTo({ id: "late" }), /destroyed/);
});


test("concurrent destroy calls share the same teardown promise", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div")
  });

  await runtime.transitionTo({ id: "active" });
  const firstDestroy = runtime.destroy();
  const secondDestroy = runtime.destroy();
  assert.equal(secondDestroy, firstDestroy);
  await Promise.all([firstDestroy, secondDestroy]);
  assert.equal(root.children.length, 0);
});


test("cinematic runtime destroy retries when scene DOM cleanup fails", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div")
  });
  await runtime.transitionTo({ id: "retry-runtime-destroy" });

  const originalRemoveChild = root.removeChild.bind(root);
  root.removeChild = () => { throw new Error("persistent DOM cleanup failure"); };
  await assert.rejects(runtime.destroy(), error => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.some(item => /persistent DOM cleanup failure/.test(item.message)));
    return true;
  });
  assert.equal(root.children.length, 1);

  root.removeChild = originalRemoveChild;
  await runtime.destroy();
  assert.equal(root.children.length, 0);
  await assert.rejects(runtime.transitionTo({ id: "after-destroy" }), /destroyed/);
});


test("runtime destroy cancels an active visual transition before awaiting scene teardown", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let signalFrame;
  const frameStarted = new Promise(resolve => { signalFrame = resolve; });
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    nextFrame: () => { signalFrame(); return Promise.resolve(); },
    wait: () => new Promise(() => {})
  });

  await runtime.transitionTo({ id: "current" });
  const pendingTransition = runtime.transitionTo({ id: "incoming" });
  await frameStarted;
  const destroying = runtime.destroy();
  assert.equal(await pendingTransition, false);
  await destroying;
  assert.equal(root.children.length, 0);
});


test("runtime pauses the host before releasing scene and asset resources", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let childrenAtPause = null;
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    onPause: () => { childrenAtPause = root.children.length; }
  });

  await runtime.transitionTo({ id: "visible" });
  assert.equal(root.children.length, 1);
  await runtime.destroy();
  assert.equal(childrenAtPause, 1);
  assert.equal(root.children.length, 0);
});

class LifecycleTarget {
  constructor(visibilityState = "visible") {
    this.visibilityState = visibilityState;
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((count, set) => count + set.size, 0);
  }
}

test("runtime automatically bridges an injected page lifecycle target to its activity gate", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("visible");
  const events = [];
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target,
    onPause: () => events.push("pause"),
    onResume: () => events.push("resume")
  });

  assert.deepEqual(events, []);
  assert.equal(runtime.pageLifecycleState.started, true);
  assert.equal(runtime.pageLifecycleState.active, true);
  assert.equal(target.listenerCount(), 3);

  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  target.dispatch("pagehide");
  assert.deepEqual(events, ["pause"]);

  target.visibilityState = "visible";
  target.dispatch("pageshow");
  assert.deepEqual(events, ["pause", "resume"]);

  await runtime.destroy();
  assert.equal(target.listenerCount(), 0);
  assert.deepEqual(events, ["pause", "resume", "pause"]);
});

test("runtime lifecycle integration respects initially hidden pages and can be restarted", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("hidden");
  const events = [];
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target,
    onPause: () => events.push("pause"),
    onResume: () => events.push("resume")
  });

  assert.deepEqual(events, ["pause"]);
  assert.equal(runtime.pageLifecycleState.active, false);
  assert.equal(runtime.stopPageLifecycle(), true);
  assert.equal(target.listenerCount(), 0);
  assert.equal(runtime.startPageLifecycle(), true);
  assert.equal(target.listenerCount(), 3);
  target.visibilityState = "visible";
  assert.equal(runtime.syncPageLifecycle(), true);
  assert.deepEqual(events, ["pause", "resume"]);

  await runtime.destroy();
  assert.equal(target.listenerCount(), 0);
  assert.deepEqual(events, ["pause", "resume", "pause"]);
});

test("runtime without a lifecycle target keeps manual lifecycle control and no page listeners", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const events = [];
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    onPause: () => events.push("pause")
  });

  assert.equal(runtime.pageLifecycleState, null);
  assert.equal(runtime.startPageLifecycle(), false);
  assert.equal(runtime.stopPageLifecycle(), false);
  assert.equal(runtime.syncPageLifecycle(), false);
  runtime.setActive(false);
  await runtime.destroy();
  assert.deepEqual(events, ["pause"]);
});

test("runtime ignores background frame samples and starts a fresh adaptive window on resume", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("visible");
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target
  });

  assert.equal(runtime.isActive(), true);
  runtime.recordFrame(16);
  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  assert.equal(runtime.isActive(), false);
  const skipped = runtime.recordFrame(1000);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.evaluated, false);
  assert.equal(skipped.averageFps, null);

  target.visibilityState = "visible";
  target.dispatch("visibilitychange");
  assert.equal(runtime.isActive(), true);
  const firstForegroundFrame = runtime.recordFrame(16);
  assert.equal(firstForegroundFrame.skipped, undefined);
  assert.equal(firstForegroundFrame.evaluated, false);

  await runtime.destroy();
});


test("runtime pauses and resumes the injected audio controller with page visibility", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("visible");
  const calls = [];
  const audioController = {
    pause() { calls.push("pause"); },
    resume() { calls.push("resume"); }
  };
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target,
    audioController
  });

  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  target.dispatch("pagehide");
  assert.deepEqual(calls, ["pause"]);
  assert.equal(runtime.isActive(), false);

  target.visibilityState = "visible";
  target.dispatch("pageshow");
  assert.deepEqual(calls, ["pause", "resume"]);
  assert.equal(runtime.isActive(), true);

  await runtime.destroy();
  assert.deepEqual(calls, ["pause", "resume", "pause"]);
});

test("audio lifecycle failures are reported without blocking runtime pause or resume", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("visible");
  const calls = [];
  const errors = [];
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target,
    audioController: {
      pause() { calls.push("pause"); throw new Error("pause failed"); },
      resume() { calls.push("resume"); throw new Error("resume failed"); }
    },
    onAudioError: (error, context) => errors.push([error.message, context.phase])
  });

  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  assert.equal(runtime.isActive(), false);
  target.visibilityState = "visible";
  target.dispatch("visibilitychange");
  assert.equal(runtime.isActive(), true);
  assert.deepEqual(calls, ["pause", "resume"]);
  assert.deepEqual(errors, [["pause failed", "pause"], ["resume failed", "resume"]]);

  await runtime.destroy();
  assert.equal(runtime.isActive(), false);
});

test("runtime validates the optional audio controller contract", () => {
  assert.throws(() => createCinematicRuntime({
    loadAsset: () => null,
    renderScene: () => null,
    audioController: { pause() {} }
  }), /pause\(\) and resume\(\)/);
});


test("runtime lifecycle pauses the shared director clock and audio cues together", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const target = new LifecycleTarget("visible");
  const played = [];
  const audio = createAudioCueController({
    cues: [
      { id: "before", atMs: 0, asset: "before" },
      { id: "hidden", atMs: 100, asset: "hidden" },
      { id: "after", atMs: 200, asset: "after" }
    ],
    play: asset => { played.push(asset); return asset; }
  });
  const director = createCinematicDirector({ audio });
  await director.mount();
  await director.update(50);

  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    lifecycleTarget: target,
    audioController: director
  });
  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  assert.equal(director.getState().paused, true);
  await director.update(150);
  assert.deepEqual(played, ["before"]);

  target.visibilityState = "visible";
  target.dispatch("visibilitychange");
  assert.equal(director.getState().paused, false);
  await director.update(250);
  assert.deepEqual(played, ["before", "hidden", "after"]);
  await director.update(300);
  assert.deepEqual(played, ["before", "hidden", "after"], "resuming must not replay any cue");

  await runtime.destroy();
  await director.destroy();
});
