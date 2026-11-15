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

test("adaptive monitor requires consecutive windows in the same direction", () => {
  const monitor = createAdaptivePerformanceMonitor({
    device: { quality: "medium" },
    sampleWindow: 1,
    stableWindows: 2
  });
  monitor.recordFrame(40); // low FPS: first downgrade window
  monitor.recordFrame(10); // high FPS: direction changes, counter resets
  monitor.recordFrame(40); // low FPS: first downgrade window again
  assert.equal(monitor.getProfile().tier, "medium");
  monitor.recordFrame(40); // second consecutive low window
  assert.equal(monitor.getProfile().tier, "low");
});
