# QARTON Motion Studio Lab (L6-B)

An Android-first, image-only preview editor for the S2-B `StudioProjectV1` core. It imports `compileProject`, `sampleFrame`, and `drawFrame` from `@qarton/cinematic-engine/motion-studio`. The app owns image selection, decoding, downsampling, project JSON, and the playback clock; camera interpolation, timeline sampling, and Canvas drawing remain in the engine.

## Try it on Android

1. For this Draft PR, download the `motion-studio-l6b-android-preview` artifact from the latest successful **Motion Studio Android preview** Actions run for PR #116, extract it in Android Files, and open its single `index.html` with Chrome. That generated file bundles its CSS and JavaScript and is designed for `file://`; do not open the repository's regular multi-file `examples/motion-studio-lab/index.html` from `file://`, because it uses ES modules and an import map. The artifact is separate from the official Pages deployment and expires after 30 days.
2. In Chrome on Android, tap **اختر صورة من الهاتف** and select a local JPG, PNG, WebP, AVIF, or GIF. Image bytes stay in the browser; the lab makes a safe preview surface matching the selected aspect ratio.
3. Set a duration from 3 to 60 seconds and choose the image aspect and Fit/Fill mode. The Timeline below the preview has a time ruler, playhead, and one diamond per camera key. Tap the ruler lane to seek; tap **＋ مفتاح عند المؤشر** to add a key at that time; tap a diamond to select it; drag a diamond horizontally to move it; edit its X, Y, Zoom, or Rotation fields; use **حذف المفتاح المحدد** to remove only that key.
4. Use Play/Pause and Replay to check playback. The Canvas samples the same compiled project at absolute timestamps; repeated seeks to the same time are deterministic. Legacy start/end sliders remain available and update only their respective endpoint value without dropping intermediate keys.
5. **حفظ JSON** downloads project metadata. To reopen it, choose the JSON file with **فتح JSON**, then select the source image again. The JSON never embeds image bytes.
6. In **تصدير الفيديو**, choose MP4 or WebM, a duration (project length, 3, 10, 30, or 60 seconds), and a quality. The lab probes `MediaRecorder.isTypeSupported()` and defaults to MP4 when a supported MP4 MIME is reported, otherwise WebM. The browser can still reject recorder creation or produce a different actual MIME; if MP4 start fails while WebM is available, tap **جرّب WebM بدل MP4**. The result metadata and filename use the MIME reported by the finished recorder.
7. Optionally enable the synchronized test pulses. Start export and keep the tab open and foregrounded until it finishes. Preview the result, then tap the save link and choose a location in Android's download/file flow.

The sample image `preview-test.png` is used only by automated browser checks. Face animation and lip sync are outside this lab.

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

- The `Motion Studio Android preview` workflow builds a distinct artifact for each supported feature branch. For this PR, look for `motion-studio-l6b-android-preview` in the L6-B workflow run's **Artifacts** section; it expires after 30 days. This workflow does not publish through GitHub Pages or deploy to the official site.
- On Android, open the PR's Actions run in Chrome, download the artifact ZIP, extract it with Files, tap `index.html`, and choose Chrome. The bundled one-file page supports `file://`; the regular multi-file repository page still needs a web server because it uses ES modules and an import map. The included `README.txt` repeats the launch and Timeline gestures.
- Chromium checks the generated file via `file://`, mobile touch interactions, keyframe add/edit/drag/delete, JSON round-trip, deterministic seek, and the existing WebM recording flow with audio, 3-second and 10-second runs, playback metadata, download, cancellation, retry, and image replacement. MP4 availability varies and is covered by the MIME/error fallback tests; an actual Android MP4 encoder is not emulated in CI.
- The artifact link is tied to a workflow run and expires after 30 days. If it expires, use the newest run for this branch. The ZIP is usable without a computer: it contains one standalone HTML file plus the Android instructions.

### HONOR 400 Pro device test

1. Download and open the standalone L6-B artifact as described above. Pick an image, set **Original + Fit**, seek to 3 seconds, add a key, change its zoom/pan, then add at least two more keys. Drag one key, seek away and back, and confirm the Canvas shows the same frame at the same time.
2. Save JSON, reload it, relink the image, and verify all key times and values remain. Delete a middle key and confirm the others remain. Try a duplicate-time drag and a duration reduction that would cross a middle key; both should be rejected without losing data.
3. Confirm Chrome reports the export controls as available. Choose **3 seconds + Economy**, export, and verify the result shows its actual MIME, dimensions, size, duration, plays in the preview, and saves to Downloads. Repeat using the keys at the start, midpoint, and end; the exported motion should follow them.
4. Repeat with **9:16 + Fill** and **16:9 + Fit**, test supported MP4 and WebM separately, enable the test audio, and do a 10-second export. Cancel an export and retry, then change the image after completion.
3. Try MP4 and WebM only when each is marked supported. If MP4 is the default, verify the finished recorder MIME and playback; if a format fails, record the displayed error and try the other supported choice.
4. Test 10 seconds with synchronized audio pulses, then test 30/60 seconds only if the phone remains responsive and output stays below the displayed 24 MiB bound. Cancel an export and immediately start another; also try changing the image/project while recording and confirm it cancels cleanly.
5. Save a JSON project, export a video, then reopen the JSON and relink the image. Confirm aspect, Fit/Fill, camera controls, and seek remain unchanged. Compare output playback and audio sync on-device; browser automation cannot verify the phone encoder, decoder, filesystem prompt, or thermals.
