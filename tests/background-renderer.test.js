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


test("destroy is idempotent, clears safely and rejects later renders", async () => {
  const { root, scene, profile } = fixture();
  const renderer = new BackgroundRenderer({ root, resolveAsset: key => `/${key}.png` });
  await renderer.render(scene, profile);

  renderer.destroy();
  renderer.destroy();
  renderer.clear();

  assert.equal(root.children.length, 0);
  assert.equal(root.dataset.qartonSceneId, undefined);
  await assert.rejects(renderer.render(scene, profile), /has been destroyed/);
});

test("destroy invalidates a render while assets are still resolving", async () => {
  const { root, scene, profile } = fixture();
  const releases = [];
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: () => new Promise(resolve => releases.push(resolve))
  });

  const pending = renderer.render(scene, profile);
  renderer.destroy();
  releases.forEach((resolve, index) => resolve(`/late-${index}.png`));

  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
});

test("superseded asset resolution failures are ignored without disturbing the newer scene", async () => {
  const { root, scene, profile } = fixture();
  const staleRejectors = [];
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: key => {
      if (staleRejectors.length < 3) {
        return new Promise((resolve, reject) => staleRejectors.push(reject));
      }
      return Promise.resolve(`/current-${key}.png`);
    }
  });

  const staleRender = renderer.render(scene, profile);
  const currentRender = renderer.render(scene, profile);
  assert.equal(await currentRender, true);

  staleRejectors.forEach(reject => reject(new Error("stale asset failure")));
  assert.equal(await staleRender, false);
  assert.equal(root.dataset.qartonSceneId, "intro");
  assert.deepEqual(root.children.map(node => node.children[0].src), [
    "/current-images/sky.png",
    "/current-images/hero.png",
    "/current-images/title.png"
  ]);
});


test("superseding a render aborts its asset resolver signals", async () => {
  const { root, scene, profile } = fixture();
  const staleResolvers = [];
  const staleSignals = [];
  let firstRender = true;
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: (key, layer, { signal }) => {
      if (firstRender) {
        staleSignals.push(signal);
        return new Promise(resolve => staleResolvers.push(resolve));
      }
      return `/current-${key}.png`;
    }
  });

  const stale = renderer.render(scene, profile);
  firstRender = false;
  assert.equal(await renderer.render(scene, profile), true);
  assert.equal(staleSignals.length, 3);
  assert.ok(staleSignals.every(signal => signal.aborted));

  staleResolvers.forEach((resolve, index) => resolve(`/stale-${index}.png`));
  assert.equal(await stale, false);
  assert.deepEqual(root.children.map(node => node.children[0].src), [
    "/current-images/sky.png",
    "/current-images/hero.png",
    "/current-images/title.png"
  ]);
});

test("clear aborts in-flight asset resolver signals", async () => {
  const { root, scene, profile } = fixture();
  const signals = [];
  const releases = [];
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: (key, layer, { signal }) => {
      signals.push(signal);
      return new Promise(resolve => releases.push(resolve));
    }
  });

  const pending = renderer.render(scene, profile);
  renderer.clear();
  assert.ok(signals.every(signal => signal.aborted));
  releases.forEach((resolve, index) => resolve(`/late-${index}.png`));
  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
});


test("a failed layer aborts sibling asset requests from the same render", async () => {
  const { root, scene, profile } = fixture();
  const siblingSignals = [];
  const renderer = new BackgroundRenderer({
    root,
    resolveAsset: (key, layer, { signal }) => {
      if (key === "images/sky") return Promise.reject(new Error("sky asset failed"));
      siblingSignals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });

  await assert.rejects(renderer.render(scene, profile), /sky asset failed/);
  assert.equal(siblingSignals.length, 2);
  assert.ok(siblingSignals.every(signal => signal.aborted));
  assert.equal(root.children.length, 0);
});


test("rerendering an active scene applies a new quality budget without dropping characters or overlays", async () => {
  const document = new FakeDocument();
  const root = new FakeElement("main", document);
  const layers = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `background-${index}`,
      role: "background",
      asset: `background-${index}`,
      depth: index
    })),
    { id: "hero", role: "character", asset: "hero", depth: 0 },
    { id: "dialogue", role: "overlay", asset: "dialogue", depth: 0 }
  ];
  const scene = createSceneDefinition({ id: "adaptive-live-scene", layers });
  const renderer = new BackgroundRenderer({ root, resolveAsset: key => `/${key}.webp` });

  assert.equal(await renderer.render(scene, resolveQualityProfile({ quality: "high" })), true);
  assert.equal(root.children.length, 7);

  assert.equal(await renderer.render(scene, resolveQualityProfile({ quality: "low" })), true);
  assert.deepEqual(root.children.map(node => node.dataset.layerId), [
    "background-0",
    "background-1",
    "hero",
    "dialogue"
  ]);

  assert.equal(await renderer.render(scene, resolveQualityProfile({ quality: "medium" })), true);
  assert.equal(root.children.length, 6);
  assert.equal(root.children.at(-2).dataset.layerId, "hero");
  assert.equal(root.children.at(-1).dataset.layerId, "dialogue");

  renderer.destroy();
});
