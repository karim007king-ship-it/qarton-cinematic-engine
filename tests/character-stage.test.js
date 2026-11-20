import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterStage } from "../src/character/character-stage.js";
import { createCharacterController } from "../src/character/character-controller.js";
import { createMotionPath } from "../src/motion/path.js";
import { createTimeline } from "../src/motion/timeline.js";
import { createIdleAnimation } from "../src/character/idle-animation.js";
import { createWalkAnimation } from "../src/character/walk-animation.js";
import { createSpriteFrameAnimation } from "../src/character/sprite-frame-animation.js";

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

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

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
      characters: [{ controller, sprites: { neutral: "neutral", focused: "focused", walk1: "walk1", walk2: "walk2", stand: "stand" } }],
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


test("immediate remount starts a fresh operation while stale mount settles", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const controller = createCharacterController({ id: "hero" });
  const resolvers = [];
  const stage = createCharacterStage({
    root,
    resolveSprite: () => new Promise(resolve => { resolvers.push(resolve); }),
    characters: [{ controller, sprites: { default: "hero" } }]
  });

  const staleMount = stage.mount();
  await Promise.resolve();
  stage.unmount();

  const freshMount = stage.mount();
  await Promise.resolve();
  assert.equal(resolvers.length, 2);

  resolvers[1]("https://assets.test/fresh.png");
  assert.equal(await freshMount, true);
  resolvers[0]("https://assets.test/stale.png");
  assert.equal(await staleMount, false);

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].children[0].src, "https://assets.test/fresh.png");

  // A late stale completion must not erase the newer mount's handle.
  await stage.update(100);
  stage.unmount();
  assert.equal(root.children.length, 0);
  stage.destroy();
});


test("stale partial mount cannot clear handles created by a newer multi-character mount", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const resolvers = [];
  const first = createCharacterController({ id: "first" });
  const second = createCharacterController({ id: "second" });
  const stage = createCharacterStage({
    root,
    resolveSprite: key => new Promise(resolve => resolvers.push({ key, resolve })),
    characters: [
      { controller: first, sprites: { default: "first" } },
      { controller: second, sprites: { default: "second" } }
    ]
  });

  const staleMount = stage.mount();
  await flushMicrotasks();
  resolvers[0].resolve("https://assets.test/old-first.png");
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(resolvers.length, 2);

  stage.unmount();
  const freshMount = stage.mount();
  await flushMicrotasks();
  assert.equal(resolvers.length, 3);

  resolvers[2].resolve("https://assets.test/new-first.png");
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(resolvers.length, 4);

  resolvers[3].resolve("https://assets.test/new-second.png");
  assert.equal(await freshMount, true);
  resolvers[1].resolve("https://assets.test/old-second.png");
  assert.equal(await staleMount, false);

  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].children[0].src, "https://assets.test/new-first.png");
  assert.equal(root.children[1].children[0].src, "https://assets.test/new-second.png");

  await stage.update(50);
  stage.unmount();
  assert.equal(root.children.length, 0);
  stage.destroy();
});


test("unmount attempts every character release and resets stage state when a DOM cleanup throws", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const first = createCharacterController({ id: "first" });
  const second = createCharacterController({ id: "second" });
  const failure = new Error("first character removal failed");
  const stage = createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [
      { controller: first, sprites: { default: "first" } },
      { controller: second, sprites: { default: "second" } }
    ]
  });

  await stage.mount();
  assert.equal(root.children.length, 2);
  const firstElement = root.children[0];
  firstElement.remove = () => { throw failure; };

  assert.throws(() => stage.unmount(), error => error === failure);
  assert.equal(root.children.length, 0);
  assert.equal(await stage.mount(), true);
  assert.equal(root.children.length, 2);
  stage.destroy();
  assert.equal(root.children.length, 0);
});


test("partial mount rollback attempts every completed character cleanup", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const first = createCharacterController({ id: "first" });
  const second = createCharacterController({ id: "second" });
  const third = createCharacterController({ id: "third" });
  const cleanupFailure = new Error("second character removal failed");
  const mountFailure = new Error("third sprite unavailable");
  const originalRemoveChild = root.removeChild.bind(root);
  root.removeChild = child => {
    if (child.dataset.characterId === "second") throw cleanupFailure;
    originalRemoveChild(child);
  };
  const stage = createCharacterStage({
    root,
    resolveSprite: key => {
      if (key === "broken") throw mountFailure;
      return `https://assets.test/${key}.png`;
    },
    characters: [
      { controller: first, sprites: { default: "first" } },
      { controller: second, sprites: { default: "second" } },
      { controller: third, sprites: { default: "broken" } }
    ]
  });

  await assert.rejects(stage.mount(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, mountFailure);
    assert.deepEqual(error.errors, [mountFailure, cleanupFailure]);
    return true;
  });
  assert.deepEqual(root.children.map(child => child.dataset.characterId), ["second"]);
  // A transient DOM cleanup failure must remain recoverable by final teardown.
  root.removeChild = originalRemoveChild;
  stage.destroy();
  assert.equal(root.children.length, 0);
});


test("character stage destroy can retry a transient DOM cleanup failure", async () => {
  const { root, stage } = fixture();
  await stage.mount();
  const originalRemoveChild = root.removeChild.bind(root);
  const failure = new Error("temporary stage cleanup failure");
  root.removeChild = () => { throw failure; };

  assert.throws(() => stage.destroy(), error => error === failure);
  assert.equal(root.children.length, 1);
  root.removeChild = originalRemoveChild;
  assert.doesNotThrow(() => stage.destroy());
  assert.equal(root.children.length, 0);
  await assert.rejects(stage.mount(), /destroyed/);
});



test("concurrent character updates serialize timeline delivery", async () => {
  let releaseEvent;
  const eventGate = new Promise(resolve => { releaseEvent = resolve; });
  const events = [];
  const timeline = createTimeline([{ id: "once", atMs: 100, type: "dialogue" }]);
  const { stage } = fixture({
    timeline,
    onEvent: async event => {
      events.push(event.id);
      await eventGate;
    }
  });
  await stage.mount();

  const first = stage.update(200);
  await flushMicrotasks();
  const second = stage.update(200);
  releaseEvent();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(events, ["once"]);
  stage.destroy();
});

test("unmount invalidates an update waiting for an asynchronous sprite", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const controller = createCharacterController({
    id: "hero",
    initial: { expression: "neutral" },
    motions: [{
      id: "walk",
      path: createMotionPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      startMs: 100,
      durationMs: 1000,
      expression: "focused"
    }]
  });
  let resolveFocused;
  const events = [];
  const stage = createCharacterStage({
    root,
    resolveSprite: key => key === "focused"
      ? new Promise(resolve => { resolveFocused = resolve; })
      : `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { neutral: "neutral", focused: "focused" } }],
    timeline: createTimeline([{ id: "after", atMs: 500, type: "dialogue" }]),
    onEvent: event => events.push(event.id)
  });

  await stage.mount();
  const pending = stage.update(500);
  await flushMicrotasks();
  stage.unmount();
  resolveFocused("https://assets.test/focused.png");
  assert.equal(await pending, false);
  assert.deepEqual(events, []);
  assert.equal(root.children.length, 0);
  stage.destroy();
});

test("character stage waits for sprite sampling before dispatching async timeline events", async () => {
  const document = new Document();
  const root = new Element("main", document);
  const path = createMotionPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const controller = createCharacterController({
    id: "hero",
    initial: { expression: "neutral" },
    motions: [{ id: "walk", path, startMs: 100, durationMs: 1000, expression: "focused" }]
  });
  let resolveSprite;
  let spriteCalls = 0;
  const events = [];
  const stage = createCharacterStage({
    root,
    resolveSprite: key => {
      spriteCalls += 1;
      if (key === "focused" && spriteCalls === 2) {
        return new Promise(resolve => { resolveSprite = resolve; });
      }
      return `https://assets.test/${key}.png`;
    },
    characters: [{ controller, sprites: { neutral: "neutral", focused: "focused" } }],
    timeline: createTimeline([{ id: "step", atMs: 500, type: "dialogue" }]),
    onEvent: event => events.push(event.id)
  });

  await stage.mount();
  const updating = stage.update(500);
  await flushMicrotasks();
  assert.deepEqual(events, []);
  resolveSprite("https://assets.test/focused.png");
  assert.equal(await updating, true);
  assert.deepEqual(events, ["step"]);
  stage.destroy();
});

test("character stage retries failed async timeline callbacks without replaying delivered events", async () => {
  const events = [];
  let failSecond = true;
  const timeline = createTimeline([
    { id: "first", atMs: 100, type: "dialogue" },
    { id: "second", atMs: 200, type: "dialogue" },
    { id: "third", atMs: 300, type: "dialogue" }
  ]);
  const { stage } = fixture({
    timeline,
    onEvent: async event => {
      events.push(event.id);
      if (event.id === "second" && failSecond) {
        failSecond = false;
        throw new Error("dialogue callback failed");
      }
    }
  });

  await stage.mount();
  await assert.rejects(stage.update(400), /dialogue callback failed/);
  assert.deepEqual(events, ["first", "second"]);
  assert.equal(await stage.update(400), true);
  assert.deepEqual(events, ["first", "second", "second", "third"]);
  stage.destroy();
});


test("character stage applies optional deterministic idle animation without changing controllers", async () => {
  const { root, controller, stage } = fixture({
    idleAnimations: {
      hero: createIdleAnimation({
        periodMs: 2000,
        bobAmplitude: 4,
        swayAmplitude: 0.02,
        blinkIntervalMs: 5000
      })
    }
  });
  await stage.mount();
  await stage.update(500);
  const character = root.children[0];
  assert.match(character.style.transform, /translate3d\(50px, -2px, 0\)/);
  assert.match(character.style.transform, /scale\(1\.02, 0\.99\)/);
  assert.equal(character.children[0].style.transform, "scaleY(1)");
  assert.equal(controller.update(500).y, 0);
  stage.destroy();
});

test("character stage validates optional idle animation mappings", () => {
  const { root, controller } = fixture();
  assert.throws(() => createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { default: "hero" } }],
    idleAnimations: { missing: createIdleAnimation() }
  }), /unknown character/);
  assert.throws(() => createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { default: "hero" } }],
    idleAnimations: { hero: {} }
  }), /sample\(timeMs\)/);
});


test("character stage composes optional walk and idle poses without mutating controller state", async () => {
  const { root, controller, stage } = fixture({
    idleAnimations: { hero: createIdleAnimation({
      periodMs: 2000, bobAmplitude: 2, swayAmplitude: 0,
      phaseOffsetMs: 900, blinkIntervalMs: 5000
    }) },
    walkAnimations: { hero: createWalkAnimation({ stepPeriodMs: 400, bobAmplitude: 3, strideScale: 0.02 }) }
  });
  await stage.mount();
  await stage.update(0);
  const initialTransform = root.children[0].style.transform;
  assert.match(initialTransform, /scale\(1.02, 0.98\)/);
  await stage.update(100);
  const movingTransform = root.children[0].style.transform;
  assert.match(movingTransform, /translate3d\(0\.4\d*px, -5px, 0\)/);
  assert.equal(controller.update(100).y, 0);
  await stage.update(1200);
  assert.equal(root.children[0].dataset.state, "idle");
  stage.destroy();
});

test("character stage validates optional walk animation mappings", () => {
  const { root, controller } = fixture();
  assert.throws(() => createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { default: "hero" } }],
    walkAnimations: { missing: createWalkAnimation() }
  }), /unknown character/);
  assert.throws(() => createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { default: "hero" } }],
    walkAnimations: { hero: {} }
  }), /sample\(timeMs, characterState\)/);
});


test("character stage selects sprite frames from the shared scene clock", async () => {
  const { root, stage } = fixture({
    spriteAnimations: {
      hero: createSpriteFrameAnimation({
        frames: ["walk1", "walk2"],
        idleFrame: "stand",
        frameDurationMs: 100
      })
    }
  });
  await stage.mount();
  assert.equal(root.children[0].children[0].src, "https://assets.test/stand.png");
  await stage.update(0);
  assert.equal(root.children[0].children[0].src, "https://assets.test/walk1.png");
  await stage.update(100);
  assert.equal(root.children[0].children[0].src, "https://assets.test/walk2.png");
  await stage.update(200);
  assert.equal(root.children[0].children[0].src, "https://assets.test/walk1.png");
  stage.destroy();
});

test("character stage rejects sprite frames missing from the character asset map", () => {
  const { root, controller } = fixture();
  assert.throws(() => createCharacterStage({
    root,
    resolveSprite: key => `https://assets.test/${key}.png`,
    characters: [{ controller, sprites: { default: "hero" } }],
    spriteAnimations: {
      hero: createSpriteFrameAnimation({ frames: ["walk1"] })
    }
  }), /not configured/);
});
