import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { timelineTimeAtClientX } from "../examples/motion-studio-lab/studio-timeline.js";

const root = resolve(import.meta.dirname, "..");

test("Timeline pointer mapping clamps to project boundaries and remains stable at an empty width", () => {
  const rect = { left: 100, width: 400 };
  assert.equal(timelineTimeAtClientX(100, rect, 12000), 0);
  assert.equal(timelineTimeAtClientX(300, rect, 12000), 6000);
  assert.equal(timelineTimeAtClientX(500, rect, 12000), 12000);
  assert.equal(timelineTimeAtClientX(-20, rect, 12000), 0);
  assert.equal(timelineTimeAtClientX(900, rect, 12000), 12000);
  assert.equal(timelineTimeAtClientX(200, { left: 100, width: 0 }, 12000), 0);
  assert.throws(() => timelineTimeAtClientX(Number.NaN, rect, 12000), TypeError);
  assert.throws(() => timelineTimeAtClientX(100, rect, 0), TypeError);
});

test("Timeline drag lifecycle guards repeated commits, cancellation, collisions, export lock and keyboard focus", async () => {
  const source = await readFile(resolve(root, "examples/motion-studio-lab/studio-timeline.js"), "utf8");
  assert.match(source, /lastCommittedMs/);
  assert.match(source, /toMs === drag\.lastCommittedMs/);
  assert.match(source, /moveCameraKeyframe\(drag\.sourceProject, drag\.fromMs, toMs\)/);
  assert.match(source, /pointercancel/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /if \(busy \|\| isBusy\(\)\) \{\s*finishPointer\(event, true\)/);
  assert.match(source, /if \(busy\) \{\s*drag = null;/);
  assert.match(source, /markers\.querySelector\([\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /marker\.addEventListener\("click", \(\) => select\(frame\.atMs/);
});
