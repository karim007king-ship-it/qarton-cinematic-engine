# Carthage Integration Contract

Status: design and implementation boundary only. This document does not modify the Carthage game or its save format.

## Observed Carthage repository architecture (17 November 2026)

The current Carthage repository was inspected before proposing a runtime integration:

- The playable game is currently delivered as a self-contained `index.html` (approximately 3.85 MB on the inspected `main` revision); the React/game source is bundled into that file.
- Android-specific presentation and navigation enhancements are assembled by `scripts/prepare-web.cjs` during `npm run prepare:web`. That script injects several presentation/runtime blocks into the web build.
- The current package manifest depends on Capacitor packages; it does not yet declare `@qarton/cinematic-engine` as a dependency.
- The existing Chapter 3 Great Wall moment already has a presentation-only cinematic pilot in the Android preparation script (camera push-in, light pass, impact shake, dust/rubble/character effects). Its activation is guarded by the existing story text, and the smoke test checks that the pilot remains present.
- The existing test suite includes HTML/embedded-JavaScript smoke checks and save-recovery checks. It does not yet exercise the new engine against the actual game renderer or validate Android WebView playback.

These observations change the safest integration path: do not inject another large inline runtime into the already complex preparation script, and do not replace the existing Great Wall pilot as the first experiment. First establish a separately testable adapter module and a pinned, reproducible way for the Carthage build to consume the engine. Then select a small, revisitable scene whose presentation can be compared against the existing renderer. Keep the current Great Wall pilot intact until the new adapter passes device validation.

## Goals

- Integrate QARTON Cinematic Engine behind a Carthage-owned adapter.
- Preserve the existing story text, Tunisian dialogue, chapter progression, choices, inventory, clues, trust values, endings, and save/import/export format.
- Keep the current game renderer as the fallback until each cinematic scene passes visual and device checks.
- Keep engine lifecycle, story state, and persistence as separate responsibilities.

## Ownership boundaries

| Concern | Owner | Integration rule |
|---|---|---|
| Story, chapters, choices, branching and endings | Carthage | Engine receives presentation data; it never decides story progression. |
| Save slots, autosave, import/export and schema migration | Carthage | Do not serialize engine objects, DOM nodes, audio elements, or runtime clocks. |
| Scene presentation, background layers, parallax and transitions | Cinematic adapter / Engine | Build a presentation scene from the current Carthage chapter state. |
| Character motion and expression | Cinematic adapter / Engine | Map existing character IDs and expression names; do not replace character/story identity. |
| Audio cues and voice playback | Carthage audio manifest + Engine adapters | Asset keys map to existing/local audio assets; user-gesture policy remains host-owned. |
| Device lifecycle and frame scheduling | Carthage host | Pause/resume the director and runtime when the app becomes inactive. |

## Integration sequence

1. **Inventory first.** Record current Carthage scene IDs, background asset paths, character IDs, expression keys, audio paths, and the current save schema. Do not rename or move assets during the first integration.
2. **Add an adapter boundary.** Create a Carthage-side module (proposed: `src/cinematic/carthage-cinematic-adapter.js`) that translates Carthage presentation state into engine scene definitions. The adapter is not part of this engine repository.
3. **Start with one non-critical scene.** Use a scene that can be revisited safely. Keep the existing renderer available as fallback.
4. **Add characters and motion.** Only after the background and layer composition pass on the target phone.
5. **Add audio cues.** Start audio only after a user gesture where required by WebView; do not change existing dialogue or narration timing without an explicit story review.
6. **Lifecycle and teardown.** Verify app switch, screen lock, scene replacement, and repeated entry/exit. Destroy the director, runtime, stage, and audio adapter in the host's ownership order.
7. **Expand chapter-by-chapter.** Do not enable the new renderer globally until the pilot passes device checks and save/load regression tests.

## Scene translation contract

A Carthage adapter should construct a fresh engine scene definition from presentation-only data:

```js
import { createSceneDefinition } from "@qarton/cinematic-engine";

export function toCinematicScene(chapterPresentation) {
  return createSceneDefinition({
    id: chapterPresentation.sceneId,
    durationMs: chapterPresentation.transitionDurationMs ?? 350,
    layers: chapterPresentation.layers.map(layer => ({
      id: layer.id,
      role: layer.role, // background | midground | foreground | character | overlay
      asset: layer.assetKey,
      depth: layer.depth ?? 0,
      opacity: layer.opacity ?? 1
    }))
  });
}
```

The adapter must validate that every `assetKey` exists in the host manifest. Keep story chapter IDs and presentation scene IDs distinct if the current game already uses different identifiers.

## Audio adapter contract

The engine's cue controller owns cue timing, not the game soundtrack or asset manifest. The host resolves asset keys and supplies playback functions.

```js
import { createAudioCueController } from "@qarton/cinematic-engine/audio";
import { createHTMLAudioAdapter } from "@qarton/cinematic-engine/audio/html";

const audioAdapter = createHTMLAudioAdapter({
  resolveAsset: key => audioManifest[key],
  onPlaybackError: (error, details) => reportAudioError(error, details)
});

const audioController = createAudioCueController({
  cues: sceneAudioCues,
  play: (asset, options) => audioAdapter.play(asset, options),
  stop: voice => audioAdapter.stop(voice),
  pauseVoice: voice => audioAdapter.pause(voice),
  resumeVoice: voice => audioAdapter.resume(voice),
  setVolume: (voice, volume) => audioAdapter.setVolume(voice, volume)
});
```

Call `audioController.destroy()` during host teardown. The adapter's `destroy()` is also required to release its native media elements; call both, and retain error reporting/retry behavior if cleanup fails. Do not create an AudioContext or start playback during module import.

## Director and lifecycle contract

The director is the shared clock for character stage, audio cues, and timeline events. The host owns the frame scheduler. The runtime owns scene transitions, asset management, and optional page lifecycle wiring; it does not automatically schedule director frames.

- Mount the character stage, then mount the director before sending updates.
- Feed monotonically increasing host timestamps to `director.update(timestamp)`.
- On app/page inactivity call `director.pause()`; resume through a user gesture if WebView blocks playback, then call `director.resume()`.
- If the runtime is configured with lifecycle targets, it starts its page lifecycle adapter on construction. Avoid registering a second competing page lifecycle handler for the same director.
- On scene replacement, stop the old director/stage and release old scene assets before attaching the next scene.
- On application teardown, stop the host frame loop first, then destroy director/stage/audio/runtime resources. Make teardown idempotent at the Carthage adapter layer.

## Persistence and regression requirements

The engine must remain presentation-only. A Carthage save must continue to contain only the existing game data. In particular:

- Never write animation timestamps, audio playback positions, DOM references, runtime profile objects, or engine instances into a save.
- Loading a save must reconstruct the same chapter, location, choices, inventory, clues, trust values, health, score, and remaining time as before integration.
- A failed cinematic asset load must fall back to the current Carthage presentation without resetting or advancing story state.
- Starting a new game, continuing a save, importing a save, and returning to the home screen must all retain their existing behavior.

## Pilot acceptance checklist

- [ ] Existing save loads with identical story progress and values.
- [ ] New game and continue-save flows still work.
- [ ] Background layers appear correctly on HONOR 400 Pro / Android WebView.
- [ ] Arabic/Tunisian story text, font, contrast, and layout are unchanged.
- [ ] Character sprites and expressions load without stale-image flashes.
- [ ] Audio starts only under the host's permitted user gesture and does not duplicate after resume.
- [ ] App switch and screen lock freeze the cinematic clock.
- [ ] Re-entering the scene does not leave duplicate DOM nodes, listeners, or audio voices.
- [ ] Returning to the existing renderer works if the cinematic adapter fails.
- [ ] CI tests and a real-device visual/audio check both pass.

## Explicitly out of scope for the pilot

- Rewriting story content or dialogue.
- Changing save schema or migrating existing save files.
- Replacing the home screen, chapter navigation, choices, or game state manager.
- Migrating every chapter at once.
- Claiming Android WebView compatibility based only on Node or headless Chromium tests.
