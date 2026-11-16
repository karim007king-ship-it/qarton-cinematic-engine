import test from "node:test";
import assert from "node:assert/strict";
import { createDOMVisualTreatmentAdapter } from "../src/effects/dom-visual-treatment.js";

class FakeElement {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.style = {};
    this.attributes = {};
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
  setAttribute(name, value) { this.attributes[name] = value; }
}
class FakeDocument {
  constructor() { this.head = new FakeElement(this); }
  createElement() { return new FakeElement(this); }
}
function setup() {
  const document = new FakeDocument();
  const root = new FakeElement(document);
  return { root, adapter: createDOMVisualTreatmentAdapter({ root }) };
}

test("creates accessible, pointer-transparent overlay layers", () => {
  const { root, adapter } = setup();
  assert.equal(root.children.length, 3);
  for (const element of root.children) {
    assert.equal(element.attributes["aria-hidden"], "true");
    assert.equal(element.style.pointerEvents, "none");
    assert.equal(element.style.position, "absolute");
  }
  adapter.destroy();
});

test("applies vignette, bloom and grain opacity without changing scene content", () => {
  const { root, adapter } = setup();
  assert.equal(adapter.apply({
    vignetteOpacity: 0.7, bloomOpacity: 0.35, grainOpacity: 0.2, grainAnimated: true
  }), true);
  const [vignette, bloom, grain] = root.children;
  assert.equal(vignette.style.opacity, "0.7");
  assert.match(vignette.style.background, /radial-gradient/);
  assert.equal(bloom.style.opacity, "0.35");
  assert.equal(bloom.style.mixBlendMode, "screen");
  assert.equal(grain.style.opacity, "0.2");
  assert.match(grain.style.animation, /qarton-film-grain/);
  adapter.clear();
  assert.equal(grain.style.opacity, "0");
  assert.equal(grain.style.animation, "none");
});

test("disables grain animation when reduced-motion treatment requests a static layer", () => {
  const { root, adapter } = setup();
  adapter.apply({ grainOpacity: 0.4, grainAnimated: false });
  assert.equal(root.children[2].style.animation, "none");
});

test("rejects invalid opacity and use after destroy", () => {
  const { adapter } = setup();
  assert.throws(() => adapter.apply({ bloomOpacity: 1.2 }), /between 0 and 1/);
  adapter.destroy();
  assert.throws(() => adapter.apply({}), /destroyed/);
});


test("destroy removes every overlay when host remove methods throw", () => {
  const { root, adapter } = setup();
  const styleElement = root.ownerDocument.head.children[0];
  root.children[0].remove = () => { throw new Error("overlay remove failed"); };
  root.children[1].remove = () => { throw new Error("overlay remove failed"); };
  styleElement.remove = () => { throw new Error("style remove failed"); };

  assert.doesNotThrow(() => adapter.destroy());
  assert.equal(root.children.length, 0);
  assert.equal(root.ownerDocument.head.children.length, 0);
  assert.doesNotThrow(() => adapter.destroy());
});
