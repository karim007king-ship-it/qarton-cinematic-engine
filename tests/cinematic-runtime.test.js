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

test("concurrent destroy calls share the same completion and failure", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const failure = new Error("pause callback failed");
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => document.createElement("div"),
    onPause: () => { throw failure; }
  });

  const firstDestroy = runtime.destroy();
  const secondDestroy = runtime.destroy();
  assert.equal(firstDestroy, secondDestroy);
  await assert.rejects(firstDestroy, error => error === failure);
  await assert.rejects(secondDestroy, error => error === failure);
  await assert.rejects(runtime.loadAsset("late"), /destroyed/);
});

test("destroy cancels an in-flight scene crossfade before releasing DOM", async () => {
  let releaseWait;
  const document = new Document();
  const root = new Element("main", document);
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: scene => {
      const content = document.createElement("section");
      content.dataset.scene = scene.id;
      return content;
    },
    wait: () => new Promise(resolve => { releaseWait = resolve; })
  });

  assert.equal(await runtime.transitionTo({ id: "current" }), true);
  const pending = runtime.transitionTo({ id: "next" });
  for (let i = 0; i < 12 && !releaseWait; i += 1) await Promise.resolve();
  assert.equal(typeof releaseWait, "function");

  await runtime.destroy();
  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
  releaseWait();
  assert.equal(root.children.length, 0);
});

test("destroy during asynchronous scene rendering prevents a late DOM mount", async () => {
  let finishRender;
  const document = new Document();
  const root = new Element("main", document);
  const runtime = createCinematicRuntime({
    root,
    loadAsset: key => key,
    renderScene: () => new Promise(resolve => {
      finishRender = () => resolve(document.createElement("section"));
    })
  });

  const pending = runtime.transitionTo({ id: "late" });
  for (let i = 0; i < 12 && !finishRender; i += 1) await Promise.resolve();
  assert.equal(typeof finishRender, "function");

  await runtime.destroy();
  finishRender();
  await assert.rejects(pending, /DOM transition adapter has been destroyed/);
  assert.equal(root.children.length, 0);
  assert.equal(runtime.currentScene, null);
});
