import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterStage } from "../src/character/character-stage.js";
import { createCharacterController } from "../src/character/character-controller.js";

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
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
  remove() { this.parentNode?.removeChild(this); }
}
class Document { createElement(tag) { return new Element(tag, this); } }

test("stage retains and retries cleanup for a stale mount whose first unmount fails", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const originalRemoveChild = root.removeChild.bind(root);
  const cleanupFailure = new Error("temporary stale character cleanup failure");
  let resolveSprite;

  root.appendChild = child => {
    child.remove = () => { throw cleanupFailure; };
    child.parentNode = root;
    root.children.push(child);
    return child;
  };
  root.removeChild = () => { throw cleanupFailure; };

  const stage = createCharacterStage({
    root,
    resolveSprite: () => new Promise(resolve => { resolveSprite = resolve; }),
    characters: [{
      controller: createCharacterController({ id: "hero" }),
      sprites: { default: "hero" }
    }]
  });

  const pendingMount = stage.mount();
  await Promise.resolve();
  stage.unmount();
  resolveSprite("https://assets.test/hero.png");

  await assert.rejects(pendingMount, error => error === cleanupFailure);
  assert.equal(root.children.length, 1);

  root.removeChild = originalRemoveChild;
  assert.throws(() => stage.unmount(), error => error === cleanupFailure);
  assert.equal(root.children.length, 0);
  stage.destroy();
});
