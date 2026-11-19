import test from "node:test";
import assert from "node:assert/strict";
import { createPageLifecycleAdapter } from "../src/runtime/page-lifecycle-adapter.js";
import * as rootExports from "../src/index.js";
import * as runtimeExports from "../src/runtime/index.js";
import { createPageLifecycleAdapter as packageExport } from "@qarton/cinematic-engine/runtime/page-lifecycle";

function createTarget(visibilityState = "visible") {
  const listeners = new Map();
  return {
    visibilityState,
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type });
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
    }
  };
}

test("page lifecycle adapter synchronizes the initial visible state and is idempotent", () => {
  const target = createTarget("visible");
  const events = [];
  const adapter = createPageLifecycleAdapter({ target, setActive: active => events.push(active) });

  assert.equal(adapter.start(), true);
  assert.equal(adapter.start(), false);
  assert.deepEqual(events, [true]);
  assert.deepEqual(adapter.getState(), { started: true, active: true });
  assert.equal(target.listenerCount(), 3);
});

test("hidden visibility and pagehide pause once; pageshow resumes only when visible", () => {
  const target = createTarget("visible");
  const events = [];
  const adapter = createPageLifecycleAdapter({ target, setActive: active => events.push(active) });
  adapter.start();

  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  target.dispatch("pagehide");
  target.visibilityState = "visible";
  target.dispatch("pageshow");

  assert.deepEqual(events, [true, false, true]);
});

test("pageshow keeps the host inactive when the document is still hidden", () => {
  const target = createTarget("visible");
  const events = [];
  const adapter = createPageLifecycleAdapter({ target, setActive: active => events.push(active) });
  adapter.start();

  target.dispatch("pagehide");
  target.visibilityState = "hidden";
  target.dispatch("pageshow");

  assert.deepEqual(events, [true, false]);
});

test("sync retries a failed host callback without committing stale activity state", () => {
  const target = createTarget("hidden");
  const events = [];
  let fail = true;
  const adapter = createPageLifecycleAdapter({
    target,
    setActive: active => {
      events.push(active);
      if (fail) throw new Error("host callback failed");
    }
  });

  assert.throws(() => adapter.start(), /host callback failed/);
  assert.equal(target.listenerCount(), 0);
  assert.deepEqual(adapter.getState(), { started: false, active: null });

  fail = false;
  assert.equal(adapter.sync(), true);
  assert.deepEqual(adapter.getState(), { started: false, active: false });
  assert.deepEqual(events, [false, false]);
});

test("stop removes all listeners and later lifecycle events no longer call the host", () => {
  const target = createTarget("visible");
  const events = [];
  const adapter = createPageLifecycleAdapter({ target, setActive: active => events.push(active) });
  adapter.start();

  assert.equal(adapter.stop(), true);
  assert.equal(adapter.stop(), false);
  assert.equal(target.listenerCount(), 0);
  target.visibilityState = "hidden";
  target.dispatch("visibilitychange");
  assert.deepEqual(events, [true]);
  assert.deepEqual(adapter.getState(), { started: false, active: true });
});

test("adapter validates the injected event target and activity callback", () => {
  assert.throws(() => createPageLifecycleAdapter(), /EventTarget/);
  assert.throws(() => createPageLifecycleAdapter({ target: createTarget() }), /setActive/);
  assert.throws(() => createPageLifecycleAdapter({
    target: { addEventListener() {} },
    setActive() {}
  }), /EventTarget/);
});

test("page lifecycle adapter is exported through root, runtime, and package subpath", () => {
  assert.equal(rootExports.createPageLifecycleAdapter, createPageLifecycleAdapter);
  assert.equal(runtimeExports.createPageLifecycleAdapter, createPageLifecycleAdapter);
  assert.equal(packageExport, createPageLifecycleAdapter);
});

test("startup rollback retains listeners when host removal fails so stop can retry", () => {
  const target = createTarget("hidden");
  const originalRemove = target.removeEventListener.bind(target);
  let failRollbackOnce = true;
  target.removeEventListener = (type, listener) => {
    if (failRollbackOnce && type === "pagehide") {
      failRollbackOnce = false;
      throw new Error("rollback removal blocked");
    }
    originalRemove(type, listener);
  };
  const adapter = createPageLifecycleAdapter({
    target,
    setActive: () => { throw new Error("initial lifecycle sync failed"); }
  });

  assert.throws(() => adapter.start(), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /initial lifecycle sync failed/);
    assert.match(error.errors[1].message, /rollback removal blocked/);
    return true;
  });
  assert.equal(adapter.getState().started, true,
    "partial rollback must remain tracked as an active registration");
  assert.equal(target.listenerCount(), 1);

  assert.equal(adapter.stop(), true);
  assert.equal(adapter.getState().started, false);
  assert.equal(target.listenerCount(), 0);
});

test("stop remains retryable when a host EventTarget refuses listener removal", () => {
  const target = createTarget("visible");
  const originalRemove = target.removeEventListener.bind(target);
  let failOnce = true;
  target.removeEventListener = (type, listener) => {
    if (failOnce && type === "pagehide") {
      failOnce = false;
      throw new Error("remove blocked");
    }
    originalRemove(type, listener);
  };
  const adapter = createPageLifecycleAdapter({ target, setActive() {} });
  adapter.start();

  assert.throws(() => adapter.stop(), /remove blocked/);
  assert.equal(adapter.getState().started, true);
  assert.equal(target.listenerCount(), 1);
  assert.equal(adapter.stop(), true);
  assert.equal(adapter.getState().started, false);
  assert.equal(target.listenerCount(), 0);
});


test("page lifecycle adapter listens to document visibility and window page events separately", () => {
  const documentTarget = createTarget("visible");
  const windowTarget = createTarget();
  const events = [];
  const adapter = createPageLifecycleAdapter({
    target: documentTarget,
    pageTarget: windowTarget,
    setActive: active => events.push(active)
  });
  adapter.start();
  assert.equal(documentTarget.listenerCount(), 1);
  assert.equal(windowTarget.listenerCount(), 2);

  windowTarget.dispatch("pagehide");
  windowTarget.dispatch("pageshow");
  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");

  assert.deepEqual(events, [true, false, true, false]);
  adapter.stop();
  assert.equal(documentTarget.listenerCount(), 0);
  assert.equal(windowTarget.listenerCount(), 0);
});
