# QARTON Motion Studio Lab (L8-B)

An Android-first Motion Studio editor built around the `StudioProjectV1` core. It imports `compileProject`, `sampleFrame`, and `drawFrame` from `@qarton/cinematic-engine/motion-studio` and reuses the L8-A `compileCinematicAudioProject` / `createCinematicAudioPlayer` APIs. The existing camera and character tracks remain intact; audio timing now drives their shared scene time while audio clips and manual dialogue Visemes are edited in their own lanes.

## Try it on Android

1. For this Draft PR, download the `motion-studio-l9b-android-preview` artifact from the latest successful **Motion Studio Android preview** Actions run for this PR, extract it in Android Files, and open its single `index.html` with Chrome. That generated file bundles its CSS and JavaScript and is designed for `file://`; do not open the repository's regular multi-file `examples/motion-studio-lab/index.html` from `file://`, because it uses ES modules and an import map. The artifact is separate from the official Pages deployment and expires after 30 days.
2. In Chrome on Android, tap **اختر صورة من الهاتف** and select a local JPG, PNG, WebP, AVIF, or GIF. Image bytes stay in the browser; the lab makes a safe preview surface matching the selected aspect ratio.
3. Set a duration from 3 to 60 seconds and choose the image aspect and Fit/Fill mode. The Timeline below the preview has a time ruler, playhead, and one diamond per camera key. Tap the ruler lane to seek; tap **＋ مفتاح عند المؤشر** to add a key at that time; tap a diamond to select it; drag a diamond horizontally to move it; edit its X, Y, Zoom, or Rotation fields; use **حذف المفتاح المحدد** to remove only that key.
4. Use Play/Pause and Replay to check playback. The Canvas samples the same compiled project at absolute timestamps; repeated seeks to the same time are deterministic. Legacy start/end sliders remain available and update only their respective endpoint value without dropping intermediate keys.
5. **حفظ JSON** downloads project metadata. To reopen it, choose the JSON file with **فتح JSON**, then select the source image again. The JSON never embeds image bytes.
6. In **تصدير الفيديو**, choose MP4 or WebM, a duration (project length, 3, 10, 30, or 60 seconds), and a quality. The lab probes `MediaRecorder.isTypeSupported()` and defaults to MP4 when a supported MP4 MIME is reported, otherwise WebM. The browser can still reject recorder creation or produce a different actual MIME; if MP4 start fails while WebM is available, tap **جرّب WebM بدل MP4**. The result metadata and filename use the MIME reported by the finished recorder.
7. Optionally enable the synchronized test pulses. Start export and keep the tab open and foregrounded until it finishes. Preview the result, then tap the save link and choose a location in Android's download/file flow.

## L9-B Visual Effects Timeline

- Seven touch-editable lanes are available: Fade, Dissolve, Vignette, Letterbox, Shake, Flash, and Tint. Add at the scene playhead, tap a clip to select it, drag horizontally to move it, then edit start, duration, easing, and strict `from`/`to` channels. Delete removes only the selected clip.
- Camera, character, audio, visual effects preview, and export frames sample the same absolute scene time. Playback remains driven by the existing audio-backed Studio clock; effects do not introduce a second clock. Dialogue Viseme cues drive the character mouth in preview and export at the same scene timestamp. Seek and replay produce the same sample for the same timestamp and seed.
- Effects are serialized under optional `visualEffectsTrack` in the existing version-1 JSON envelope. Old projects load with an empty default track; an empty default track is omitted when saving. Unknown effect fields and invalid/fractional clip boundaries or seeds are rejected.
- Export uses the existing L5 recorder and scheduling unchanged. The Studio frame compositor samples and draws L9 effects into each Canvas 2D frame; the export scheduling/core module is not modified. Audio timeline tracks still are not muxed into exported video.
- Timeline clips use stable-root Pointer Capture. A successful drag commits once on release; Escape, pointercancel, lost capture, page focus loss, and export locking cancel the pending move and restore its original start time. Pointer motion updates only the dragged clip's position in requestAnimationFrame, without recompiling the effect track or rebuilding lane DOM on each event. Dynamic value controls and clip selection are disabled during export.
- Effect duration controls interpolation time; the final value persists after the clip ends. For Fade, Dissolve, Vignette, Letterbox, Flash, and Tint, the latest-started clip takes priority even when its value is lower or zero. Equal start times are resolved by clip-list order, with the later entry winning. A zero-duration clip steps to its final value at its start. Shake clips add together; their pixel offsets scale with the canvas short edge while rotation stays constant in degrees.
- Numeric effect fields reject blank, malformed, or out-of-range values. From/To edits keep their existing input nodes and keyboard focus while the scene recompiles.
- Camera translations are scaled with the raster viewport for preview and export; zoom and rotation stay unchanged. This keeps camera and character framing consistent when export resolution differs from the source project.
- Rendering uses Canvas 2D and no offscreen effect buffers or WebGL. The preview surface is capped at 921,600 pixels (about 3.52 MiB for one RGBA backing surface); export surfaces are capped at 921,600 pixels for Standard/High and 307,200 pixels for Economy (about 3.52 MiB / 1.17 MiB per RGBA surface). Browser compositing and recorder buffers require additional device memory. Dissolve is bounded to 144 reveal cells per sample; vignette uses one radial gradient. On low-memory phones, prefer Economy and short exports, then test the actual WebView/Chrome build.

The sample image `preview-test.png` is used only by automated browser checks. Mouth movement uses authored animation keys or dialogue Viseme cues; automatic speech recognition and automatic lip sync are outside this lab.

## L8-B audio and dialogue timeline

- The audio Timeline has Dialogue, Music, and SFX lanes. Import a local MP3, M4A/AAC, WAV, OGG, or WebM file up to 20 MiB. The browser must be able to read valid metadata and duration (at most one hour); imported bytes stay local.
- Add clips at the playhead, select and drag them, edit start/duration and clip/track/master volume. Clips must fit inside the project length. Lost pointer capture and cancelled drags keep the last valid committed position; export locks editing.
- Dialogue clips can use `ar` (Modern Standard Arabic) or `tn` (Tunisian). Add manual `rest`, `open`, `wide`, `round`, `closed`, or `teeth` Viseme cues at the playhead, with an optional short phoneme label. This is authored timing data, not automatic speech recognition or automatic lip-sync.
- JSON stores tracks, cues, language, volumes and audio asset metadata, never audio bytes. After reopening, choose each linked local file again. Filename, MIME type and size reconnect it to its saved `assetId`; if those differ, it remains unlinked until corrected.
- The existing L5 video export flow remains unchanged and does not mix the audio tracks into exported video. Authored dialogue Viseme cues still drive exported character mouth poses from scene time. Automatic speech recognition and audio-to-video muxing remain separate work. Browser media-element scheduling is not sample-accurate and varies across Android devices.

## Editor module boundaries

- `studio.js` wires project/image state, Canvas preview, shared playback time, effects overlays, and the existing L5 export flow.
- `studio-timeline.js` owns Timeline rendering, selection, touch/pointer lifecycle, keyboard focus restoration, and keyframe edits through the L6-A APIs. It receives the active project, compiled sample, seek, and commit operations through callbacks; it does not implement camera interpolation or export logic.
- `studio-model.js` validates project/JSON updates transactionally; `studio-export-core.js` retains the existing L5 export scheduling and recorder helpers.
- `studio-audio-model.js` validates immutable clip/Viseme edits and local file limits; `studio-audio-timeline.js` owns audio lane rendering, selection, dragging, capture loss, and export locking. Audio sampling, scene clock, adapter cleanup and recovery come from the L8-A core.
- `studio-visual-effects-model.js` adapts `CinematicEffectsV1` to the project viewport and strict editor clip schema; `studio-visual-effects-timeline.js` owns touch lanes, selection, capture cancellation, and drag updates. Sampling and Canvas 2D overlay drawing reuse the effects core; project time stays in the existing Studio host.

## Project and preview dimensions

- The aspect menu offers Original, 1:1, 9:16, 16:9, 4:5, 4:3, and 3:4. Original uses the selected image's aspect ratio; its project viewport is normalized to a maximum long edge of 1,920 px. The other presets use 1,080–1,920 px project dimensions.
- The project viewport is the saved project/output target. The on-device preview Canvas is calculated separately, with a maximum edge of 1,280 px and a 921,600-pixel budget. The core schema still validates the project viewport at no more than 4,096 px per edge and 8,388,608 pixels.
- Fit shows the full image with letterboxing when needed; Fill covers the frame and crops the sides or top/bottom. New projects default to Original + Fit.
- Version 1 JSON files made before L4 remain supported. They keep their saved viewport and open with Fit; the preset menu infers a standard ratio when it matches one.

## Resource and format bounds

- Project frame rate remains 24 fps; duration is 3,000–60,000 ms.
- Input file is limited to 20 MiB. The lab asks the browser decoder for progressively smaller widths (starting at 1,280 px) and keeps a temporary decoded bitmap below 2,048 px per side and 2,621,440 pixels before drawing it into the safe preview surface. Oversized intermediate bitmaps are closed before retrying; the source `File` is never rewritten or embedded in JSON.
- When the browser decoder honors `createImageBitmap` resize options, it returns a smaller bitmap before the lab creates its preview. If a decoder ignores the requested resize or cannot decode the file safely, the lab reports a decode/memory error instead of drawing an oversized bitmap. Decoder behavior varies by image format and WebView version, so very unusual panoramas may be rejected.
- JSON files are capped at 128 KiB and use a separate `qarton-motion-studio-project` envelope around `StudioProjectV1` metadata. A saved project references an opaque asset ID and records only the source name/type/size; reselect the source file after import.
- The browser owns a single preview surface and one image surface. Decode, Canvas allocation, schema, and memory-related errors are shown in the page.
- This PR targets `main` after L6-A PR #115 was squash-merged. It reuses the integrated S2-B core; PRs #107 and #108 and all games remain unchanged.

## Video export bounds and testing

- Export calls the existing `compileProject`, `sampleFrame`, and `drawFrame` API with the currently linked image surface, camera tracks, project viewport, and current Fit/Fill-composed pixels. It does not implement a second camera or timeline engine. Export time maps linearly across the project's complete timeline for the chosen output duration.
- Economy output is capped at 640 px on the long edge and 307,200 pixels; Standard and High are capped at 1,280 px and 921,600 pixels. Frame rate remains the project rate (24 fps). Standard is selected by default. Estimated and actual output are limited to 24 MiB; choose a shorter duration or lower quality if the guard rejects a recording.
- High uses a higher bitrate than Standard, with the same pixel cap. Actual codecs, encoder availability, frame pacing, audio muxing, and save behavior depend on the device/browser. A successful probe is not a guarantee that a recording will start or play on every Android build. No server upload is used.
- Only one recording can run at once. Timeline and project controls are disabled during recording; changing project/image/display settings through the existing programmatic paths aborts the recording and releases Canvas, MediaRecorder, stream, and optional Web Audio resources.
- Automated Node tests cover MIME probing/default choice, safe output sizes, source project/JSON immutability, sampling/drawing through the shared engine, recording completion/cancellation, single-flight locking, and audio scheduling. Chromium Pages checks verify UI availability against the browser's real MIME probe. Real encoding, Android storage prompts, MP4/WebM playback, audio/video sync, and memory behavior still require a device test.

## Standalone Android preview artifact

- The `Motion Studio Android preview` workflow builds a distinct artifact for each supported feature branch. For this PR, look for `motion-studio-l8b-android-preview` in this PR's workflow run **Artifacts** section; it expires after 30 days. This workflow does not publish through GitHub Pages or deploy to the official site.
- On Android, open the PR's Actions run in Chrome, download the artifact ZIP, extract it with Files, tap `index.html`, and choose Chrome. The bundled one-file page supports `file://`; the regular multi-file repository page still needs a web server because it uses ES modules and an import map. The included `README.txt` repeats the launch and Timeline gestures.
- Chromium checks the generated file via `file://`, audio and visual effect editing, real pointer movement/cancel/lost capture, export locking, selection focus after redraw, shared playback seek, JSON persistence and legacy loading, and the existing WebM recording flow. MP4 availability varies and is covered by existing MIME/error fallback tests; an actual Android encoder, WebView memory pressure, and thermal behavior are not emulated in CI.
- The artifact link is tied to a workflow run and expires after 30 days. If it expires, use the newest run for this branch. The ZIP is usable without a computer: it contains one standalone HTML file plus the Android instructions.

### HONOR 400 Pro device test

1. Download and open the standalone L6-B artifact as described above. Pick an image, set **Original + Fit**, seek to 3 seconds, add a key, change its zoom/pan, then add at least two more keys. Drag one key, seek away and back, and confirm the Canvas shows the same frame at the same time.
2. Save JSON, reload it, relink the image, and verify all key times and values remain. Delete a middle key and confirm the others remain. Try a duplicate-time drag and a duration reduction that would cross a middle key; both should be rejected without losing data.
3. Confirm Chrome reports the export controls as available. Choose **3 seconds + Economy**, export, and verify the result shows its actual MIME, dimensions, size, duration, plays in the preview, and saves to Downloads. Repeat using the keys at the start, midpoint, and end; the exported motion should follow them.
4. Repeat with **9:16 + Fill** and **16:9 + Fit**, test supported MP4 and WebM separately, enable the test audio, and do a 10-second export. Cancel an export and retry, then change the image after completion.
5. Import one short MP3/WAV from Files, add it to each lane type as needed, adjust its start and volume, and listen while seeking and replaying. Add Arabic and Tunisian Viseme cues, save JSON, reopen it, select the source audio file again, and verify the `assetId` reconnects and the mouth sample follows the same scene time. Confirm actual audio decoder, latency and recording-output limits on the handset.
3. Try MP4 and WebM only when each is marked supported. If MP4 is the default, verify the finished recorder MIME and playback; if a format fails, record the displayed error and try the other supported choice.
4. Test 10 seconds with synchronized audio pulses, then test 30/60 seconds only if the phone remains responsive and output stays below the displayed 24 MiB bound. Cancel an export and immediately start another; also try changing the image/project while recording and confirm it cancels cleanly.
5. Save a JSON project, export a video, then reopen the JSON and relink the image. Confirm aspect, Fit/Fill, camera controls, and seek remain unchanged. Compare output playback and audio sync on-device; browser automation cannot verify the phone encoder, decoder, filesystem prompt, or thermals.
