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


test("DOM renderer applies layered pose transforms and facial animation frames", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { neutral: "hero-neutral" },
    layerSprites: { "left-arm": "arm", torso: "torso" },
    mouthSprites: ["mouth-closed", "mouth-open"],
    eyeSprites: ["eyes-open", "eyes-blink"],
    initialState: { expression: "neutral" }
  });

  const arm = handle.children.find(child => child.dataset.layerId === "left-arm");
  const mouth = handle.children.filter(child => child.className === "qarton-character-mouth");
  const eyes = handle.children.filter(child => child.className === "qarton-character-eyes");
  assert.ok(arm);
  await renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "neutral", state: "speaking", pose: "talk",
    speaking: true, mouthFrame: 1, eyeFrame: 1,
    breathOffsetY: 1.25, headRotation: 0.5,
    layerTransforms: {
      "left-arm": { translateX: 4, translateY: 2, rotation: 30, scaleX: 1, scaleY: 0.9 }
    }
  });

  assert.match(arm.style.transform, /translate3d\(4px, 2px, 0\).*rotate\(30deg\)/);
  assert.equal(handle.dataset.pose, "talk");
  assert.equal(handle.dataset.speaking, "true");
  assert.equal(handle.children[0].style.transform, "translate3d(0px, 1.25px, 0) rotate(0.5deg)");
  assert.equal(mouth[0].style.display, "none");
  assert.equal(mouth[1].style.display, "block");
  assert.equal(eyes[0].style.display, "none");
  assert.equal(eyes[1].style.display, "block");

  renderer.unmount(handle);
  assert.equal(root.children.length, 0);
});

test("DOM renderer rejects negative rig scale and cleans up failed rig mounts", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => key === "missing" ? null : `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "hero", sprites: { default: "base" }, layerSprites: { arm: "arm" }
  });
  await assert.rejects(renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    layerTransforms: { arm: { scaleX: -1 } }
  }), /scale cannot be negative/);
  renderer.unmount(handle);
  await assert.rejects(renderer.mount({
    id: "broken", sprites: { default: "base" }, layerSprites: { arm: "missing" }
  }), /invalid URL/);
  assert.equal(root.children.length, 0);
});


test("destroy during rig asset loading prevents later asset requests and DOM attachment", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveLayer;
  const requested = [];
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      requested.push(key);
      if (key === "arm") return new Promise(resolve => { resolveLayer = resolve; });
      return `https://assets.test/${key}.png`;
    }
  });
  const mounting = renderer.mount({
    id: "hero",
    sprites: { default: "base" },
    layerSprites: { arm: "arm", torso: "torso" },
    mouthSprites: ["mouth"]
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(requested, ["base", "arm"]);
  renderer.destroy();
  resolveLayer("https://assets.test/arm.png");
  await assert.rejects(mounting, /destroyed/);
  assert.deepEqual(requested, ["base", "arm"]);
  assert.equal(root.children.length, 0);
});
