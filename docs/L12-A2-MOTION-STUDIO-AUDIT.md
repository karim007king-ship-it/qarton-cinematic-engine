# L12-A2 — Motion Studio audit and microphone reliability

Baseline: PR #143, commit `12d5007` (`feature/audio-core-fix-a-final`).

This update completes the reliability and workflow review of the existing Motion Studio audio paths. It does not add an audio engine feature or begin L10.

## Findings and changes

| Area | Finding | Change / outcome |
| --- | --- | --- |
| Microphone startup | Waiting for `AudioContext.resume()` before requesting media can hang before the browser permission prompt. | Request the microphone first with an independent deadline and abort signal. The optional RMS meter starts after capture and has its own bounded resume; meter failure leaves recording active. |
| Decode and cleanup | A decoder that never settles can retain import resources; context close may also stall. | Bound decode and close separately, clear timers, release the temporary context, reject invalid media, and report decode timeout. |
| Lifecycle | Leaving or backgrounding while permission is pending or capture active can leave late tracks/recorder state. | `pagehide` aborts the pending request, stops late or active tracks, invalidates the capture, tears down the meter and preview, cancels import intent, and revokes object URLs. `pageshow` restores bfcache state. |
| Timeline playback | Selected clip could only be heard as part of scene playback. | A selected clip can play/stop in isolation without moving the scene clock; its audio object is stopped and released on scene playback, deletion, end, or pagehide. |
| Import target | Android's native picker suspends the page; selection and current time could change before a file returns. | Scene, track, type, insertion time, and insert policy are captured before the chooser opens. Pending picker/import state locks conflicting edit, save, and export actions. |
| Concurrent work | Capture/import could overlap save or export and produce inconsistent project state. | Shared busy-state guards disable conflicting project actions for the full pending operation. |
| Diagnostics | Silent device differences were hard to report. | Motion Studio includes a copyable report for secure context, permission/API/MIME support, recorder result, duration, bytes, RMS/peak/sample rate, asset persistence, timeline clips, and last error. |
| Mobile workflow | Audio entry points were crowded. | Three primary actions remain: record, import audio, add music. Detailed controls remain under Advanced. Existing simplified mode stays the default; scene, camera, character, motion, effect, save, and export capabilities are retained. |

## Function and test matrix

| Function / risk | Automated coverage | Result |
| --- | --- | --- |
| Permission request and failure/timeout | Chromium microphone flow: permission denied, unanswered request timeout, late permission after pagehide | **Passed** |
| Android-like WebM/Opus and invalid metadata | Virtual mic flow with `Infinity` and `NaN`; use decoded `AudioBuffer.duration` after decode | **Passed** |
| Meter failure isolation | Hanging `AudioContext.resume()` while capture continues and clip is inserted | **Passed** |
| Timeline insertion and stable import target | Chromium quick import, seek during picker, frozen time/scene/track assertion | **Passed** |
| Selected clip isolated playback | Playback toggle, ensure scene clock remains unchanged | **Passed** |
| Save/reopen and asset storage | Existing IndexedDB persistence and reload flow | **Passed** (microphone/import Chromium flows) |
| Preview and export audio | Virtual microphone signal measurement after preview and exported WebM decode | **Passed** |
| Copyable in-app diagnostics | Browser clipboard/report assertions and report fields | **Passed** |
| Main project regression suite | `npm test` | **383 passed, 0 failed, 0 skipped** (local) |
| Compact Android viewport and touch | Chromium mobile viewport and touch actions | **Passed** |
| Build / offline ZIP | Single-file preview build; ZIP contains HTML, README and SHA256 manifest | **Passed** |

GitHub Actions run `45707676291` passed the preview, actual Chromium flows, and ZIP packaging. Engine foundation tests passed with **383 / 383**, and QARTON Test Lab passed. Audio run `45707676386` passed long MP3 import/reopen/export plus virtual microphone capture, permission/pagehide, `Infinity`/`NaN`, timeline insertion, preview, and exported-signal tests. Artifact `motion-studio-l12-a2-android-preview` is attached to run `45707676291`, digest `sha256:672883e8011d52267e865ca73695241f18bd86ba0a2bf786de6a4adc17d956df`.

The PR-event attempt to deploy a live Pages route was rejected by GitHub's `github-pages` environment rule because its ref was `refs/pull/143/merge`. The workflow now requests publication only from a direct push of the dedicated feature branch; that deployment outcome is tracked separately from the passing ZIP and test results.

Chromium simulations validate browser behavior but do not prove the microphone works on a physical Android device. A new HONOR 400 Pro recording test remains required. `file://` microphone access is subject to WebView secure-origin and permission policy; use HTTPS or an appropriately configured app WebView for device verification.

## Changed file inventory

- `.github/workflows/motion-studio-preview.yml` — includes PR-head L12-A2 route publication after checks and checksummed preview packaging.
- `examples/motion-studio-lab/index.html` — audio diagnostics panel.
- `examples/motion-studio-lab/studio-audio-model.js` — bounded decode and context cleanup.
- `examples/motion-studio-lab/studio.css` — diagnostics panel styling.
- `examples/motion-studio-lab/studio.js` — microphone lifecycle, isolated clip playback, stable imports, concurrency guards, diagnostics.
- `scripts/check-motion-studio-audio-import.py` — import target and isolated playback browser checks.
- `scripts/check-motion-studio-microphone-recording.py` — delayed permission, meter failure, diagnostic, save/preview/export audio checks.
- `tests/motion-studio-audio-timeline.test.js` — source/workflow regression assertions.
- `docs/L12-A2-MOTION-STUDIO-AUDIT.md` — this audit and test matrix.

## Scope and compatibility

No games, PR #142, or `main` source files are modified. PR #143 remains Draft. The existing project format and older projects are preserved; these changes keep audio workflow state outside saved project schema except for the established clip/asset records. No merge is performed.
