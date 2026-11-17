import test from "node:test";
import assert from "node:assert/strict";
import { AssetManager } from "../src/assets/asset-manager.js";

test("concurrent loads share one loader call and cache the result", async () => {
  let calls = 0;
  const manager = new AssetManager({ loader: async key => { calls += 1; return `/assets/${key}.webp`; } });
  const [a, b] = await Promise.all([manager.load("sky"), manager.load("sky")]);
  assert.equal(a, "/assets/sky.webp");
  assert.equal(b, a);
  assert.equal(calls, 1);
  assert.equal(await manager.load("sky"), a);
  assert.equal(calls, 1);
  assert.equal(manager.size, 1);
});

test("asset keys are trimmed before cache lookup and loader invocation", async () => {
  const calls = [];
  const manager = new AssetManager({
    loader: async key => { calls.push(key); return `/${key}.png`; }
  });

  const [first, second] = await Promise.all([
    manager.load("  background  "),
    manager.load("background")
  ]);

  assert.equal(first, "/background.png");
  assert.equal(second, first);
  assert.deepEqual(calls, ["background"]);
  assert.equal(manager.size, 1);
  assert.equal(manager.pendingCount, 0);
});

test("preload deduplicates keys and loads independent assets concurrently", async () => {
  const calls = [];
  const manager = new AssetManager({ loader: async key => { calls.push(key); return `/${key}.png`; } });
  const urls = await manager.preload(["sky", "hero", "sky"]);
  assert.deepEqual(urls, ["/sky.png", "/hero.png"]);
  assert.deepEqual(calls.sort(), ["hero", "sky"]);
});

test("preload deduplicates keys after trimming whitespace", async () => {
  const calls = [];
  const manager = new AssetManager({
    loader: async key => { calls.push(key); return `/${key}.png`; }
  });

  const urls = await manager.preload([" sky ", "sky", "hero "]);
  assert.deepEqual(urls, ["/sky.png", "/hero.png"]);
  assert.deepEqual(calls.sort(), ["hero", "sky"]);
});

test("failed loads are not cached and can be retried", async () => {
  let attempts = 0;
  const manager = new AssetManager({ loader: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network failure");
    return "/recovered.png";
  } });
  await assert.rejects(manager.load("scene"), /network failure/);
  assert.equal(await manager.load("scene"), "/recovered.png");
  assert.equal(attempts, 2);
  assert.equal(manager.size, 1);
});

test("clear prevents late requests from repopulating the cache", async () => {
  let finish;
  const manager = new AssetManager({ loader: () => new Promise(resolve => { finish = resolve; }) });
  const pending = manager.load("late");
  await Promise.resolve();
  manager.clear();
  finish("/late.png");
  assert.equal(await pending, "/late.png");
  assert.equal(manager.size, 0);
  assert.equal(manager.pendingCount, 0);
});


test("release invalidates an in-flight cache write and allows a fresh load", async () => {
  const completions = [];
  let calls = 0;
  const manager = new AssetManager({
    loader: key => new Promise(resolve => {
      calls += 1;
      const requestNumber = calls;
      completions.push(() => resolve("/" + key + "-" + requestNumber + ".png"));
    })
  });

  const oldRequest = manager.load("background");
  await Promise.resolve();
  assert.equal(manager.pendingCount, 1);
  assert.equal(manager.release("background"), true);
  assert.equal(manager.pendingCount, 0);

  const newRequest = manager.load("background");
  await Promise.resolve();
  assert.equal(calls, 2);
  completions[1]();
  assert.equal(await newRequest, "/background-2.png");
  completions[0]();
  assert.equal(await oldRequest, "/background-1.png");
  assert.equal(await manager.load("background"), "/background-2.png");
  assert.equal(manager.size, 1);
  assert.equal(calls, 2);
});

test("release trims keys consistently with load", async () => {
  const manager = new AssetManager({ loader: key => `/${key}.png` });
  await manager.load(" background ");
  assert.equal(manager.release(" background "), true);
  assert.equal(manager.size, 0);
  assert.equal(await manager.load("background"), "/background.png");
});

test("release removes one cached key without disturbing others", async () => {
  const manager = new AssetManager({ loader: key => `/${key}.png` });
  await manager.preload(["one", "two"]);
  assert.equal(manager.release("one"), true);
  assert.equal(manager.release("missing"), false);
  assert.equal(manager.size, 1);
  assert.equal(await manager.load("two"), "/two.png");
});

test("unsafe or empty URLs are rejected and not cached", async () => {
  const manager = new AssetManager({ loader: key => key === "bad" ? "javascript:alert(1)" : key === "backslash-network-path" ? "\\\\cdn.example.com/asset.png" : "  " });
  await assert.rejects(manager.load("bad"), /unsafe URL/);
  await assert.rejects(manager.load("backslash-network-path"), /unsafe URL/);
  await assert.rejects(manager.load("empty"), /no URL/);
  assert.equal(manager.size, 0);
});

test("invalid dependencies and keys are rejected", async () => {
  assert.throws(() => new AssetManager({ loader: null }), /loader function/);
  const manager = new AssetManager({ loader: () => "/x.png" });
  await assert.rejects(manager.load(" "), /Asset key/);
  await assert.rejects(manager.preload("not-an-array"), /expects an array/);
});


test("destroy is terminal and rejects new loads without invoking the loader", async () => {
  let calls = 0;
  const manager = new AssetManager({
    loader: async key => { calls += 1; return `/${key}.png`; }
  });
  await manager.load("before-destroy");
  manager.destroy();
  manager.destroy();
  await assert.rejects(manager.load("after-destroy"), /has been destroyed/);
  await assert.rejects(manager.preload(["another"]), /has been destroyed/);
  assert.equal(calls, 1);
  assert.equal(manager.size, 0);
  assert.equal(manager.pendingCount, 0);
});

test("destroy invalidates an in-flight cache write while preserving its existing caller", async () => {
  let finish;
  let calls = 0;
  const manager = new AssetManager({
    loader: key => {
      calls += 1;
      return new Promise(resolve => { finish = () => resolve(`/${key}.png`); });
    }
  });

  const pending = manager.load("scene-background");
  await Promise.resolve();
  assert.equal(manager.pendingCount, 1);

  manager.destroy();
  assert.equal(manager.size, 0);
  assert.equal(manager.pendingCount, 0);
  await assert.rejects(manager.load("late-request"), /has been destroyed/);

  finish();
  assert.equal(await pending, "/scene-background.png");
  assert.equal(manager.size, 0);
  assert.equal(manager.pendingCount, 0);
  assert.equal(calls, 1);
});

