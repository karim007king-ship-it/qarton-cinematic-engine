# QARTON Motion Studio V2 — L14-C2 Text Animation

The mobile-first RTL editor reuses `StudioSequenceV1`, `createSceneClock`, the existing asset registry, the current image decoder, camera-motion helper, `drawFrame`, and the character animation core. Its active runtime imports no audio controller or audio decoder and does not request a microphone.

## Character and dialogue flow

- `src/character/text-viseme.js` compiles Tunisian Arabic and Modern Standard Arabic text into timed mouth-shape events without speech audio. It handles punctuation holds, diacritics, spaces, configurable speed, expression labels, deterministic seek sampling, and a closed-mouth rest after the line.
- `src/character/text-cinematic-scene.js` composes several speakers on one canvas. Layered vector characters animate head, torso, hands, gaze, blink, breathing, listening reactions, expressions, and mouth shapes; no external character image is required.
- Three editable scene demonstrations cover Tunisian Arabic and MSA. The character panel edits a speaker's text and dramatic expression, selects among the scene cast, and changes speech speed.
- Character sampling reads the same scene-local time supplied by the Motion Studio sequence clock. Play, pause, resume, stop/replay, and seek therefore sample the same deterministic pose.
- Still images are optional backgrounds. The preview works from the local procedural scene with no files, microphone permission, AudioContext, or audio decoding.

The audio controller and recording UI from L14-C1 remain in the L14-C1 snapshot on branch `archive/audio-l14c1-675ec53`. The audio implementation files remain in the source tree for recovery, but the L14-C2 runtime entry points do not import them.

## Validation

Run all Node tests with `node --test`, build the offline HTML with `L14C2_COMMIT=<full-commit-sha> node scripts/build-motion-studio-v2-preview.mjs`, and run `python examples/motion-studio-v2/check-text-prototype.py` after installing Chromium Playwright. The GitHub Actions workflow runs those checks, compares 10/20/50-scene performance, and packages Android Preview ZIP plus Standalone HTML and validation reports.

The output is a preview: project persistence and video export are not enabled. Browser and CI validation do not replace a physical Android device check.
