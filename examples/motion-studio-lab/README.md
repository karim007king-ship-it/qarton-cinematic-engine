# QARTON Motion Studio Lab (L5)

An Android-first, image-only preview editor for the S2-B `StudioProjectV1` core. It imports `compileProject`, `sampleFrame`, and `drawFrame` from `@qarton/cinematic-engine/motion-studio`. The app owns image selection, decoding, downsampling, project JSON, and the playback clock; camera interpolation, timeline sampling, and Canvas drawing remain in the engine.

## Try it on Android

1. Open the repository's GitHub Pages site and visit `examples/motion-studio-lab/` (or serve the repository over HTTP from its root). Do not open the HTML using `file://`: the page uses ES modules and an import map.
2. In Chrome on Android, tap **اختر صورة من الهاتف** and select a local JPG, PNG, WebP, AVIF, or GIF. Image bytes stay in the browser; the lab makes a safe preview surface matching the selected aspect ratio.
3. Set a duration from 3 to 60 seconds. Adjust start/end zoom and horizontal/vertical camera pan, then drag the timeline to inspect any time.
4. Use Play/Pause and Replay to check playback. Seeking and returning to a previous time samples the same compiled project at that absolute timestamp.
5. **حفظ JSON** downloads project metadata. To reopen it, choose the JSON file with **فتح JSON**, then select the source image again. The JSON never embeds image bytes.
6. In **تصدير الفيديو**, choose MP4 or WebM, a duration (project length, 3, 10, 30, or 60 seconds), and a quality. The lab probes `MediaRecorder.isTypeSupported()` and defaults to MP4 when a supported MP4 MIME is reported, otherwise WebM. The browser can still reject recorder creation or produce a different actual MIME; the result metadata and filename use the MIME reported by the finished recorder.
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
- This PR targets `main` after PR #109 was squash-merged. It reuses the integrated S2-B core; PRs #107 and #108 and all games remain unchanged.

## Video export bounds and testing

- Export calls the existing `compileProject`, `sampleFrame`, and `drawFrame` API with the currently linked image surface, camera tracks, project viewport, and current Fit/Fill-composed pixels. It does not implement a second camera or timeline engine. Export time maps linearly across the project's complete timeline for the chosen output duration.
- Economy output is capped at 640 px on the long edge and 307,200 pixels; Standard and High are capped at 1,280 px and 921,600 pixels. Frame rate remains the project rate (24 fps). Standard is selected by default. Estimated and actual output are limited to 24 MiB; choose a shorter duration or lower quality if the guard rejects a recording.
- High uses a higher bitrate than Standard, with the same pixel cap. Actual codecs, encoder availability, frame pacing, audio muxing, and save behavior depend on the device/browser. A successful probe is not a guarantee that a recording will start or play on every Android build. No server upload is used.
- Only one recording can run at once. Changing project/image/display settings, importing JSON, cancelling, or leaving the page aborts the recording and releases Canvas, MediaRecorder, stream, and optional Web Audio resources.
- Automated Node tests cover MIME probing/default choice, safe output sizes, source project/JSON immutability, sampling/drawing through the shared engine, recording completion/cancellation, single-flight locking, and audio scheduling. Chromium Pages checks verify UI availability against the browser's real MIME probe. Real encoding, Android storage prompts, MP4/WebM playback, audio/video sync, and memory behavior still require a device test.

### HONOR 400 Pro device test

1. Open the Draft PR's GitHub Pages preview (or serve the PR branch over HTTPS) in Chrome on the HONOR 400 Pro. Pick a normal image, set **Original + Fit**, choose **3 seconds + Economy**, and export. Confirm the result shows its actual MIME, dimensions, size, duration, plays in the preview, and saves to Downloads.
2. Repeat with **9:16 + Fill** and **16:9 + Fit**, setting a noticeable end zoom and pan. Compare the exported preview with the Motion Studio seek preview at the start, midpoint, and end.
3. Try MP4 and WebM only when each is marked supported. If MP4 is the default, verify the finished recorder MIME and playback; if a format fails, record the displayed error and try the other supported choice.
4. Test 10 seconds with synchronized audio pulses, then test 30/60 seconds only if the phone remains responsive and output stays below the displayed 24 MiB bound. Cancel an export and immediately start another; also try changing the image/project while recording and confirm it cancels cleanly.
5. Save a JSON project, export a video, then reopen the JSON and relink the image. Confirm aspect, Fit/Fill, camera controls, and seek remain unchanged. Compare output playback and audio sync on-device; browser automation cannot verify the phone encoder, decoder, filesystem prompt, or thermals.
