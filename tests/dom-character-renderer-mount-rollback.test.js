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
    this.removeCalls = 0;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(item => item !== child);
    child.parentNode = null;
  }
  remove() {
    this.removeCalls += 1;
    this.parentNode?.removeChild(this);
  }
}
class Document {
  constructor() { this.elements = []; }
  createElement(tag) {
    const element = new Element(tag, this);
    this.elements.push(element);
    return element;
  }
}

test("failed DOM insertion rolls back the pending character record and element", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const failure = new Error("root insertion failed");
  root.appendChild = () => { throw failure; };
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });

  await assert.rejects(
    renderer.mount({ id: "hero", sprites: { default: "hero" } }),
    error => error === failure
  );

  const character = document.elements.find(element => element.className === "qarton-character");
  assert.ok(character);
  assert.equal(character.parentNode, null);
  assert.equal(character.removeCalls, 1);
  assert.doesNotThrow(() => renderer.destroy());
  assert.equal(character.removeCalls, 1);
});
