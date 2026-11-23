import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  OUTPUT_SIZE,
  RECORDING_DURATIONS_MS,
  extensionForMime,
  mimeCandidates,
  measuredDurationMs,
  supportedCandidates
} from '../examples/motion-studio-export-lab/export-lab-core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const labPath = resolve(root, 'examples/motion-studio-export-lab/lab.js');

test('export lab uses the agreed portrait canvas and both requested durations', () => {
  assert.deepEqual(OUTPUT_SIZE, { width: 720, height: 1280, fps: 24 });
  assert.deepEqual(RECORDING_DURATIONS_MS, { short: 3000, extended: 10000 });
});

test('MIME candidates are deduplicated and do not assume MP4 support', () => {
  assert.ok(mimeCandidates('webm').every((mime) => mime.startsWith('video/webm')));
  assert.ok(mimeCandidates('mp4').every((mime) => mime.startsWith('video/mp4')));
  assert.equal(new Set(mimeCandidates('mp4')).size, mimeCandidates('mp4').length);
  assert.throws(() => mimeCandidates('avi'), TypeError);
});

test('reported candidates come only from a positive isTypeSupported result', () => {
  class PartialRecorder {
    static isTypeSupported(mime) { return mime === 'video/webm;codecs=vp8,opus'; }
  }
  assert.deepEqual(supportedCandidates(PartialRecorder, 'webm'), ['video/webm;codecs=vp8,opus']);
  assert.deepEqual(supportedCandidates(class { static isTypeSupported() { throw Error('probe'); } }, 'mp4'), []);
  assert.deepEqual(supportedCandidates({}, 'mp4'), []);
});

test('duration validation rejects invalid or reversed timestamps', () => {
  assert.equal(measuredDurationMs(100, 3100), 3000);
  assert.equal(measuredDurationMs(100, 10100), 10000);
  assert.equal(measuredDurationMs(5, 4), null);
  assert.equal(measuredDurationMs('bad', 10), null);
});

test('actual MIME determines the suggested file extension', () => {
  assert.equal(extensionForMime('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionForMime('video/webm;codecs=vp8,opus'), 'webm');
  assert.equal(extensionForMime(''), 'webm');
});

test('page exposes image, playback, save, format probes, and diagnostics controls', async () => {
  const html = await readFile(resolve(root, 'examples/motion-studio-export-lab/index.html'), 'utf8');
  for (const id of ['imageInput', 'probeButton', 'record3', 'record10', 'saveButton', 'playback', 'actualMime', 'fileSize', 'duration', 'errors']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
  }
  assert.match(html, /width="720" height="1280"/);
});

test('browser module parses and contains recording plus audio track capture', async () => {
  const checked = spawnSync(process.execPath, ['--check', labPath], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || 'lab module syntax failed');
  const source = await readFile(labPath, 'utf8');
  assert.match(source, /captureStream\(OUTPUT_SIZE\.fps\)/);
  assert.match(source, /createMediaStreamDestination\(\)/);
  assert.match(source, /new MediaRecorder\(stream, \{ mimeType \}\)/);
  assert.match(source, /supportedCandidates\(MediaRecorder, format\)/);
});
