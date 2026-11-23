# QARTON Motion Studio Lab (L2)

An Android-first, image-only preview editor for the S2-B `StudioProjectV1` core. It imports `compileProject`, `sampleFrame`, and `drawFrame` from `@qarton/cinematic-engine/motion-studio`. The app owns image selection, decoding, downsampling, project JSON, and the playback clock; camera interpolation, timeline sampling, and Canvas drawing remain in the engine.

## Try it on Android

1. Open the repository's GitHub Pages site and visit `examples/motion-studio-lab/` (or serve the repository over HTTP from its root). Do not open the HTML using `file://`: the page uses ES modules and an import map.
2. In Chrome on Android, tap **اختر صورة من الهاتف** and select a local JPG, PNG, WebP, AVIF, or GIF. Image bytes stay in the browser; the lab makes a 720×1280 cover-cropped preview surface.
3. Set a duration from 3 to 60 seconds. Adjust start/end zoom and horizontal/vertical camera pan, then drag the timeline to inspect any time.
4. Use Play/Pause and Replay to check playback. Seeking and returning to a previous time samples the same compiled project at that absolute timestamp.
5. **حفظ JSON** downloads project metadata. To reopen it, choose the JSON file with **فتح JSON**, then select the source image again. The JSON never embeds image bytes.

The sample image `preview-test.png` is used only by automated browser checks. Video export, face animation, and lip sync are outside this lab.

## Resource and format bounds

- Project canvas is fixed at 720×1280 and 24 fps; duration is 3,000–60,000 ms.
- Input file is limited to 20 MiB, each image side to 4,096 px, and decoded image area to 8,388,608 pixels. Images are downsampled to one 720×1280 surface, and the temporary `ImageBitmap` is closed after preparation.
- JSON files are capped at 128 KiB and use a separate `qarton-motion-studio-project` envelope around `StudioProjectV1` metadata. A saved project references an opaque asset ID and records only the source name/type/size; reselect the source file after import.
- The browser owns a single preview surface and one image surface. Decode, Canvas allocation, schema, and memory-related errors are shown in the page.
- This PR targets `main` after PR #109 was squash-merged. It reuses the integrated S2-B core; PRs #107 and #108 and all games remain unchanged.
