import test from "node:test";
import assert from "node:assert/strict";
import { BackgroundRenderer, createSceneDefinition, resolveQualityProfile } from "../src/index.js";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.style = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) {
    this.children = children.flatMap(child => child.isFragment ? child.children : [child]);
  }
}
class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
  createDocumentFragment() {
    const fragment = new FakeElement("#fragment", this);
    fragment.isFragment = true;
    return fragment;
  }
}
function fixture() {
  const document = new FakeDocument();
  const root = new FakeElement("main", document);
  const scene = createSceneDefinition({ id: "intro", layers: [
    { id: "sky", role: "background", asset: "images/sky" },
    { id: "hero", role: "character", asset: "images/hero" },
    { id: "title", role: "overlay", asset: "images/title", opacity: 0.8 }
  ] });
  return { root, scene, profile: resolveQualityProfile({ quality: "high" }) };
}

test("renderer mounts ordered layers and resolves assets through the host", async () => {
  const { root, scene, profile } = fixture();
  const renderer = new BackgroundRenderer({ root, resolveAsset: key => `/assets/${key}.webp` });
  assert.equal(await renderer.render(scene, profile), true);
  assert.equal(root.dataset.qartonSceneId, "intro");
  assert.deepEqual(root.children.map(node => node.dataset.layerId), ["sky", "hero", "title"]);
  assert.equal(root.children[0].children[0].src, "/assets/images/sky.webp");
  assert.equal(root.children[0].children[0].loading, "eager");
  assert.equal(root.children[2].style.opacity, "0.8");
});

test("failed asset resolution keeps the previously rendered scene", async () => {
  const { root, scene, profile } = fixture();
  let fail = false;
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: key => {
      if (fail && key === "images/hero") throw new Error("asset missing");
      return `/${key}.png`;
    }
  });
  await renderer.render(scene, profile);
  const previous = root.children;
  fail = true;
  await assert.rejects(renderer.render(scene, profile), /asset missing/);
  assert.equal(root.children, previous);
});

test("clear removes rendered nodes and invalidates in-flight renders", async () => {
  const { root, scene, profile } = fixture();
  let release;
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: () => new Promise(resolve => { release = resolve; })
  });
  const pending = renderer.render(scene, profile);
  renderer.clear();
  release("/late.png");
  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
  assert.equal(root.dataset.qartonSceneId, undefined);
});

test("renderer validates injected dependencies", () => {
  assert.throws(() => new BackgroundRenderer({ root: {}, resolveAsset: () => "/x" }), /DOM root/);
  const { root } = fixture();
  assert.throws(() => new BackgroundRenderer({ root, resolveAsset: null }), /asset resolver/);
});
