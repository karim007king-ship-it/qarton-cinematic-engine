import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialIntroPlayer } from '../src/runtime/official-intro-player.js';

function fixture(playResult = Promise.resolve()) {
  const events = new Map();
  const make = tag => ({
    tag, children: [], attrs: {}, className: '', removed: false,
    appendChild(el) { this.children.push(el); },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(k, cb) { events.set(tag + ':' + k, cb); },
    remove() { this.removed = true; },
    pause() {},
    load() {},
    play() { return playResult; }
  });
  const mount = make('mount');
  const doc = { createElement: make };
  const reasons = [];
  let timeout;
  const player = createOfficialIntroPlayer({
    mount, documentRef: doc, src: '/official-intro.mp4',
    onComplete: r => reasons.push(r),
    setTimer: cb => { timeout = cb; return 1; },
    clearTimer: () => {}
  });
  return { player, events, reasons, mount, fireTimeout: () => timeout() };
}
test('video ended completes exactly once', async () => {
  const f = fixture();
  await f.player.start();
  f.events.get('video:ended')();
  f.player.skip();
  assert.deepEqual(f.reasons, ['ended']);
  assert.equal(f.player.finished, true);
});
test('skip and timeout are safe', async () => {
  const f = fixture();
  await f.player.start();
  f.fireTimeout();
  f.events.get('video:ended')();
  assert.deepEqual(f.reasons, ['timeout']);
});
test('missing asset does not block host', async () => {
  const f = fixture();
  const p = createOfficialIntroPlayer({ mount: f.mount,
    documentRef: { createElement: tag => ({ appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {}, pause() {}, load() {}, removeAttribute() {}, tag }) },
    src: '', onComplete: r => f.reasons.push(r) });
  await p.start();
  assert.deepEqual(f.reasons, ['missing']);
});
test('autoplay rejection leaves accessible manual controls', async () => {
  const f = fixture(Promise.reject(new Error('gesture required')));
  await f.player.start();
  assert.equal(f.mount.children[0].children.some(x => x.className === 'qarton-intro-play'), true);
  f.player.skip();
  assert.deepEqual(f.reasons, ['skipped']);
});
