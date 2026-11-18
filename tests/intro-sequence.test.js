import test from "node:test";
import assert from "node:assert/strict";
import { createIntroSequence } from "../src/intro/intro-sequence.js";

test("intro plays the shared brand opener before the game-specific intro", async () => {
  const events = [];
  const sequence = createIntroSequence({
    playBrandIntro: async () => { events.push("brand"); },
    playGameIntro: async () => { events.push("game"); },
    onStageChange: state => events.push(state)
  });

  assert.equal(await sequence.start(), "completed");
  assert.deepEqual(events, ["brand", "brand", "game", "game", "completed"]);
  assert.equal(sequence.state, "completed");
});

test("concurrent start calls share one run and do not replay either stage", async () => {
  let brandCalls = 0;
  let gameCalls = 0;
  let releaseBrand;
  const brandGate = new Promise(resolve => { releaseBrand = resolve; });
  const sequence = createIntroSequence({
    playBrandIntro: async () => { brandCalls += 1; await brandGate; },
    playGameIntro: async () => { gameCalls += 1; }
  });

  const first = sequence.start();
  const second = sequence.start();
  assert.equal(first, second);
  releaseBrand();
  assert.equal(await first, "completed");
  assert.equal(brandCalls, 1);
  assert.equal(gameCalls, 1);
});

test("skip aborts the active stage and prevents the game intro from starting", async () => {
  let receivedSignal;
  let gameCalls = 0;
  const sequence = createIntroSequence({
    playBrandIntro: ({ signal }) => {
      receivedSignal = signal;
      return new Promise(() => {});
    },
    playGameIntro: async () => { gameCalls += 1; }
  });

  const running = sequence.start();
  await Promise.resolve();
  assert.equal(sequence.state, "brand");
  assert.equal(sequence.skip(), "skipped");
  assert.equal(await running, "skipped");
  assert.equal(receivedSignal.aborted, true);
  assert.equal(gameCalls, 0);
});

test("cancel between stages prevents the next stage", async () => {
  let gameCalls = 0;
  const sequence = createIntroSequence({
    playBrandIntro: async () => {},
    playGameIntro: async () => { gameCalls += 1; }
  });

  assert.equal(await sequence.start(), "completed");
  assert.equal(sequence.cancel(), "completed");
  assert.equal(gameCalls, 1);
});

test("stage failures are surfaced and leave the sequence failed", async () => {
  const sequence = createIntroSequence({
    playBrandIntro: async () => { throw new Error("brand asset failed"); },
    playGameIntro: async () => {}
  });

  await assert.rejects(sequence.start(), /brand asset failed/);
  assert.equal(sequence.state, "failed");
});

test("required stage adapters are validated", () => {
  assert.throws(() => createIntroSequence({}), /playBrandIntro/);
  assert.throws(() => createIntroSequence({ playBrandIntro() {} }), /playGameIntro/);
});
