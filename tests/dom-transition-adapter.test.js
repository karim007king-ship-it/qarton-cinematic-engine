import test from "node:test";
import assert from "node:assert/strict";
import { createDOMTransitionAdapter } from "../src/runtime/dom-transition-adapter.js";

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      remove: name => this.classes.delete(name),
      add: name => this.classes.add(name)
    };
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
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}
class FakeDocument {
  createElement(tag) { return new FakeElement(tag, this); }
}
function setup(options = {}) {
  const document = new FakeDocument();
  const root = new FakeElement("main", document);
  const adapter = createDOMTransitionAdapter({
    root,
    renderScene: async scene => {
      if (scene.fail) throw new Error("scene render failed");
      return document.createElement("section");
    },
    wait: async () => {},
    ...options
  });
  return { root, adapter };
}

test("mounts scenes and performs a CSS fallback crossfade", async () => {
  const { root, adapter } = setup();
  const first = await adapter.mount({ id: "one" }, {});
  await adapter.crossfade({ from: null, to: first, duration: 200 });
  const second = await adapter.mount({ id: "two" }, {});
  await adapter.crossfade({ from: first, to: second, duration: 200 });
  assert.equal(first.style.opacity, "0");
  assert.equal(second.style.opacity, "1");
  assert.equal(second.style.filter, "none");
  assert.equal(root.children.length, 2);
  adapter.unmount(first);
  assert.equal(root.children.length, 1);
});

test("uses instant transitions for reduced motion and zero duration", async () => {
  const { adapter } = setup({ reducedMotion: true });
  const scene = await adapter.mount({ id: "still" }, {});
  await adapter.crossfade({ from: null, to: scene, duration: 500 });
  assert.equal(scene.style.opacity, "1");
  assert.equal(scene.style.filter, "none");
});

test("propagates scene rendering failures without mounting partial nodes", async () => {
  const { root, adapter } = setup();
  await assert.rejects(adapter.mount({ id: "broken", fail: true }, {}), /scene render failed/);
  assert.equal(root.children.length, 0);
});

test("rejects invalid mount output and invalid transition duration", async () => {
  const { adapter } = setup({ renderScene: async () => null });
  await assert.rejects(adapter.mount({ id: "invalid" }, {}), /DOM element/);
  const valid = setup();
  const scene = await valid.adapter.mount({ id: "valid" }, {});
  await assert.rejects(valid.adapter.crossfade({ from: null, to: scene, duration: -1 }), /duration/);
});

test("destroy removes all mounted scene wrappers and prevents new mounts", async () => {
  const { root, adapter } = setup();
  await adapter.mount({ id: "one" }, {});
  await adapter.mount({ id: "two" }, {});
  adapter.destroy();
  assert.equal(root.children.length, 0);
  await assert.rejects(adapter.mount({ id: "later" }, {}), /destroyed/);
});

test("a newer transition cancels the stale visual transition", async () => {
  const waits = [];
  const { adapter } = setup({
    wait: () => new Promise(resolve => { waits.push(resolve); })
  });
  const oldScene = await adapter.mount({ id: "old" }, {});
  const firstScene = await adapter.mount({ id: "first" }, {});
  const secondScene = await adapter.mount({ id: "second" }, {});

  const firstTransition = adapter.crossfade({ from: oldScene, to: firstScene, duration: 100 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(waits.length, 1);

  const secondTransition = adapter.crossfade({ from: oldScene, to: secondScene, duration: 100 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(waits.length, 2);
  waits[1]();
  assert.equal(await secondTransition, true);
  assert.equal(await firstTransition, false);
  assert.equal(secondScene.style.opacity, "1");
  assert.equal(firstScene.style.opacity, "0");
});

test("unmounting a scene involved in a transition cancels that transition", async () => {
  let release;
  const { adapter } = setup({
    wait: () => new Promise(resolve => { release = resolve; })
  });
  const oldScene = await adapter.mount({ id: "old" }, {});
  const nextScene = await adapter.mount({ id: "next" }, {});
  const pending = adapter.crossfade({ from: oldScene, to: nextScene, duration: 100 });
  await Promise.resolve();
  await Promise.resolve();
  adapter.unmount(nextScene);
  assert.equal(await pending, false);
  release?.();
  assert.equal(nextScene.parentNode, null);
});



test("waits for a rendering frame before starting CSS transitions", async () => {
  let frames = 0;
  const { adapter } = setup({
    nextFrame: async () => { frames += 1; }
  });
  const oldScene = await adapter.mount({ id: "old" }, {});
  const nextScene = await adapter.mount({ id: "next" }, {});
  await adapter.crossfade({ from: oldScene, to: nextScene, duration: 80 });
  assert.equal(frames, 1);
  assert.match(nextScene.style.transition, /opacity 80ms/);
  assert.equal(nextScene.style.opacity, "1");
});

test("falls back to CSS when Web Animations creation throws synchronously", async () => {
  let frames = 0;
  const { adapter } = setup({
    animate: () => { throw new Error("animation API unavailable"); },
    nextFrame: async () => { frames += 1; }
  });
  const oldScene = await adapter.mount({ id: "old" }, {});
  const nextScene = await adapter.mount({ id: "next" }, {});
  assert.equal(await adapter.crossfade({ from: oldScene, to: nextScene, duration: 90 }), true);
  assert.equal(frames, 1);
  assert.equal(oldScene.style.opacity, "0");
  assert.equal(nextScene.style.opacity, "1");
});

test("cleans transition state when the injected frame scheduler rejects", async () => {
  const { adapter } = setup({
    nextFrame: async () => { throw new Error("frame scheduling failed"); }
  });
  const oldScene = await adapter.mount({ id: "old" }, {});
  const nextScene = await adapter.mount({ id: "next" }, {});
  await assert.rejects(
    adapter.crossfade({ from: oldScene, to: nextScene, duration: 90 }),
    /frame scheduling failed/
  );
  // A subsequent instant transition proves the failed transition did not
  // leave an active cancellation token blocking future work.
  assert.equal(await adapter.crossfade({ from: null, to: nextScene, duration: 0 }), true);
});
