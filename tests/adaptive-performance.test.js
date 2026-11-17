import test from "node:test";
import assert from "node:assert/strict";
import { createAdaptivePerformanceMonitor, createRuntimeActivityGate } from "../src/runtime/adaptive-performance.js";

test("adaptive monitor downgrades and upgrades only after stable sample windows", () => {
  const changes = [];
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "high" },
    sampleWindow: 4,
    stableWindows: 2,
    onProfileChange: (next, previous) => changes.push([previous.tier, next.tier])
  });
  for (let i = 0; i < 4; i += 1) monitor.recordFrame(40);
  assert.equal(monitor.getProfile().tier, "high");
  for (let i = 0; i < 4; i += 1) monitor.recordFrame(40);
  assert.equal(monitor.getProfile().tier, "medium");
  for (let i = 0; i < 8; i += 1) monitor.recordFrame(10);
  assert.equal(monitor.getProfile().tier, "high");
  assert.deepEqual(changes, [["high", "medium"], ["medium", "high"]]);
});

test("reduced-motion and save-data preferences lock the low profile", () => {
  const monitor = createAdaptivePerformanceMonitor({
    device: { reducedMotion: true },
    sampleWindow: 2
  });
  monitor.recordFrame(5);
  monitor.recordFrame(5);
  assert.equal(monitor.getProfile().tier, "low");
  assert.equal(monitor.getProfile().reason, "reduced-motion");
});

test("adaptive monitor validates frames and reset clears measurements", () => {
  const monitor = createAdaptivePerformanceMonitor({ sampleWindow: 2 });
  assert.throws(() => monitor.recordFrame(0), /positive/);
  monitor.recordFrame(16);
  monitor.reset({ quality: "medium" });
  assert.equal(monitor.getProfile().tier, "medium");
  assert.equal(monitor.getMetrics().pendingFrames, 0);
});

test("runtime activity gate pauses and resumes idempotently", () => {
  const events = [];
  const gate = createRuntimeActivityGate({
    onPause: () => events.push("pause"),
    onResume: () => events.push("resume")
  });
  gate.setActive(false);
  gate.setActive(false);
  gate.setActive(true);
  assert.deepEqual(events, ["pause", "resume"]);
  gate.destroy();
  assert.deepEqual(events, ["pause", "resume", "pause"]);
  assert.equal(gate.isActive(), false);
  assert.throws(() => gate.setActive(true), /destroyed/);
});


test("reset recalculates reduced-motion and save-data quality locks", () => {
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "high" },
    sampleWindow: 2,
    stableWindows: 1
  });
  monitor.reset({ reducedMotion: true });
  for (let i = 0; i < 4; i += 1) monitor.recordFrame(5);
  assert.equal(monitor.getProfile().tier, "low");
  assert.equal(monitor.getProfile().reason, "reduced-motion");

  monitor.reset({ saveData: true });
  for (let i = 0; i < 4; i += 1) monitor.recordFrame(5);
  assert.equal(monitor.getProfile().tier, "low");
});


test("adaptive hysteresis requires consecutive windows in the same direction", () => {
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "medium" },
    sampleWindow: 1,
    stableWindows: 2
  });

  monitor.recordFrame(40);
  assert.equal(monitor.getProfile().tier, "medium");
  assert.equal(monitor.getMetrics().stableWindows, 1);

  monitor.recordFrame(10);
  assert.equal(monitor.getProfile().tier, "medium");
  assert.equal(monitor.getMetrics().stableWindows, 1);

  monitor.recordFrame(40);
  assert.equal(monitor.getProfile().tier, "medium");
  assert.equal(monitor.getMetrics().stableWindows, 1);

  monitor.recordFrame(40);
  assert.equal(monitor.getProfile().tier, "low");
  assert.equal(monitor.getMetrics().stableWindows, 0);
});


test("adaptive profiles are immutable and invalid device hints are rejected", () => {
  const monitor = createAdaptivePerformanceMonitor({ device: { quality: "high" } });
  assert.equal(Object.isFrozen(monitor.getProfile()), true);
  assert.throws(() => createAdaptivePerformanceMonitor({ device: null }), /configuration/);
  assert.throws(() => monitor.reset(null), /device hints/);
});

test("activity gate retries failed pause and resume callbacks without changing state early", () => {
  const calls = [];
  let failPause = true;
  let failResume = true;
  const gate = createRuntimeActivityGate({
    onPause: () => {
      calls.push("pause");
      if (failPause) throw new Error("pause callback failed");
    },
    onResume: () => {
      calls.push("resume");
      if (failResume) throw new Error("resume callback failed");
    }
  });

  assert.throws(() => gate.setActive(false), /pause callback failed/);
  assert.equal(gate.isActive(), true);
  failPause = false;
  assert.equal(gate.setActive(false), false);
  assert.equal(gate.isActive(), false);

  assert.throws(() => gate.setActive(true), /resume callback failed/);
  assert.equal(gate.isActive(), false);
  failResume = false;
  assert.equal(gate.setActive(true), true);
  assert.equal(gate.isActive(), true);
  gate.destroy();
  assert.equal(gate.isActive(), false);
  assert.deepEqual(calls, ["pause", "pause", "resume", "resume", "pause"]);
});

test("activity gate remains closed and retries pause when destroy callback fails", () => {
  let attempts = 0;
  let fail = true;
  const gate = createRuntimeActivityGate({
    onPause: () => {
      attempts += 1;
      if (fail) throw new Error("destroy pause failed");
    }
  });

  assert.throws(() => gate.destroy(), /destroy pause failed/);
  assert.equal(gate.isActive(), false);
  assert.throws(() => gate.setActive(true), /destroyed/);
  fail = false;
  assert.doesNotThrow(() => gate.destroy());
  assert.equal(attempts, 2);
});


test("adaptive monitor retries a failed profile notification before accepting more frames", () => {
  const notifications = [];
  let fail = true;
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "high" },
    sampleWindow: 1,
    stableWindows: 1,
    onProfileChange: (next, previous) => {
      notifications.push([previous.tier, next.tier]);
      if (fail) throw new Error("host profile callback failed");
    }
  });

  assert.throws(() => monitor.recordFrame(40), /host profile callback failed/);
  assert.equal(monitor.getProfile().tier, "medium");
  assert.equal(monitor.getMetrics().pendingFrames, 0);

  fail = false;
  const result = monitor.recordFrame(20);
  assert.equal(result.evaluated, true);
  assert.deepEqual(notifications, [["high", "medium"], ["high", "medium"]]);
  assert.equal(monitor.getMetrics().pendingFrames, 0);
});


test("reset discards a failed notification from the previous measurement epoch", () => {
  const notifications = [];
  let fail = true;
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "high" },
    sampleWindow: 1,
    stableWindows: 1,
    onProfileChange: (next, previous) => {
      notifications.push([previous.tier, next.tier]);
      if (fail) throw new Error("host callback failed");
    }
  });

  assert.throws(() => monitor.recordFrame(40), /host callback failed/);
  assert.equal(monitor.getProfile().tier, "medium");

  fail = false;
  monitor.reset({ quality: "low" });
  const result = monitor.recordFrame(16);
  assert.equal(result.evaluated, true);
  assert.deepEqual(notifications, [["high", "medium"], ["low", "medium"]]);
  assert.equal(monitor.getProfile().tier, "medium");
});
