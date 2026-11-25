# L12-A — Motion Studio audit and mobile audio UX

## Scope and baseline

Continues PR #143 from `791f44a` on `feature/audio-core-fix-a-final`. The changes are limited to Motion Studio, its tests, preview workflow, and this report. No game source, PR #142, or `main` changes are included. Existing scene, camera, character, effect, export, audio timeline, asset library, and project migration APIs are retained.

## Findings and fixes

| Area | Finding | Change |
|---|---|---|
| Microphone permission | `getUserMedia()` had no deadline. A WebView permission request that did not settle left the record action stuck in its busy state. | Added a 30-second deadline, late-stream track shutdown, explicit timeout/permission/device messages, and busy-state recovery. |
| Audio capture startup | Motion Studio requested media without first resuming an `AudioContext`; unlike Sol B2, it had no live signal meter or elapsed-time indicator. | Resume the context from the button gesture before permission request; show elapsed time and RMS-derived level during capture; close/disconnect the meter graph on stop, failure, and page hide. |
| Secure origin | `getUserMedia` requires an allowed secure context and browser permission. A ZIP opened as `file://` may expose neither API; Android's `content://` file picker is still valid for imports. Sol B2's HTTPS success therefore does not prove a `file://` preview can capture. | Keep the explicit secure-origin check and give a direct HTTPS/WebView permission instruction when capture cannot start. This is a browser/platform boundary, not something the page can grant itself. |
| Timeline insertion | Mic recording already passed through `importStudioAudio()` and the shared asset registry before `addRecordedAudioToTimeline()`, but the UI did not make the capture path discoverable and a stuck permission prompt looked like a dead button. | Keep verification before Timeline insertion; add visible main audio actions, timer/meter, and selected-clip play/delete actions. Imports through the main buttons auto-add to Dialogue or Music. The advanced file-picker flow still stages an asset for manual placement on Dialogue/Music/SFX. |
| Duration and persistence | WebView media duration can be `Infinity` or `NaN`; project JSON intentionally stores metadata while IndexedDB stores the Blob. | Preserve `AudioBuffer.duration` after decode as the duration authority when metadata is non-finite. Save/reopen testing checks IndexedDB Blob relinking, preview signal, and exported signal. |
| Mobile complexity | Audio controls and mouth-key editing were all expanded inline. | Put track selection, manual placement, clip/master editing, and Viseme tools under a collapsed advanced drawer. Keep the three main actions and Timeline visible. QARTON colors and the fixed five-item bottom dock remain. |

## Motion Studio code reviewed

- `examples/motion-studio-lab/index.html`: action controls, hidden file input, Timeline and advanced drawer structure.
- `examples/motion-studio-lab/studio.js`: event bindings, busy/disabled state, scene locking, permission request, MediaRecorder lifecycle, asset registration, Timeline commit, preview scheduling, save/restore, and export locking.
- `examples/motion-studio-lab/studio-audio-model.js`: MIME/size validation, metadata-duration rejection, decoded-duration fallback, audio track validation.
- `examples/motion-studio-lab/studio-audio-timeline.js`: clip selection, pointer capture/cancel, DOM rendering, and focus restoration.
- `examples/motion-studio-lab/studio-sequence-runtime.js` and `studio-sequence-editor.js`: persistent asset linking and scene replacement interactions.
- `examples/motion-studio-lab/studio-export-core.js` and `studio-sequence-export.js`: recorded audio resolution, decode, mux, and cleanup.
- `examples/motion-studio-lab/studio.css`: fixed mobile workspace/dock, touch targets, drawer visibility, and audio layout.

No important control was removed. Audio, Viseme, track-volume, asset-library, scene, effect, save, and export controls remain available; detailed audio editing is collapsed by default. Asset Blob bytes remain in the shared IndexedDB registry and are not serialized as base64 into project JSON.

## Validation

- Node tests: 381 passed before L12-specific assertions; rerun on the final commit is required and will be recorded in the PR checks.
- Chromium virtual-microphone test: covers real MediaRecorder output, 660 Hz signal decode, secure-origin behavior, permission rejection, request timeout, `Infinity` and `NaN` metadata, Timeline insertion, project reload, preview playback, and audio-bearing video export.
- Android preview package is built from the single-file editor. Automated Chromium and virtual microphone coverage is not certification of HONOR 400 Pro/WebView. Retest actual capture on the phone via HTTPS and grant site/WebView microphone permission; a local `file://` ZIP cannot override the browser's secure-context policy.

## Functions intentionally retained

Manual Dialogue/Music/SFX track selection and insertion, clip movement and duration/volume edits, master volume, manual Arabic/Tunisian Visemes, local asset library, JSON compatibility with old projects, IndexedDB audio bytes, preview playback, and integrated video export remain in place. No audio codec/transcoder or L10 feature was introduced.
