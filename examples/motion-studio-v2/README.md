# QARTON Motion Studio V2 — L14-B

Mobile-first Arabic RTL interface integrated with the existing Motion Studio sequence, camera and rendering core.

- The preview uses `StudioSequenceV1`, the shared `createSceneClock`, the existing asset registry, image decoder, camera-motion helper and `drawFrame` renderer.
- Images can be added, replaced and removed per scene. Decode happens before updating the sequence, so a failed replacement leaves the previous image in place.
- Add creates a blank 3-second scene; duplicate copies the current scene. Delete and reorder use the existing sequence functions. Image imports capture a scene ID before decode and abort safely if that scene is removed; unused image assets are cleaned.
- Camera presets cover static, zoom in/out and four directions. Scene duration, speed, strength, playback, stop/restart and global seek use the engine project and unified clock.
- The build bundles CSS and JavaScript into `dist/motion-studio-v2-l14b-android-preview/index.html` and rejects missing CSS, missing engine JavaScript or remaining external resources.
- Audio integration, microphone recording, project save and video export are explicitly outside this phase.

Run `node scripts/build-motion-studio-v2-preview.mjs` with `L14B_COMMIT=<full-commit-sha>`, then `python examples/motion-studio-v2/check-prototype.py`. GitHub Actions packages the standalone Android Preview ZIP and runs Chromium tests on 320, 360, 390, 412 and 480px widths plus landscape. A dedicated CI comparison measures frame rate and Chromium JavaScript heap for 10 and 20 scenes against commit 9918fae, and the new build at 10, 20 and 50 scenes. The reference build is capped at 32 scenes, so its 50-scene comparison is unavailable.
