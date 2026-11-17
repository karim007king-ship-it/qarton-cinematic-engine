import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicRuntime } from "../src/runtime/cinematic-runtime.js";

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


test("runtime exposes asset cancellation and cache release to its host", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let signal;
  let calls = 0;
  const runtime = createCinematicRuntime({
    root,
    loadAsset: (key, _metadata, context) => {
      calls += 1;
      if (calls === 1) {
        signal = context.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return `/${key}.png`;
    },
    renderScene: () => document.createElement("div")
  });

  const pending = runtime.loadAsset("portrait");
  await Promise.resolve();
  assert.equal(runtime.cancelAsset("portrait"), true);
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, { name: "AbortError" });

  assert.equal(await runtime.loadAsset("portrait"), "/portrait.png");
  assert.equal(runtime.releaseAsset("portrait"), true);
  assert.equal(runtime.releaseAsset("portrait"), false);
  assert.equal(await runtime.loadAsset("portrait"), "/portrait.png");
  assert.equal(calls, 3);

  runtime.clearAssets();
  assert.equal(await runtime.loadAsset("portrait"), "/portrait.png");
  await runtime.destroy();
  assert.throws(() => runtime.cancelAsset("portrait"), /destroyed/);
  assert.throws(() => runtime.releaseAsset("portrait"), /destroyed/);
  assert.throws(() => runtime.clearAssets(), /destroyed/);
});
