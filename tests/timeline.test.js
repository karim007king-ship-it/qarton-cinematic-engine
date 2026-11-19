import test from "node:test";
import assert from "node:assert/strict";
import { createTimeline } from "../src/motion/timeline.js";

test("timeline rejects self-referential object payloads", () => {
  const payload = { name: "cycle" };
  payload.self = payload;

  assert.throws(
    () => createTimeline([{ id: "cycle", atMs: 0, type: "story", payload }]),
    /cyclic references/
  );
});

test("timeline rejects cycles that pass through arrays and nested objects", () => {
  const nested = { items: [] };
  nested.items.push({ parent: nested });

  assert.throws(
    () => createTimeline([{ id: "nested-cycle", atMs: 0, type: "story", target: nested }]),
    /cyclic references/
  );

  const array = [];
  array.push(array);
  assert.throws(
    () => createTimeline([{ id: "array-cycle", atMs: 0, type: "story", payload: array }]),
    /cyclic references/
  );
});

test("timeline preserves repeated acyclic references in immutable snapshots", () => {
  const shared = { id: "hero", state: { health: 100 } };
  const timeline = createTimeline([{
    id: "shared",
    atMs: 0,
    type: "character",
    payload: { before: shared, after: shared }
  }]);

  const payload = timeline.events[0].payload;
  assert.strictEqual(payload.before, payload.after);
  assert.notStrictEqual(payload.before, shared);
  assert.equal(Object.isFrozen(payload.before), true);
  assert.equal(Object.isFrozen(payload.before.state), true);
});
