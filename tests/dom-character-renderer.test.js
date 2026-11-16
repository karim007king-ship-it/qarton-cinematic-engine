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
    resolveSprite: (key, context) => new Promise(resolve => pending.set(key, { resolve, signal: context.signal }))
  });
  const mounting = renderer.mount({
    id: "hero",
    sprites: { neutral: "neutral", focused: "focused", angry: "angry" },
    initialState: { expression: "neutral" }
  });
  pending.get("neutral").resolve("https://assets.test/neutral.png");
  const handle = await mounting;
  const first = renderer.update(handle, { id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused" });
  const second = renderer.update(handle, { id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "angry" });
  assert.equal(pending.get("focused").signal.aborted, true);
  pending.get("angry").resolve("https://assets.test/angry.png");
  await second;
  pending.get("focused").resolve("https://assets.test/focused.png");
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

test("invalid initial poses fail before asset resolution or DOM insertion", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolutions = 0;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      resolutions += 1;
      return `https://assets.test/${key}.png`;
    }
  });
  await assert.rejects(renderer.mount({
    id: "broken",
    sprites: { default: "broken" },
    initialState: { scale: -1 }
  }), /scale cannot be negative/);
  assert.equal(resolutions, 0);
  assert.equal(root.children.length, 0);

  const handle = await renderer.mount({
    id: "hero",
    sprites: { default: "hero" },
    initialState: { scale: 1 }
  });
  assert.equal(root.children.length, 1);
  renderer.destroy();
  assert.equal(handle.parentNode, null);
});

test("failed sprite resolution rolls back the pending mount and permits retry", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let attempts = 0;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary asset failure");
      return `https://assets.test/${key}.png`;
    }
  });
  await assert.rejects(renderer.mount({
    id: "hero",
    sprites: { default: "hero" }
  }), /temporary asset failure/);
  assert.equal(root.children.length, 0);

  const handle = await renderer.mount({
    id: "hero",
    sprites: { default: "hero" }
  });
  assert.equal(root.children.length, 1);
  assert.equal(handle.children[0].src, "https://assets.test/hero.png");
  renderer.destroy();
});

test("DOM renderer exposes deterministic speech and expression transition metadata", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "speaker",
    sprites: { neutral: "neutral", happy: "happy" },
    initialState: { expression: "neutral" }
  });
  await renderer.update(handle, {
    id: "speaker", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "happy", speaking: true, mouthFrame: 1, expressionTransition: 0.5
  });
  assert.equal(handle.dataset.speaking, "true");
  assert.equal(handle.dataset.mouthFrame, "1");
  assert.equal(handle.dataset.expressionTransition, "0.5");
  assert.equal(handle.dataset.expression, "happy");

  await renderer.update(handle, {
    id: "speaker", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "happy", speaking: false, mouthFrame: 0
  });
  assert.equal(handle.dataset.speaking, "false");
  assert.equal(handle.dataset.mouthFrame, "0");
  assert.equal(handle.dataset.expressionTransition, "1");
  renderer.destroy();
});


test("DOM renderer exposes facial animation hooks for host CSS and sprite sheets", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { default: "hero" }
  });
  await renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "neutral", breathOffsetY: -1.25, headRotation: 0.4, eyeFrame: 1
  });
  assert.equal(handle.dataset.eyeFrame, "1");
  assert.equal(handle.style["--qarton-breath-y"], "-1.25px");
  assert.equal(handle.style["--qarton-head-rotation"], "0.4deg");
  renderer.destroy();
});


test("DOM character renderer mounts independently animated body, head, eyes, and mouth layers", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const resolved = [];
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: (key, context) => {
      resolved.push({ key, context });
      return `https://assets.test/${key}.png`;
    }
  });
  const handle = await renderer.mount({
    id: "layered-hero",
    layers: [
      { id: "body", role: "body", sprites: { default: "body" } },
      { id: "head", role: "head", sprites: { neutral: "head-neutral", default: "head-neutral" } },
      { id: "eyes", role: "eyes", sprites: { open: "eyes-open", blink: "eyes-blink", default: "eyes-open" } },
      { id: "mouth", role: "mouth", sprites: { neutral: "mouth-neutral", speakingClosed: "mouth-closed", speakingOpen: "mouth-open", default: "mouth-neutral" } }
    ],
    initialState: { expression: "neutral", breathOffsetY: -1.2, headRotation: 2 }
  });

  assert.equal(handle.children.length, 4);
  assert.deepEqual(handle.children.map(layer => layer.dataset.layerRole), ["body", "head", "eyes", "mouth"]);
  assert.equal(handle.children[1].src, "https://assets.test/head-neutral.png");
  assert.equal(handle.children[2].src, "https://assets.test/eyes-open.png");
  assert.equal(handle.children[3].src, "https://assets.test/mouth-neutral.png");
  assert.equal(handle.children[1].style.transform, "translate(0px, -1.2px) rotate(2deg) scale(1, 1)");
  assert.ok(resolved.every(item => item.context.characterId === "layered-hero"));

  await renderer.update(handle, {
    id: "layered-hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "neutral", state: "talking", speaking: true, mouthFrame: 1,
    eyeFrame: 1, breathOffsetY: 0.5, headRotation: -1
  });
  assert.equal(handle.children[2].src, "https://assets.test/eyes-blink.png");
  assert.equal(handle.children[3].src, "https://assets.test/mouth-open.png");
  assert.equal(handle.children[1].style.transform, "translate(0px, 0.5px) rotate(-1deg) scale(1, 1)");
  assert.equal(handle.children[2].style.transform, "translate(0px, 0.5px) rotate(-1deg) scale(1, 1)");
  assert.equal(handle.children[3].style.transform, "translate(0px, 0.5px) rotate(-1deg) scale(1, 1)");
  renderer.destroy();
});

test("DOM character renderer rejects malformed layered sprite definitions", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: key => key });
  await assert.rejects(renderer.mount({
    id: "bad",
    layers: [{ id: "eyes", role: "eyes", sprites: {} }, { id: "eyes", role: "mouth", sprites: {} }]
  }), /unique/);
  await assert.rejects(renderer.mount({
    id: "bad",
    layers: [{ id: "eyes", role: "eyes", sprites: {} }]
  }), /No sprite asset configured/);
  assert.equal(root.children.length, 0);
});

test("DOM character renderer applies interpolated pose transforms by layer id", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "hero",
    layers: [
      { id: "body", role: "body", sprites: { default: "body" } },
      { id: "left-arm", role: "arm", sprites: { default: "arm" } }
    ],
    initialState: { pose: "walk" }
  });
  await renderer.update(handle, {
    id: "hero",
    x: 0, y: 0, opacity: 1, scale: 1, rotation: 0,
    expression: "neutral", state: "moving", pose: "walk", poseProgress: 0.5,
    layerTransforms: {
      "left-arm": { translateX: 3, translateY: 4, rotation: 25, scaleX: 1, scaleY: 1 }
    }
  });
  assert.equal(handle.dataset.pose, "walk");
  assert.equal(handle.dataset.poseProgress, "0.5");
  assert.equal(handle.children[1].style.transform, "translate(3px, 4px) rotate(25deg) scale(1, 1)");
  renderer.destroy();
});

test("DOM renderer nests rig nodes and applies local transforms through parent inheritance", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "rigged-hero",
    layers: [
      { id: "torso", role: "torso", sprites: { default: "torso" } },
      { id: "head", role: "head", parent: "torso", sprites: { default: "head" } },
      { id: "eyes", role: "eyes", parent: "head", sprites: { open: "eyes", default: "eyes" } },
      { id: "left-arm", role: "arm", parent: "torso", sprites: { default: "arm" } }
    ],
    initialState: {
      breathOffsetY: 2,
      headRotation: 5,
      layerTransforms: {
        torso: { rotation: 10 },
        head: { translateY: -4, rotation: 10 },
        eyes: { translateX: 1 },
        "left-arm": { rotation: -20 }
      }
    }
  });

  const torso = handle.children[0];
  const head = torso.children[1];
  const eyes = head.children[1];
  const arm = torso.children[2];
  assert.equal(torso.children[0].tagName, "img");
  assert.equal(head.children[0].tagName, "img");
  assert.equal(eyes.children[0].tagName, "img");
  assert.match(torso.style.transform, /translate\(0px, 2px\).*rotate\(10deg\)/);
  assert.match(head.style.transform, /translate\(0px, -4px\).*rotate\(15deg\)/);
  assert.match(eyes.style.transform, /translate\(1px, 0px\).*rotate\(0deg\)/);
  assert.match(arm.style.transform, /rotate\(-20deg\)/);
  assert.equal(eyes.children[0].style.transform, "none");
  renderer.destroy();
  assert.equal(root.children.length, 0);
});

test("DOM renderer rejects broken rig relationships before resolving assets", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolutions = 0;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => {
      resolutions += 1;
      return `https://assets.test/${key}.png`;
    }
  });
  await assert.rejects(renderer.mount({
    id: "broken-rig",
    layers: [
      { id: "head", role: "head", parent: "eyes", sprites: { default: "head" } },
      { id: "eyes", role: "eyes", parent: "head", sprites: { default: "eyes" } }
    ]
  }), /cycle/);
  assert.equal(resolutions, 0);
  assert.equal(root.children.length, 0);
  renderer.destroy();
});

test("DOM renderer applies validated static rig transforms even without a parent", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "offset-head",
    layers: [{
      id: "head", role: "head",
      transform: { translateX: 7, translateY: -3, rotation: 12, scaleX: 1.1, scaleY: 0.9 },
      sprites: { default: "head" }
    }]
  });
  assert.equal(handle.children.length, 1);
  assert.match(handle.children[0].style.transform, /translate\(7px, -3px\).*rotate\(12deg\).*scale\(1.1, 0.9\)/);
  renderer.destroy();
});


test("DOM character renderer rejects unsafe resolved sprite URLs and rolls back mounts", async () => {
  const invalidUrls = [
    "javascript:alert(1)",
    "VbScRiPt:alert(1)",
    "file:///etc/passwd",
    "//remote.example/hero.png",
    "https://assets.test/hero\n.png"
  ];

  for (const url of invalidUrls) {
    const document = new Document();
    const root = new Element("main", document);
    const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => url });
    await assert.rejects(
      renderer.mount({ id: "unsafe-hero", sprites: { default: "hero" } }),
      /unsafe URL/
    );
    assert.equal(root.children.length, 0);
    renderer.destroy();
  }

  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({ root, resolveSprite: () => "  " });
  await assert.rejects(
    renderer.mount({ id: "empty-hero", sprites: { default: "hero" } }),
    /invalid URL/
  );
  assert.equal(root.children.length, 0);
  renderer.destroy();
});


test("destroy removes every character when a host element remove method throws", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const first = await renderer.mount({ id: "first", sprites: { default: "first" } });
  const second = await renderer.mount({ id: "second", sprites: { default: "second" } });
  first.remove = () => { throw new Error("host remove failed"); };
  second.remove = () => { throw new Error("host remove failed"); };

  assert.doesNotThrow(() => renderer.destroy());
  assert.equal(root.children.length, 0);
  assert.doesNotThrow(() => renderer.destroy());
  assert.equal(renderer.unmount(first), undefined);
});

test("unmount falls back to the root when a character element remove method throws", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({ id: "hero", sprites: { default: "hero" } });
  handle.remove = () => { throw new Error("host remove failed"); };

  assert.doesNotThrow(() => renderer.unmount(handle));
  assert.equal(root.children.length, 0);
  assert.equal(renderer.unmount(handle), undefined);
});


test("an update invalidated by unmount reports that it did not complete", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveFocused;
  let focusedSignal;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: (key, context) => key === "focused"
      ? (focusedSignal = context.signal, new Promise(resolve => { resolveFocused = resolve; }))
      : `https://assets.test/${key}.png`
  });
  const handle = await renderer.mount({
    id: "hero",
    sprites: { neutral: "neutral", focused: "focused" },
    initialState: { expression: "neutral" }
  });
  const pendingUpdate = renderer.update(handle, {
    id: "hero", x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, expression: "focused"
  });
  renderer.unmount(handle);
  assert.equal(focusedSignal.aborted, true);
  resolveFocused("https://assets.test/focused.png");

  assert.equal(await pendingUpdate, false);
  assert.equal(root.children.length, 0);
});

test("destroy aborts sprite resolution while a character is mounting", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveSprite;
  let signal;
  const renderer = createDOMCharacterRenderer({
    root,
    resolveSprite: (key, context) => {
      signal = context.signal;
      return new Promise(resolve => { resolveSprite = resolve; });
    }
  });

  const mounting = renderer.mount({
    id: "late-hero",
    sprites: { default: "hero" }
  });
  renderer.destroy();
  assert.equal(signal.aborted, true);
  resolveSprite("https://assets.test/hero.png");
  await assert.rejects(mounting, /destroyed/);
  assert.equal(root.children.length, 0);
});
