# QARTON Motion Studio Lab (L4)

An Android-first, image-only preview editor for the S2-B `StudioProjectV1` core. It imports `compileProject`, `sampleFrame`, and `drawFrame` from `@qarton/cinematic-engine/motion-studio`. The app owns image selection, decoding, downsampling, project JSON, and the playback clock; camera interpolation, timeline sampling, and Canvas drawing remain in the engine.

## Try it on Android

1. Open the repository's GitHub Pages site and visit `examples/motion-studio-lab/` (or serve the repository over HTTP from its root). Do not open the HTML using `file://`: the page uses ES modules and an import map.
2. In Chrome on Android, tap **اختر صورة من الهاتف** and select a local JPG, PNG, WebP, AVIF, or GIF. Image bytes stay in the browser; the lab makes a safe preview surface matching the selected aspect ratio.
3. Set a duration from 3 to 60 seconds. Adjust start/end zoom and horizontal/vertical camera pan, then drag the timeline to inspect any time.
4. Use Play/Pause and Replay to check playback. Seeking and returning to a previous time samples the same compiled project at that absolute timestamp.
5. **حفظ JSON** downloads project metadata. To reopen it, choose the JSON file with **فتح JSON**, then select the source image again. The JSON never embeds image bytes.

The sample image `preview-test.png` is used only by automated browser checks. Video export, face animation, and lip sync are outside this lab.

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
