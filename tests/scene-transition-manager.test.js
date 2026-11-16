import test from "node:test";
import assert from "node:assert/strict";
import { SceneTransitionManager } from "../src/runtime/scene-transition-manager.js";

function setup(overrides = {}) {
  const events = [];
  const manager = new SceneTransitionManager({
    mount: async scene => { events.push(`mount:${scene.id}`); return { id: scene.id }; },
    crossfade: async ({ from, to, duration }) => {
      events.push(`fade:${from?.id ?? "none"}->${to.id}:${duration}`);
    },
    unmount: async handle => { events.push(`unmount:${handle.id}`); },
    ...overrides
  });
  return { manager, events };
}

test("mounts the next scene before crossfade and then releases the previous scene", async () => {
  const { manager, events } = setup();
  assert.equal(await manager.transitionTo({ id: "intro" }, {}, { duration: 120 }), true);
  assert.deepEqual(events, ["mount:intro", "fade:none->intro:120"]);
  assert.equal(manager.current.id, "intro");

  assert.equal(await manager.transitionTo({ id: "street" }, {}), true);
  assert.deepEqual(events.slice(2), [
    "mount:street",
    "fade:intro->street:350",
    "unmount:intro"
  ]);
  assert.equal(manager.current.id, "street");
});

test("mount failure preserves the current scene", async () => {
  let shouldFail = false;
  const { manager } = setup({
    mount: async scene => {
      if (shouldFail) throw new Error("asset preparation failed");
      return { id: scene.id };
    }
  });
  await manager.transitionTo({ id: "safe" }, {});
  shouldFail = true;
  await assert.rejects(manager.transitionTo({ id: "broken" }, {}), /asset preparation failed/);
  assert.equal(manager.current.id, "safe");
});

test("crossfade failure unmounts the candidate and preserves the current scene", async () => {
  let fail = false;
  const { manager, events } = setup({
    crossfade: async ({ to }) => {
      if (fail) throw new Error("transition failed");
      events.push(`fade:${to.id}`);
    }
  });
  await manager.transitionTo({ id: "old" }, {});
  fail = true;
  await assert.rejects(manager.transitionTo({ id: "new" }, {}), /transition failed/);
  assert.equal(manager.current.id, "old");
  assert.ok(events.includes("unmount:new"));
});

test("a superseded transition cannot replace the latest scene", async () => {
  let releaseFirst;
  const { manager, events } = setup({
    crossfade: ({ to }) => to.id === "first"
      ? new Promise(resolve => { releaseFirst = resolve; })
      : Promise.resolve()
  });

  const first = manager.transitionTo({ id: "first" }, {});
  await Promise.resolve();
  await Promise.resolve();
  const second = manager.transitionTo({ id: "second" }, {});
  assert.equal(await second, true);
  releaseFirst();
  assert.equal(await first, false);
  assert.equal(manager.current.id, "second");
  assert.ok(events.includes("unmount:first"));
});

test("clear invalidates pending work and unmounts the active scene", async () => {
  const { manager, events } = setup();
  await manager.transitionTo({ id: "active" }, {});
  await manager.clear();
  assert.equal(manager.current, null);
  assert.equal(events.at(-1), "unmount:active");
});

test("destroy is idempotent and rejects later transitions", async () => {
  const { manager } = setup();
  await manager.transitionTo({ id: "active" }, {});
  await manager.destroy();
  await manager.destroy();
  await assert.rejects(manager.transitionTo({ id: "later" }, {}), /destroyed/);
  assert.equal(manager.current, null);
});

test("validates adapters and duration", () => {
  assert.throws(() => new SceneTransitionManager({}), /mount/);
  assert.throws(() => new SceneTransitionManager({
    mount() {}, crossfade() {}, unmount() {}, duration: -1
  }), /duration/);
});


test("destroy during an asynchronous mount still releases the late scene handle", async () => {
  let releaseMount;
  const events = [];
  const manager = new SceneTransitionManager({
    mount: scene => new Promise(resolve => { releaseMount = () => resolve({ id: scene.id }); }),
    crossfade: async () => { events.push("crossfade"); },
    unmount: async handle => { events.push(`unmount:${handle.id}`); }
  });

  const pending = manager.transitionTo({ id: "late" }, {});
  await Promise.resolve();
  assert.equal(typeof releaseMount, "function");

  await manager.destroy();
  releaseMount();
  assert.equal(await pending, false);
  assert.deepEqual(events, ["unmount:late"]);
  assert.equal(manager.current, null);
});

test("a cancelled crossfade does not commit the candidate scene", async () => {
  const { manager, events } = setup({
    crossfade: async ({ to }) => {
      events.push(`fade:${to.id}`);
      return to.id !== "candidate";
    }
  });

  await manager.transitionTo({ id: "current" }, {});
  const committed = await manager.transitionTo({ id: "candidate" }, {});

  assert.equal(committed, false);
  assert.equal(manager.current.id, "current");
  assert.ok(events.includes("unmount:candidate"));
  assert.ok(!events.includes("unmount:current"));
});
