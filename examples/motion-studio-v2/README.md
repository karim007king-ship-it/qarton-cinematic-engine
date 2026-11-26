# QARTON Motion Studio V2 — L14-B

Mobile-first Arabic RTL interface integrated with the existing Motion Studio sequence, camera and rendering core.

- The preview uses `StudioSequenceV1`, the shared `createSceneClock`, the existing asset registry, image decoder, camera-motion helper and `drawFrame` renderer.
- Images can be added, replaced and removed per scene. Decode happens before updating the sequence, so a failed replacement leaves the previous image in place.
- Scene add, delete, duplicate and reorder call the existing sequence functions. The selected image remains shared where appropriate, and unused assets are cleaned after removal.
- Camera presets cover static, zoom in/out and four directions. Scene duration, speed, strength, playback, stop/restart and global seek use the engine project and unified clock.
- The build bundles CSS and JavaScript into `dist/motion-studio-v2-l14b-android-preview/index.html` and rejects missing CSS, missing engine JavaScript or remaining external resources.
- Audio integration, microphone recording, project save and video export are explicitly outside this phase.

Run `node scripts/build-motion-studio-v2-preview.mjs` with `L14B_COMMIT=<full-commit-sha>`, then `python examples/motion-studio-v2/check-prototype.py`. GitHub Actions packages the standalone Android Preview ZIP and runs Chromium tests on 320, 360, 390, 412 and 480px widths plus landscape.
