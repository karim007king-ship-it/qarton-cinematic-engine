import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { makeProject, makeProjectFile, parseProjectFile } from "../examples/motion-studio-lab/studio-model.js";
import { createCinematicAudioPlayer } from "../src/audio/cinematic-audio-core.js";
import {
  AUDIO_MAX_FILE_BYTES, addAudioClip, compileAudioTracks, deleteAudioClip, editAudioClip,
  makeAudioAssetMetadata, makeAudioTracks, readAudioDuration, setAudioTrackVolume, setAudioViseme, validateAudioFile
} from "../examples/motion-studio-lab/studio-audio-model.js";

const audioAsset = { id: "asset-voice-1", name: "dialogue.wav", type: "audio/wav", size: 2048 };

test("audio clips add, move, resize, select by id, delete, and preserve independent tracks", () => {
  const tracks = makeAudioTracks();
  const dialogue = tracks.find(({ type }) => type === "dialogue");
  const withClip = addAudioClip(tracks, 12000, dialogue.id, {
    id: "clip-1", asset: audioAsset.id, name: audioAsset.name, startMs: 1000, durationMs: 2000,
    language: "tn", visemes: [], volume: 0.8
  });
  assert.equal(withClip.find(({ id }) => id === dialogue.id).clips[0].startMs, 1000);
  const moved = editAudioClip(withClip, 12000, dialogue.id, "clip-1", { startMs: 3500, durationMs: 4000 });
  assert.deepEqual([moved[0].clips[0].startMs, moved[0].clips[0].durationMs], [3500, 4000]);
  const quieter = setAudioTrackVolume(moved, 12000, dialogue.id, 0.4);
  assert.equal(quieter[0].volume, 0.4);
  const deleted = deleteAudioClip(quieter, 12000, dialogue.id, "clip-1");
  assert.equal(deleted[0].clips.length, 0);
  assert.deepEqual(deleted.map(({ type }) => type), ["dialogue", "music", "sfx"]);
  assert.throws(() => editAudioClip(withClip, 12000, dialogue.id, "missing", { startMs: 0 }), /لم يتم العثور/);
  assert.throws(() => editAudioClip(withClip, 12000, dialogue.id, "clip-1", { startMs: 11000 }), /fit inside the scene duration/);
});

test("manual Arabic and Tunisian visemes are ordered and sampled against scene time", () => {
  const dialogue = makeAudioTracks()[0];
  let tracks = addAudioClip(makeAudioTracks(), 12000, dialogue.id, {
    id: "talk", asset: audioAsset.id, startMs: 2000, durationMs: 5000, language: "ar", visemes: []
  });
  tracks = setAudioViseme(tracks, 12000, dialogue.id, "talk", 2500, "wide", "مَ");
  tracks = setAudioViseme(tracks, 12000, dialogue.id, "talk", 500, "round", "و");
  const compiled = compileAudioTracks(tracks, 12000);
  assert.deepEqual(compiled.tracks[0].clips[0].visemes.map(({ atMs }) => atMs), [500, 2500]);
  assert.equal(compiled.sample(4600).dialogue[0].viseme, "wide");
  assert.equal(compiled.sample(4600).dialogue[0].mouthOpen, 1);
  assert.equal(compiled.sample(7000).dialogue.length, 0);
  assert.throws(() => setAudioViseme(tracks, 12000, dialogue.id, "talk", 5000, "wide"), /داخل مدة الحوار/);
  assert.throws(() => setAudioViseme(tracks, 12000, dialogue.id, "talk", 3000, "auto"), /viseme/);
});

test("editor audio player shares scene time with deterministic dialogue mouth sampling and adapter retry", () => {
  const tracks = addAudioClip(makeAudioTracks(), 12000, "audio-dialogue", {
    id: "talk", asset: audioAsset.id, startMs: 1000, durationMs: 4000, language: "ar",
    visemes: [{ atMs: 300, viseme: "open" }]
  });
  const compiled = compileAudioTracks(tracks, 12000);
  let now = 0;
  let rejectNext = true;
  const stopped = [];
  const player = createCinematicAudioPlayer(compiled, {
    now: () => now,
    play: (asset, options) => {
      if (rejectNext) { rejectNext = false; throw new Error("adapter start failed"); }
      return { asset, options };
    },
    stop: (voice) => stopped.push(voice), setVolume() {}
  });
  player.play();
  now = 1000;
  assert.throws(() => player.tick(), /adapter start failed/);
  assert.equal(player.state, "paused");
  assert.equal(player.timeMs, 0, "failed clip start rolls back the shared scene clock to the last stable sample");
  assert.equal(player.activeVoiceCount, 0);
  player.recover();
  player.seek(1300);
  const sample = player.play();
  assert.equal(sample.timeMs, 1300);
  assert.equal(sample.dialogue[0].mouthOpen, 1);
  assert.equal(player.activeVoiceCount, 1);
  const paused = player.pause();
  assert.equal(paused.timeMs, 1300);
  assert.equal(player.activeVoiceCount, 0);
  assert.equal(stopped.length, 1);
  player.destroy();
});

test("audio file import validates MIME, known extensions, nonzero size and Android memory cap", () => {
  assert.equal(validateAudioFile({ name: "voice.mp3", type: "", size: 256 }).mime, "audio/mpeg");
  assert.equal(validateAudioFile({ name: "voice.m4a", type: "audio/mp4", size: 256 }).size, 256);
  assert.equal(AUDIO_MAX_FILE_BYTES, 20 * 1024 * 1024);
  assert.throws(() => validateAudioFile({ name: "voice.exe", type: "application/octet-stream", size: 256 }), /صيغة الصوت/);
  assert.throws(() => validateAudioFile({ name: "voice.wav", type: "audio/wav", size: AUDIO_MAX_FILE_BYTES + 1 }), /20 MiB/);
  assert.throws(() => validateAudioFile({ name: "empty.wav", type: "audio/wav", size: 0 }), /20 MiB/);
  assert.deepEqual(makeAudioAssetMetadata("asset-1", { name: "voice.wav", type: "audio/wav", size: 100 }),
    { id: "asset-1", name: "voice.wav", type: "audio/wav", size: 100 });
});

test("Android HONOR 400 Pro metadata Infinity falls back to decoded AudioBuffer duration", async () => {
  const observed = { permission: "granted", recorder: "successful", mime: "audio/webm;codecs=opus",
    elapsedMs: 5002, decodedDurationMs: 4920, size: 78052, rms: 0.0494319, peak: 0.4921764, sampleRate: 48000,
    mediaMetadataDuration: Infinity };
  let decodedBytes = 0;
  let closed = false;
  class AndroidAudioMetadata {
    duration = observed.mediaMetadataDuration;
    listeners = new Map();
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    set src(value) { this.url = value; queueMicrotask(() => this.listeners.get("loadedmetadata")?.()); }
    removeAttribute() {}
    load() {}
  }
  class DecodingAudioContext {
    async decodeAudioData(bytes) { decodedBytes = bytes.byteLength; return { duration: observed.decodedDurationMs / 1000 }; }
    async close() { closed = true; }
  }
  const file = new Blob([new Uint8Array(observed.size)], { type: observed.mime });
  file.name = "recording.webm";
  assert.equal(await readAudioDuration(file, { AudioClass: AndroidAudioMetadata, AudioContextClass: DecodingAudioContext }), 4920);
  assert.equal(decodedBytes, 78052, "the actual recorder Blob is decoded before its duration is accepted");
  assert.equal(closed, true, "temporary decoder context is released");
  assert.equal(observed.rms, 0.0494319);
  assert.equal(observed.peak, 0.4921764);
  assert.equal(observed.sampleRate, 48000);
});

test("invalid or non-finite media duration never becomes zero or the elapsed capture hint", async () => {
  for (const metadataDuration of [Infinity, NaN]) {
    class BadMetadataAudio extends Object {
      duration = metadataDuration;
      listeners = new Map();
      addEventListener(name, callback) { this.listeners.set(name, callback); }
      removeEventListener(name) { this.listeners.delete(name); }
      set src(value) { queueMicrotask(() => this.listeners.get("loadedmetadata")?.()); }
      removeAttribute() {}
      load() {}
    }
    class InvalidDecoder { async decodeAudioData() { throw new Error("invalid audio bytes"); } async close() {} }
    const file = new Blob(["audio"], { type: "audio/webm" });
    file.name = "recording.webm";
    await assert.rejects(readAudioDuration(file, { AudioClass: BadMetadataAudio, AudioContextClass: InvalidDecoder }), /تعذر فك ترميز/);
  }
});

test("JSON stores only audio metadata and tracks and old L4/L5 envelopes default to empty audio", () => {
  const project = makeProject({ durationMs: 12000, startZoom: 1, endZoom: 1.2, startX: 0, endX: 0, startY: 0, endY: 0 });
  let tracks = makeAudioTracks();
  tracks = addAudioClip(tracks, project.durationMs, tracks[0].id, {
    id: "clip-1", asset: audioAsset.id, name: audioAsset.name, startMs: 500, durationMs: 1800,
    language: "tn", visemes: [{ atMs: 100, viseme: "closed" }]
  });
  const value = makeProjectFile(project, null, { aspectPreset: "original", fitMode: "fit" }, null, tracks, [audioAsset], 0.6);
  const encoded = JSON.stringify(value);
  assert.doesNotMatch(encoded, /data:audio|base64/);
  const restored = parseProjectFile(encoded);
  assert.deepEqual(restored.audioTracks, tracks);
  assert.deepEqual(restored.audioAssets, [audioAsset]);
  assert.equal(restored.audioMasterVolume, 0.6);
  const oldProject = makeProjectFile(project);
  assert.deepEqual(parseProjectFile(JSON.stringify(oldProject)).audioTracks, []);
  const malformed = { ...value, audioTracks: tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, asset: "missing" })) })) };
  assert.throws(() => parseProjectFile(JSON.stringify(malformed)), /بيانات وصفية/);
});

test("phone audio UI exposes three lanes, clip editing, manual visemes, and shared scene controls", async () => {
  const html = await readFile(new URL("../examples/motion-studio-lab/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../examples/motion-studio-lab/studio.js", import.meta.url), "utf8");
  const module = await readFile(new URL("../examples/motion-studio-lab/studio-audio-timeline.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../examples/motion-studio-lab/studio-scene-renderer.js", import.meta.url), "utf8");
  for (const id of ["microphoneButtonHost", "quickImportAudio", "quickAddMusic", "microphoneRecordingStatus", "microphoneElapsed", "microphoneLevel", "playSelectedAudio", "deleteSelectedAudio"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(js, /microphoneButton\.id = "quickRecordAudio"/);
  assert.match(html, /<details class="advanced-audio-drawer">/);
  assert.match(js, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(js, /انتهت مهلة طلب الميكروفون/);
  assert.match(js, /await meterContext\.resume\(\)/);
  assert.match(js, /getFloatTimeDomainData\(samples\)/);
  assert.match(js, /audioImportIntent = \{ autoInsert: true, trackType: "music" \}/);
  assert.match(js, /addRecordedAudioToTimeline\(imported, session\.capture\)/);
  for (const id of ["audioInput", "audioTrackType", "addAudioClip", "deleteAudioClip", "audioClipStart", "audioClipDuration", "audioClipVolume", "audioMasterVolume", "dialogueLanguage", "visemeType", "addViseme", "audioTracks"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(js, /createCinematicAudioPlayer/);
  assert.match(js, /audioPlayer\.tick\(\)/);
  assert.match(js, /const durationMs = await readAudioDuration\(file\)/);
  assert.doesNotMatch(js, /durationHintMs|recorded: true/, "capture elapsed time must not substitute for a verified media duration");
  assert.match(js, /drawStudioScene/);
  assert.match(renderer, /audioSample\?\.dialogue/);
  assert.match(renderer, /characterAnimation\.sample\(timeMs\)/);
  assert.match(js, /audioTimeline\?\.setBusy\(busy\)/);
  assert.match(module, /pointercancel/);
  assert.match(module, /lostpointercapture/);
  assert.match(module, /setPointerCapture/);
  assert.match(module, /root\.dataset\.dragging = "true"/);
  assert.match(module, /render\(\{ focusClipId: clip\.id \}\)/);
  assert.match(module, /focusedClip\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(module, /onDragEnd\?\.\(\{ cancelled: true \}\)/);
});
