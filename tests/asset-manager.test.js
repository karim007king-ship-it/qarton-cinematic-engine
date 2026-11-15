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

test("preload deduplicates keys and loads independent assets concurrently", async () => {
  const calls = [];
  const manager = new AssetManager({ loader: async key => { calls.push(key); return `/${key}.png`; } });
  const urls = await manager.preload(["sky", "hero", "sky"]);
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

test("release removes one cached key without disturbing others", async () => {
  const manager = new AssetManager({ loader: key => `/${key}.png` });
  await manager.preload(["one", "two"]);
  assert.equal(manager.release("one"), true);
  assert.equal(manager.release("missing"), false);
  assert.equal(manager.size, 1);
  assert.equal(await manager.load("two"), "/two.png");
});

test("unsafe or empty URLs are rejected and not cached", async () => {
  const manager = new AssetManager({ loader: key => key === "bad" ? "javascript:alert(1)" : "  " });
  await assert.rejects(manager.load("bad"), /unsafe URL/);
  await assert.rejects(manager.load("empty"), /no URL/);
  assert.equal(manager.size, 0);
});

test("invalid dependencies and keys are rejected", async () => {
  assert.throws(() => new AssetManager({ loader: null }), /loader function/);
  const manager = new AssetManager({ loader: () => "/x.png" });
  await assert.rejects(manager.load(" "), /Asset key/);
  await assert.rejects(manager.preload("not-an-array"), /expects an array/);
});
