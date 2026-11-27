# QARTON Motion Studio V2 — L14-C1

Mobile-first Arabic RTL interface integrated with the existing Motion Studio sequence, camera and rendering core.

- The preview uses `StudioSequenceV1`, the shared `createSceneClock`, the existing asset registry, image and audio decoders, camera-motion helper and `drawFrame` renderer.
- Images can be added, replaced and removed per scene. Decode happens before updating the sequence, so a failed replacement leaves the previous image in place.
- Add creates a blank 3-second scene; duplicate copies the current scene. Delete and reorder use the existing sequence functions. Image imports capture a scene ID before decode and abort safely if that scene is removed; unused image assets are cleaned.
- Camera presets cover static, zoom in/out and four directions. Scene duration, speed, strength, playback, stop/restart and global seek use the engine project and unified clock.
- The build bundles CSS and JavaScript into `dist/motion-studio-v2-l14c1-android-preview/index.html` and rejects missing CSS, missing engine JavaScript or remaining external resources.
- Dialogue, music and SFX tracks include microphone recording, decoded waveform, volume/mute, move, trim and delete. Clips can attach to one scene or span the project timeline. All timing follows the existing unified scene clock.
- Import uses the browser's real `AudioContext.decodeAudioData` implementation and commits only after decoding and a non-silent PCM signal check. MP3, WAV, AAC/M4A, OGG and WebM availability depends on the browser decoder. AMR is probed locally by the same decoder; unavailable AMR is rejected without changing existing clips. Decoded PCM remains within the existing 32 MiB limit.
- Microphone permission is requested only after the user taps Record. HTTPS is preferred; a device WebView may grant microphone access to a local `content://` document. More shows source security, microphone permission, AudioContext, format, decoded duration, RMS/Peak and retained PCM.
- Changes and media remain in memory; project persistence and video export are outside this phase.

Run `node scripts/build-motion-studio-v2-preview.mjs` with `L14C1_COMMIT=<full-commit-sha>`, then `python examples/motion-studio-v2/check-prototype.py`. GitHub Actions packages the standalone Android Preview ZIP, runs the existing core tests and exercises real Chromium fake-microphone recording and audio across scenes. It also checks 320, 360, 390, 412 and 480px layouts plus landscape. The CI performance comparison remains against reference commit 9918fae and the new build at 10, 20 and 50 scenes.
