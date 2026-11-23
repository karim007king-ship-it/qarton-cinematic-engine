# QARTON Cinematic Audio & Lip-Sync Core Lab

This standalone experiment demonstrates the L8-A audio core with dialogue, music, SFX, per-track/master volume, and manually authored Arabic viseme/phoneme timing. The oscillator-based sound is original test audio, not speech. The engine does not recognize speech or generate phoneme timings automatically.

## Open the Android preview

1. Open the Draft PR's **Cinematic Audio Android preview** Actions run and download the `cinematic-audio-l8a-android-preview` artifact ZIP.
2. Extract it in Android Files and open `index.html` with Chrome. The bundled page has no external modules/assets, so it can run from `file://`; the workflow also checks it in Chromium.
3. Tap **تشغيل** once to unlock Web Audio. Try Play, Pause, Replay, scrub to 0.8 seconds, and adjust each track volume. Try seeking repeatedly to the same time; the same viseme should appear each time.

The experiment runs without microphone access, network audio, or external assets. The audio is a synthetic tone to exercise track timing and lifecycle; it does not speak Arabic words. The visible Arabic line is sample dialogue with prepared cues.

## API and integration contract

`compileCinematicAudioProject({ durationMs, tracks })` validates and freezes `dialogue`, `music`, and `sfx` track data and compiles absolute-time events using the shared `createTimeline`. Dialogue clips require `language: "ar"` (Arabic) or `language: "tn"` (Tunisian Arabic) and optional authored `visemes: [{ atMs, phoneme, viseme }]`, where cue times are relative to the clip. Viseme sampling is deterministic at an absolute scene time.

`createCinematicAudioPlayer(compiled, adapter)` uses the shared `createSceneClock`. Hosts call `play`, `pause`, `resume`, `seek`, `replay`, and `tick`; adapters own audio decoding/playback and resource release. `play(asset, options)` receives a scene-relative `offsetMs`, type/channel and effective volume. Seeking while playing stops and reopens active clips at the new offset; seeking while paused only samples metadata. The API does not own a character renderer.

The existing `createAudioCueController` remains unchanged: it is designed for monotonic one-shot cues, while this player must resume sustained clips at an offset after a backward/forward seek. The new transport therefore reuses the shared Scene Clock and Timeline ordering but owns the duration-clip reconciliation needed for seek and replay.

## Unmerged integrations

- PR #116 supplies the visual camera Timeline and shared scene preview clock, but remains a separate Draft branch.
- PR #117 supplies deterministic character animation, including mouth channels; L8-A emits `dialogue[].viseme`, `phoneme`, `language`, and `mouthOpen` for a future adapter into that character pose API. This branch does not import L7-A code because it is not in `main`.
- PR #118 integrates L7-B Character Track editing on a branch stacked on the unmerged L6-B/L7-A work. L8-A does not alter or depend on those branches.

After these features land, an integration change can drive camera sampling, audio playback and character `mouthOpen`/expression samples from the same scene time. This PR only adds the reusable audio core and isolated lab.

## Compatibility and limits

The core is platform-neutral ES modules and requires the host to inject playback adapters; the repository also has a reusable HTMLAudio adapter. This lab specifically uses `AudioContext`; Chrome and current Android System WebView are the target, but actual Web Audio availability, autoplay gesture behavior and audible output must be checked on device. Cue timing is deterministic relative to the scene clock; physical output latency and device audio scheduling vary. Arabic/Tunisian viseme timing is supplied by authored metadata; there is no automatic speech recognition, phoneme extraction, or speech synthesis.
