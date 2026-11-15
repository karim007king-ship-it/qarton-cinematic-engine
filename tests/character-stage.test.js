import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterStage } from "../src/character/character-stage.js";
import { createCharacterController } from "../src/character/character-controller.js";
import { createMotionPath } from "../src/motion/path.js";
import { createTimeline } from "../src/motion/timeline.js";

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
class Document { createElement(tag) { return new Element(tag, this); } }

function fixture(options = {}) {
  const document = new Document();
  const root = new Element("main", document);
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const controller = createCharacterController({
    id: "hero",
    initial: { expression: "neutral" },
    motions: [{ id: "walk", path, startMs: 0, durationMs: 1000, expression: "focused" }]
  });
  return {
    root,
    controller,
    stage: createCharacterStage({
      root,
      resolveSprite: key => `https://assets.test/${key}.png`,
      characters: [{ controller, sprites: { neutral: "neutral", focused: "focused" } }],
      ...options
    })
  };
}

test("character stage mounts, samples motion and dispatches timeline events", async () => {
  const events = [];
  const timeline = createTimeline([
    { id: "step", atMs: 250, type: "sound", target: "hero" },
    { id: "impact", atMs: 750, type: "effect", target: "scene" }
  ]);
  const { root, stage } = fixture({ timeline, onEvent: event => events.push(event.id) });
  assert.equal(await stage.mount(), true);
  assert.equal(root.children.length, 1);
  await stage.update(500);
  assert.match(root.children[0].style.transform, /translate3d\(50px, 0px, 0\)/);
  assert.equal(root.children[0].children[0].src, "https://assets.test/focused.png");
  assert.deepEqual(events, ["step"]);
  await stage.update(900);
  assert.deepEqual(events, ["step", "impact"]);
  stage.destroy();
  assert.equal(root.children.length, 0);
});

test("character stage supports remount and deterministic event replay after seeking backwards", async () => {
  const events = [];
  const timeline = createTimeline([{ id: "cue", atMs: 200, type: "sound" }]);
  const { root, stage } = fixture({ timeline, onEvent: event => events.push(event.id) });
  await stage.mount();
  await stage.update(300);
  await stage.update(100);
  await stage.update(300);
  assert.deepEqual(events, ["cue", "cue"]);
  stage.unmount();
  assert.equal(root.children.length, 0);
  await stage.mount();
  assert.equal(root.children.length, 1);
  stage.destroy();
});

test("character stage rolls back partial mounts and rejects updates before mount", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  const first = createCharacterController({ id: "first" });
  const second = createCharacterController({ id: "second" });
  const stage = createCharacterStage({
    root,
    resolveSprite: key => {
      if (key === "broken") throw new Error("sprite unavailable");
      return `https://assets.test/${key}.png`;
    },
    characters: [
      { controller: first, sprites: { default: "ok" } },
      { controller: second, sprites: { default: "broken" } }
    ]
  });
  await assert.rejects(stage.update(0), /must be mounted/);
  await assert.rejects(stage.mount(), /sprite unavailable/);
  assert.equal(root.children.length, 0);
  stage.destroy();
  await assert.rejects(stage.mount(), /destroyed/);
});


test("concurrent mount calls share one mounting operation", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveSprite;
  let calls = 0;
  const controller = createCharacterController({ id: "hero" });
  const stage = createCharacterStage({
    root,
    resolveSprite: () => {
      calls += 1;
      return new Promise(resolve => { resolveSprite = resolve; });
    },
    characters: [{ controller, sprites: { default: "hero" } }]
  });
  const first = stage.mount();
  const second = stage.mount();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveSprite("https://assets.test/hero.png");
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(root.children.length, 1);
  stage.destroy();
});

test("unmount during async mount prevents a late character from remaining mounted", async () => {
  const document = new Document();
  const root = new Element("main", document);
  let resolveSprite;
  let calls = 0;
  const controller = createCharacterController({ id: "hero" });
  const stage = createCharacterStage({
    root,
    resolveSprite: () => {
      calls += 1;
      if (calls > 1) return "https://assets.test/hero.png";
      return new Promise(resolve => { resolveSprite = resolve; });
    },
    characters: [{ controller, sprites: { default: "hero" } }]
  });
  const pending = stage.mount();
  await Promise.resolve();
  stage.unmount();
  resolveSprite("https://assets.test/hero.png");
  assert.equal(await pending, false);
  assert.equal(root.children.length, 0);
  assert.equal(await stage.mount().then(() => true), true);
  stage.destroy();
});


test("character stage passes layered sprite definitions to its DOM renderer", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const controller = createCharacterController({ id: "layered", initial: { expression: "neutral" } });
  const stage = createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{
      controller,
      layers: [
        { id: "body", role: "body", sprites: { default: "body" } },
        { id: "eyes", role: "eyes", sprites: { open: "eyes-open", blink: "eyes-blink", default: "eyes-open" } }
      ]
    }]
  });
  await stage.mount();
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].children.length, 2);
  await stage.update(200);
  assert.equal(root.children[0].children[1].src, "https://assets.test/eyes-open.png");
  stage.destroy();
});
