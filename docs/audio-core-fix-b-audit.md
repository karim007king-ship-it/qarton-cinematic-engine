# AUDIO-CORE-FIX-B — independent audit

Reference: PR #141, commit b07f856ade5080a193d89001a58bff5136dac4b7. No changes to the editor, audio core, Luna branch or games.

## End-to-end trace

1. `examples/motion-studio-lab/studio.js` (2163–2296): gate on secure context and MediaRecorder, request audio stream, select first advertised MIME, record chunks, enforce 20 MiB/60 s, stop tracks, construct File and pass elapsed time as a hint.
2. `studio-audio-model.js` (75–119): validate size/MIME or filename extension; load metadata via HTMLAudioElement. Finite metadata duration is not equivalent to decoding the complete signal.
3. `studio.js` (342–379, 2298–2353): register asset metadata; persist Blob in IndexedDB, create object URL, store duration in localStorage, then attempt insertion into the captured scene and track (2175–2190).
4. `studio.js` (1085–1094): compile tracks and rebuild player; schedule sequence metadata autosave. Preview uses HTMLAudioElement and its play promise (1050–1073), not the Web Audio mixer.
5. `asset-storage.js`: transaction completion confirms writes; keys are [projectId, assetId]. `asset-persistence.js`: serialized operations and restore by project ID. Sequence and duration metadata live separately in localStorage (studio.js 219–255, 382–435). A JSON project is not a bundle of audio bytes.
6. `studio.js` (951–974): export resolves actual files via audioFiles; `packages/motion-studio/export/audio-mix.js` (93–196, 238 onward) decodes buffers, creates gains and stream destination, schedules against audio clock. `recording-session.js` (374–446 onward) resumes context, attaches capture stream audio/video tracks, records and handles interruption. Export and preview can therefore disagree.

## Findings, ranked

|Priority|Finding (code evidence)|Consequence / next investigation|
|---|---|---|
|High|studio.js 2312–2315 uses elapsed hint on **any** metadata failure, not only an unknown container duration.|A corrupt or unsupported recording can be registered and committed with a plausible duration. Confirm bytes, actual decode and signal separately before future acceptance logic.|
|High|2168–2218 chooses only the first advertised format. No retry if constructor/start/final decode fails.|A device may advertise WebM but fail to encode it; record requested and actual MIME, test alternate format separately.|
|High|342–379 updates sequence metadata before storage relink completes; local map is set before the awaited write; persistent and metadata writes are not one transaction.|Quota/blocked DB failure can leave an asset entry without a valid clip or recoverable bytes. Diagnose saved vs linked vs committed separately.|
|High|2175–2190 register then insert; 1085–1094 saves clip with debounce.|An insertion or immediate close can leave an unreferenced asset, or saved snapshot lagging live Timeline. Wait for save; inspect after reopening.|
|High|1050–1073 relies on HTMLAudioElement play; export uses decodeAudioData instead.|Metadata and even successful playback initiation do not prove export PCM is valid or audible. Measure decoded signal in each output; inspect final exported file.|
|Medium|229–255 duration hint persisted separately; inferred fallback uses clipped timeline duration.|It can be stale, shortened or absent; never treat a hint as measured duration.|
|Medium|2195–2296 no explicit timeout for permission or missing final onstop; pagehide only handles a created session.|Native permission prompt, lifecycle interruption or missing recorder stop event may hold UI locked. Reproduce before changing lifecycle.|
|Medium|asset registry and URL caches are origin/project dependent; storage open catches errors, in-memory fallback may appear usable.|Offline file preview and hosted origin may show different projects; compare same-origin saved state, and reopen.|
|Medium|No recording RMS/peak check or explicit track-muted test in recorder handler.|A nonempty silent file may pass; use a known signal and speak into microphone.|
|Medium|AMR not in MIME/extension allowlist; file picker name/type may reflect Android provider output.|An AMR file is not evidence that internal MediaRecorder produced AMR. Inspect actual MIME, bytes and decode error; no paid service required. |

These are source-observed gaps and conditional failure paths, not proof of the exact cause on the HONOR phone. No native Android shell/manifest exists in this repo; native permission handling must be verified in the actual host.

## Chromium versus physical Android

PR #141 describes 379 passing Node tests and virtual 660 Hz recording, preview/export PCM checks. The test script uses loopback (secure context), pre-granted microphone permission, fake device/UI, a deterministic WAV and autoplay override. Mobile viewport/UA do not emulate Android OS permission prompts, hardware microphone/audio routing, WebView bridge, encoder/decoder differences, lifecycle, or file-provider access.

- HTTPS: verify actual secure context and microphone API, site permission, OS permission and microphone availability. A local loopback test does not establish access from a different origin.
- file://: secure-context classification varies by browser and host; even where secure, permission handling and per-file storage isolation can differ. A self-contained offline preview is not proof of recording permission.
- content://: Android document-provider URI is not a normal filesystem path. Use native/system picker with granted access and consume the resulting File/Blob, not fetch arbitrary content URLs. Opening an HTML via a content provider can also change its effective origin. Compare actual scheme and origin in panel.
- WebView: host needs manifest/runtime RECORD_AUDIO and WebChromeClient.onPermissionRequest handling for RESOURCE_AUDIO_CAPTURE, granting only requested resource after checking trusted origin and user consent. JS cannot observe Android permission grant directly.
- See Android official [PermissionRequest](https://developer.android.com/reference/android/webkit/PermissionRequest) and [WebView permission handling](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/wrap-webview-in-compose).

## Independent diagnostic panel

`examples/audio-diagnostics/index.html` is self-contained; no external dependencies, edits or uploads. Open it over the same HTTPS origin as Studio (or compare with the extracted local file if relevant).

1. Check environment and permission state; select synthetic recording (660 Hz, amplitude .25, 5 seconds) through MediaStreamDestination and the same MIME selection as mic. Measure decoded duration, RMS and peak (linear full-scale units, across all channels).
2. Record a spoken sentence using microphone; compare track state, codec, bytes, measured duration and signal. Playback is a separate user-initiated test; error events are logged.
3. Open a phone audio file or exported video with system picker. DecodeAudioData may reject video containers on some browsers; that is a probe limitation, not conclusive proof of no audio. Listen to playable sample separately.
4. Save Studio project, wait for autosave, open panel on same origin and click project check. Reads localStorage metadata and IndexedDB in readonly mode; never creates a DB if absent. Shows committed saved clips, gains, expected/stored bytes, missing links and duration hints. Inspect any linked asset individually. Not a live in-memory Timeline or direct instrumentation of Studio's playback/export context.
5. Download JSON report (no sample audio bytes, no device IDs). Audio sample download is separate. Repeat in Chrome and actual WebView; include OS/WebView versions and whether the URL was HTTPS, file or content.

Interpretation: synthetic fails -> context/encoder/decoder path; synthetic passes + mic fails -> permission/device/capture path; both pass + missing clip/asset -> editor insertion or persistence; playable mic asset + silent video -> export pipeline or gain/timing. The panel does not repair or assert a physical Android pass.
