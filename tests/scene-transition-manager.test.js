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

  const destroying = manager.destroy();
  let destroySettled = false;
  destroying.then(() => { destroySettled = true; });
  await Promise.resolve();
  assert.equal(destroySettled, false);

  releaseMount();
  assert.equal(await pending, false);
  await destroying;
  assert.deepEqual(events, ["unmount:late"]);
  assert.equal(manager.current, null);
});


test("an explicitly cancelled crossfade never commits the candidate scene", async () => {
  const { manager, events } = setup({
    crossfade: async ({ to }) => {
      if (to.id === "cancelled") {
        events.push(`fade-cancelled:${to.id}`);
        return false;
      }
      events.push(`fade:${to.id}`);
      return true;
    }
  });

  await manager.transitionTo({ id: "old" }, {});
  const old = manager.current;
  assert.equal(await manager.transitionTo({ id: "cancelled" }, {}), false);
  assert.equal(manager.current, old);
  assert.ok(events.includes("unmount:cancelled"));
});

test("failure to retire the previous scene does not roll back the committed scene", async () => {
  const { manager } = setup({
    unmount: async handle => {
      if (handle.id === "old") throw new Error("old scene cleanup failed");
    }
  });

  await manager.transitionTo({ id: "old" }, {});
  await assert.rejects(
    manager.transitionTo({ id: "new" }, {}),
    /old scene cleanup failed/
  );
  assert.equal(manager.current.id, "new");
});


test("clear retains scene ownership and retries a transient unmount failure", async () => {
  let fail = true;
  let attempts = 0;
  const { manager } = setup({
    unmount: async () => {
      attempts += 1;
      if (fail) throw new Error("temporary unmount failure");
    }
  });
  await manager.transitionTo({ id: "retryable" }, {});

  await assert.rejects(manager.clear(), /temporary unmount failure/);
  assert.equal(manager.current, null);
  fail = false;
  await manager.clear();
  assert.equal(attempts, 2);
});

test("destroy can be retried after a transient scene cleanup failure", async () => {
  let fail = true;
  let attempts = 0;
  const { manager } = setup({
    unmount: async () => {
      attempts += 1;
      if (fail) throw new Error("destroy cleanup failed");
    }
  });
  await manager.transitionTo({ id: "retry-destroy" }, {});

  await assert.rejects(manager.destroy(), /destroy cleanup failed/);
  fail = false;
  await manager.destroy();
  assert.equal(attempts, 2);
  await assert.rejects(manager.transitionTo({ id: "late" }, {}), /destroyed/);
});


test("clear rejects new transitions until its cleanup snapshot is complete", async () => {
  let releaseMount;
  const events = [];
  const manager = new SceneTransitionManager({
    mount: scene => scene.id === "pending"
      ? new Promise(resolve => {
        releaseMount = () => resolve({ id: scene.id });
      })
      : Promise.resolve({ id: scene.id }),
    crossfade: async ({ to }) => { events.push(`crossfade:${to.id}`); },
    unmount: async handle => { events.push(`unmount:${handle.id}`); }
  });

  const pending = manager.transitionTo({ id: "pending" }, {});
  await Promise.resolve();
  const clearing = manager.clear();

  await assert.rejects(
    manager.transitionTo({ id: "racing" }, {}),
    /is clearing/
  );

  releaseMount();
  assert.equal(await pending, false);
  await clearing;
  assert.deepEqual(events, ["unmount:pending"]);
  assert.equal(manager.current, null);

  assert.equal(await manager.transitionTo({ id: "after-clear" }, {}), true);
  assert.equal(manager.current.id, "after-clear");
});


test("rapid out-of-order mounts only allow the newest request to commit", async () => {
  const resolvers = new Map();
  const events = [];
  const manager = new SceneTransitionManager({
    mount: scene => new Promise(resolve => { resolvers.set(scene.id, resolve); }),
    crossfade: async ({ to }) => { events.push(`crossfade:${to.id}`); return true; },
    unmount: async handle => { events.push(`unmount:${handle.id}`); }
  });

  const first = manager.transitionTo({ id: "first" }, {});
  const second = manager.transitionTo({ id: "second" }, {});
  const third = manager.transitionTo({ id: "third" }, {});

  resolvers.get("third")({ id: "third" });
  assert.equal(await third, true);
  resolvers.get("second")({ id: "second" });
  assert.equal(await second, false);
  resolvers.get("first")({ id: "first" });
  assert.equal(await first, false);

  assert.equal(manager.current.id, "third");
  assert.deepEqual(events, [
    "crossfade:third",
    "unmount:second",
    "unmount:first"
  ]);
  await manager.destroy();
});

test("concurrent clear calls share one cleanup pass and one release", async () => {
  let release;
  let unmountCalls = 0;
  const manager = new SceneTransitionManager({
    mount: async scene => ({ id: scene.id }),
    crossfade: async () => true,
    unmount: () => {
      unmountCalls += 1;
      return new Promise(resolve => { release = resolve; });
    }
  });

  await manager.transitionTo({ id: "shared-clear" }, {});
  const firstClear = manager.clear();
  const secondClear = manager.clear();
  assert.equal(secondClear, firstClear);
  // clear() yields while awaiting the pending-transition snapshot before it
  // starts releasing handles; allow that continuation to reach unmount().
  await Promise.resolve();
  assert.equal(unmountCalls, 1);

  release();
  await Promise.all([firstClear, secondClear]);
  assert.equal(unmountCalls, 1);
  assert.equal(manager.current, null);
  await manager.destroy();
});

test("destroy ignores an invalidated pending mount rejection after releasing owned scenes", async () => {
  let rejectMount;
  const events = [];
  const manager = new SceneTransitionManager({
    mount: () => new Promise((_resolve, reject) => { rejectMount = reject; }),
    crossfade: async () => true,
    unmount: async handle => { events.push(`unmount:${handle.id}`); }
  });

  const pending = manager.transitionTo({ id: "aborted-mount" }, {});
  await Promise.resolve();
  const destroying = manager.destroy();
  rejectMount(Object.assign(new Error("render asset aborted"), { name: "AbortError" }));

  await assert.rejects(pending, { name: "AbortError" });
  await destroying;
  assert.deepEqual(events, []);
  assert.equal(manager.current, null);
});
