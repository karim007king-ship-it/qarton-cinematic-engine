# QARTON Motion Studio V2 — L14-C2 Text Animation

The mobile-first RTL editor reuses `StudioSequenceV1`, `createSceneClock`, the existing asset registry, the current image decoder, camera-motion helper, `drawFrame`, and the character animation core. Its active runtime imports no audio controller or audio decoder and does not request a microphone.

### Character and dialogue model

- Character definitions are unique stable IDs (`layla`, `youssef`, `nour`, `salim`). Dialogue lines reference `speakerId`; repeated speech turns reuse one character sprite and one placement record.
- The three demos use original transparent generated anime portraits and project-drawn Carthage/Mediterranean backdrops. Asset provenance and the preview-only scope are in [`assets/ASSET_PROVENANCE.md`](assets/ASSET_PROVENANCE.md).
- Import one transparent PNG/WebP portrait or a batch of named parts. Examples: `layla__body.png`, `layla__head.png`, `layla__hair_back.webp`, `layla__eyes.png`, `layla__brows__angry.png`, and `layla__mouth__round.webp`. A character layer manifest can set normalized x/y/size, pivot, z-order, face anchor and facing direction; see `character-layer-manifest.example.json`.
- Supported part names are body, head, hair_back, hair_front, eyes, brows, mouth, hand_left and hand_right. Expression and mouth variants replace their neutral layers. Head and hand layers receive deterministic movement, while portrait sprites get subtle body breathing, blinking, gaze, expressions, mouth overlays and speaker focus.
- Full-body portraits are single-layer artwork. For more natural head/arm posing, artists should provide transparent segmented parts aligned to a shared character canvas and authored pivots.
- Imported character art shares a 12-megapixel decoded bitmap budget per editor session; shared source bitmaps are counted once to limit Android memory use.
- Dialogue supports up to 5,000 characters per line, preserves RTL and line breaks, reveals text and visemes against the same scene clock, and has a skip-typing control. The line editor and character identity are separate; a dialogue role can be assigned to an existing character.
- The future language-engine bridge is the versioned JS object shape `{ id, characters: [{ id, name, ... }], dialogue: [{ id, speakerId, text, expression, speed }] }`; it does not import or modify the QARTON language engine.

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
