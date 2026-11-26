import assert from "node:assert/strict";
import test from "node:test";
import { audioRangePcmBytes, collectAudioSourceRanges, cropAudioBuffer } from "../packages/motion-studio/export/audio-source-ranges.js";

const info = [
  { id: "shared", durationMs: 120_000, channels: 2, sampleRate: 48_000 },
  { id: "unused", durationMs: 120_000, channels: 2, sampleRate: 48_000 }
];

test("audio range planner skips muted, unused, and out-of-export clips and deduplicates shared assets", () => {
  const clips = [
    { asset: "shared", startMs: 0, endMs: 10_000, offsetMs: 20_000, volume: 1, trackVolume: 1 },
    { asset: "shared", startMs: 5_000, endMs: 15_000, offsetMs: 20_000, volume: 1, trackVolume: 1 },
    { asset: "unused", startMs: 0, endMs: 4_000, volume: 1, trackVolume: 1 },
    { asset: "muted", startMs: 6_000, endMs: 9_000, volume: 0, trackVolume: 1 }
  ];
  const ranges = collectAudioSourceRanges(clips, info, { range: { startMs: 6_000, endMs: 8_000 } });
  assert.deepEqual([...ranges.keys()], ["shared"]);
  assert.deepEqual({ startMs: ranges.get("shared").startMs, endMs: ranges.get("shared").endMs },
    { startMs: 21_000, endMs: 28_000 });
  assert.equal(audioRangePcmBytes(info[0], ranges.get("shared")), 2_688_000);
});

test("cropping retains only requested frames and preserves source time offset", () => {
  const source = { length: 48_000, numberOfChannels: 1, sampleRate: 48_000, duration: 1,
    getChannelData: () => new Float32Array(48_000) };
  const created = [];
  const context = { createBuffer: (channels, length, sampleRate) => {
    const arrays = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { length, numberOfChannels: channels, sampleRate, duration: length / sampleRate,
      getChannelData: channel => arrays[channel], copyToChannel: (data, channel) => arrays[channel].set(data) };
    created.push(buffer); return buffer;
  } };
  const result = cropAudioBuffer(context, source, { id: "long", startMs: 250, endMs: 500, full: false });
  assert.equal(created.length, 1);
  assert.equal(result.buffer.length, 12_000);
  assert.equal(result.startOffsetSeconds, 0.25);
  assert.equal(result.bytes, 12_000 * 4);
});
