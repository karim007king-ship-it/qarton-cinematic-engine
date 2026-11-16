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
  decode() {
    if (this.decodeFailure) return Promise.reject(new Error("image decode failed"));
    return Promise.resolve();
  }
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
  const releases = [];
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: () => new Promise(resolve => { releases.push(resolve); })
  });
  const pending = renderer.render(scene, profile);
  renderer.clear();
  releases.forEach((resolve, index) => resolve(`/late-${index}.png`));
  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
  assert.equal(root.dataset.qartonSceneId, undefined);
});

test("renderer validates injected dependencies", () => {
  assert.throws(() => new BackgroundRenderer({ root: {}, resolveAsset: () => "/x" }), /DOM root/);
  const { root } = fixture();
  assert.throws(() => new BackgroundRenderer({ root, resolveAsset: null }), /asset resolver/);
});


test("renderer waits for every image decode before replacing the current scene", async () => {
  const { root, scene, profile } = fixture();
  const renderer = new BackgroundRenderer({ root, resolveAsset: key => `/${key}.png` });
  await renderer.render(scene, profile);
  const previous = root.children;
  const releases = [];
  const pendingRenderer = new BackgroundRenderer({
    root,
    resolveAsset: key => `/next-${key}.png`
  });
  const originalCreate = root.ownerDocument.createElement.bind(root.ownerDocument);
  root.ownerDocument.createElement = tag => {
    const element = originalCreate(tag);
    if (tag === "img") element.decode = () => new Promise(resolve => { releases.push(resolve); });
    return element;
  };
  const pending = pendingRenderer.render(scene, profile);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.children, previous);
  assert.equal(releases.length, 3);
  releases.forEach(resolve => resolve());
  assert.equal(await pending, true);
  assert.notEqual(root.children, previous);
});

test("image decode failure preserves the previously visible scene", async () => {
  const { root, scene, profile } = fixture();
  const renderer = new BackgroundRenderer({ root, resolveAsset: key => `/${key}.png` });
  await renderer.render(scene, profile);
  const previous = root.children;
  const broken = new BackgroundRenderer({
    root,
    resolveAsset: key => `/broken-${key}.png`
  });
  const originalCreate = root.ownerDocument.createElement.bind(root.ownerDocument);
  root.ownerDocument.createElement = tag => {
    const element = originalCreate(tag);
    if (tag === "img") element.decode = () => Promise.reject(new Error("decode failed"));
    return element;
  };
  await assert.rejects(broken.render(scene, profile), /decode failed/);
  assert.equal(root.children, previous);
});

test("a superseded render ignores a late asset-resolution failure", async () => {
  const { root, scene, profile } = fixture();
  const pendingResolvers = [];
  let failOldRender = false;
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: (key) => {
      if (key === "images/sky" && !failOldRender) {
        return new Promise((resolve, reject) => pendingResolvers.push({ resolve, reject }));
      }
      return Promise.resolve(`/latest/${key}.png`);
    }
  });

  const oldRender = renderer.render(scene, profile);
  await Promise.resolve();
  await Promise.resolve();

  const latestScene = createSceneDefinition({
    id: "latest",
    layers: [{ id: "latest-bg", role: "background", asset: "images/latest" }]
  });
  assert.equal(await renderer.render(latestScene, profile), true);

  failOldRender = true;
  pendingResolvers.forEach(({ reject }) => reject(new Error("stale asset failed")));
  assert.equal(await oldRender, false);
  assert.equal(root.dataset.qartonSceneId, "latest");
  assert.deepEqual(root.children.map(node => node.dataset.layerId), ["latest-bg"]);
});

test("renderer rejects unsafe asset URLs without replacing the visible scene", async () => {
  const invalidUrls = [
    "javascript:alert(1)",
    "VbScRiPt:alert(1)",
    "file:///etc/passwd",
    "//remote.example/background.png",
    "https://assets.test/background\n.png"
  ];
  const { root, scene, profile } = fixture();
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: key => `/safe/${key}.png`
  });
  await renderer.render(scene, profile);
  const previous = root.children;

  for (const url of invalidUrls) {
    const unsafeRenderer = new BackgroundRenderer({ root, resolveAsset: () => url });
    await assert.rejects(unsafeRenderer.render(scene, profile), /unsafe URL/);
    assert.equal(root.children, previous);
  }
});
