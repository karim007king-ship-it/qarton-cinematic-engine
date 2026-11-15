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
