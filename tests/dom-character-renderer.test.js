import test from "node:test";
import assert from "node:assert/strict";
import { createDOMCharacterRenderer } from "../src/character/dom-character-renderer.js";

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
}
class Document {
  createElement(tag) { return new Element(tag, this); }
}

test("DOM character renderer mounts, updates pose, and switches expression sprites", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: key => `https://assets.test/${key}.png` });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { neutral: "hero-neutral", focused: "hero-focused", default: "hero-neutral" },
    initialState: { x: 10, y: 20, expression: "neutral" }
  });
  assert.equal(root.children.length, 1);
  assert.equal(handle.children[0].src, "https://assets.test/hero-neutral.png");
  await renderer.update(handle, {
    id: "hero", x: 40, y: 50, opacity: 0.5, scale: 1.2, rotation: 15,
    expression: "focused", state: "walking"
  });
  assert.match(handle.style.transform, /translate3d\(40px, 50px, 0\)/);
  assert.equal(handle.style.opacity, "0.5");
  assert.equal(handle.children[0].src, "https://assets.test/hero-focused.png");
  renderer.unmount(handle);
  assert.equal(root.children.length, 0);
});

test("stale asynchronous sprite loads cannot overwrite a newer expression", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const pending = new Map();
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => new Promise(resolve => pending.set(key, resolve))
  });
  const mounting = renderer.mount({
    id: "hero",
    sprites: { neutral: "neutral", focused: "focused", angry: "angry" },
    initialState: { expression: "neutral" }
  });
  pending.get("neutral")("https://assets.test/neutral.png");
  const handle = await mounting;
  const first = renderer.update(handle, { id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused" });
  const second = renderer.update(handle, { id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "angry" });
  pending.get("angry")("https://assets.test/angry.png");
  await second;
  pending.get("focused")("https://assets.test/focused.png");
  await first;
  assert.equal(handle.children[0].src, "https://assets.test/angry.png");
});

test("DOM character renderer validates states and cleans up on destroy", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "https://assets.test/hero.png" });
  const handle = await renderer.mount({ id: "hero", sprites: { default: "hero" } });
  await assert.rejects(renderer.update(handle, { id: "other", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 }), /does not match/);
  renderer.destroy();
  assert.equal(root.children.length, 0);
  assert.throws(() => createDOMCharacterRenderer({ root }), /resolveSprite/);
});

test("switching back to the cached sprite invalidates a pending expression load", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const pending = new Map();
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => new Promise(resolve => pending.set(key, resolve))
  });
  const mounting = renderer.mount({
    id: "hero",
    sprites: { neutral: "neutral", focused: "focused" },
    initialState: { expression: "neutral" }
  });
  pending.get("neutral")("https://assets.test/neutral.png");
  const handle = await mounting;
  const focused = renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused"
  });
  await renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "neutral"
  });
  pending.get("focused")("https://assets.test/focused.png");
  await focused;
  assert.equal(handle.children[0].src, "https://assets.test/neutral.png");
});


test("duplicate in-flight requests for the same sprite share one asset resolution", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveFocused;
  let focusedCalls = 0;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      if (key === "focused") {
        focusedCalls += 1;
        return new Promise(resolve => { resolveFocused = resolve; });
      }
      return `https://assets.test/${key}.png`;
    }
  });
  const handle = await renderer.mount({
    id: "hero", sprites: { neutral: "neutral", focused: "focused" },
    initialState: { expression: "neutral" }
  });
  const state = { id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused" };
  const first = renderer.update(handle, state);
  const second = renderer.update(handle, state);
  await Promise.resolve();
  assert.equal(focusedCalls, 1);
  resolveFocused("https://assets.test/focused.png");
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(handle.children[0].src, "https://assets.test/focused.png");
});

test("failed stale sprite loads do not reject after a newer expression commits", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let rejectFocused;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      if (key === "focused") return new Promise((resolve, reject) => { rejectFocused = reject; });
      return `https://assets.test/${key}.png`;
    }
  });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { neutral: "neutral", focused: "focused", angry: "angry" },
    initialState: { expression: "neutral" }
  });

  const staleUpdate = renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused"
  });
  await renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "angry"
  });

  rejectFocused(new Error("obsolete sprite request failed"));
  assert.equal(await staleUpdate, false);
  assert.equal(handle.children[0].src, "https://assets.test/angry.png");
});


test("renderer unmount falls back to root removal when element removal throws", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "https://assets.test/hero.png" });
  const handle = await renderer.mount({ id: "hero", sprites: { default: "hero" } });
  const failure = new Error("element remove failed");
  handle.remove = () => { throw failure; };

  assert.throws(() => renderer.unmount(handle), error => error === failure);
  assert.equal(root.children.length, 0);
  assert.doesNotThrow(() => renderer.destroy());
});

test("renderer destroy attempts every element cleanup after one removal fails", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "https://assets.test/hero.png" });
  const first = await renderer.mount({ id: "first", sprites: { default: "first" } });
  await renderer.mount({ id: "second", sprites: { default: "second" } });
  const failure = new Error("first element remove failed");
  first.remove = () => { throw failure; };

  assert.throws(() => renderer.destroy(), error => error === failure);
  assert.equal(root.children.length, 0);
  assert.doesNotThrow(() => renderer.destroy());
});


test("renderer destroy retains failed elements and retries cleanup", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "https://assets.test/hero.png" });
  const handle = await renderer.mount({ id: "hero", sprites: { default: "hero" } });
  const originalRemoveChild = root.removeChild.bind(root);
  const failure = new Error("temporary root removal failure");
  root.removeChild = () => { throw failure; };

  assert.throws(() => renderer.destroy(), error => error === failure);
  assert.equal(root.children.length, 1);
  root.removeChild = originalRemoveChild;
  assert.doesNotThrow(() => renderer.destroy());
  assert.equal(root.children.length, 0);
  await assert.rejects(renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0
  }), /destroyed/);
});


test("DOM character renderer applies optional idle pose and eye blink transforms", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: () => "https://assets.test/hero.png"
  });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { default: "hero" },
    initialState: {
      x: 10, y: 20, opacity: 1, scale: 1, rotation: 0,
      idle: { offsetY: -2, scaleX: 1.01, scaleY: 0.99, blinkScaleY: 0.08 }
    }
  });
  assert.match(handle.style.transform, /translate3d\(10px, 18px, 0\)/);
  assert.match(handle.style.transform, /scale\(1\.0302, 0\.9702\)/);
  assert.equal(handle.children[0].style.transform, "scaleY(0.08)");
  await renderer.update(handle, {
    id: "hero", x: 10, y: 20, opacity: 1, scale: 1, rotation: 0,
    expression: "neutral", idle: { offsetY: 0, scaleX: 1, scaleY: 1, blinkScaleY: 1 }
  });
  assert.equal(handle.children[0].style.transform, "scaleY(1)");
  await assert.rejects(renderer.update(handle, {
    id: "hero", x: 10, y: 20, opacity: 1, scale: 1, rotation: 0,
    idle: { blinkScaleY: 1.2 }
  }), /idle scales/);
  renderer.destroy();
});


test("DOM character renderer composes walk pose with the optional idle pose", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "https://assets.test/hero.png" });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { default: "hero" },
    initialState: {
      x: 5, y: 10, opacity: 1, scale: 1, rotation: 0,
      idle: { offsetY: -1, scaleX: 1.01, scaleY: 0.99 },
      walk: { offsetY: -2, scaleX: 1.02, scaleY: 0.98 }
    }
  });
  assert.match(handle.style.transform, /translate3d\(5px, 7px, 0\)/);
  assert.match(handle.style.transform, /scale\(1\.01, 0\.99\)/);
  await renderer.update(handle, {
    id: "hero", x: 5, y: 10, opacity: 1, scale: 1, rotation: 0,
    walk: { active: false, offsetY: 0, scaleX: 1, scaleY: 1 }
  });
  assert.match(handle.style.transform, /translate3d\(5px, 10px, 0\)/);
  renderer.destroy();
});
