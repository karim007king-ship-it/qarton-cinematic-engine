# QARTON — Engine capability audit (2026-11-21)

Scope: inspected repository README, package.json, src/index.js, examples/browser-smoke.html, and Pages workflow. This is a source-level audit, **not** a new execution of Node tests or a verified Android WebView run.

| Capability | Source-level evidence | Remaining verification |
|---|---|---|
| Engine independence | ES module public API in src/index.js; no game import in entrypoint | Audit deeper modules for hard-coded game dependencies |
| Scene definitions and backgrounds | createSceneDefinition, buildLayerPlan, BackgroundRenderer | Real asset loading, layer ordering, error cases |
| Characters | createCharacterController, createCharacterStage, DOM renderer | Visual fidelity, gesture/idle/walk animation on Android |
| Camera and effects | camera track, shake, parallax, particles, lighting/fog | Visual regression and frame timing |
| Timeline | createTimeline, createCinematicDirector | Pause/resume, seek and event replay edge cases |
| Audio | createAudioCueController, createHTMLAudioAdapter; oscillator demo | Mobile unlock, mute/pause, real asset playback |
| Performance | resolveQualityProfile, adaptive monitor, activity gate | Actual Android FPS/memory and lifecycle |
| Browser showcase | examples/browser-smoke.html with two scenes, characters and buttons | Test on target devices and browser engines |
| Deployment | Pages workflow stages _site and invokes Playwright script | Confirm successful workflow logs and hosted assets |
| Carthage integration | Not part of engine entrypoint | Design adapter and migration tests; do not edit game yet |
| Kairouan / Sawt fi al-Madina | Planned consumers | Define per-game integration requirements |

## Findings
1. **Documentation drift:** README still describes real-browser testing as manual-only and says the engine has not been tested on Android. The Pages workflow now invokes Playwright desktop and Pixel 7-emulated Chrome tests. User has also confirmed the hosted demo and buttons work on a real Android phone; this does not establish Android WebView compatibility or comprehensive performance.
2. **Demo is a smoke test, not an anime art benchmark.** It uses generated SVG backgrounds and characters. Production assets, sprite states and animation quality remain future work.
3. **Cross-game contract remains unspecified.** Need a versioned adapter interface, asset namespace rules, and game-owned persistence.
4. **No observed test logs in this audit.** Do not mark Node/Playwright suites as passing without their output.

## Next implementation sequence
1. Reconcile README with the current Pages CI/browser coverage.
2. Review scene schema and runtime lifecycle, then add schema compatibility and asset-isolation tests.
3. Create one independent scene package demo with external assets and no game-specific imports.
4. Draft a Carthage adapter contract preserving existing story, languages, save format and navigation.
5. Run Node tests, Pages browser tests, and physical Android checks before merging integration changes.

## Guardrails
- No game repository changes in this audit.
- Preserve existing public exports and demo.
- Record actual test evidence before declaring a feature complete.

## Independent scene package review

Reviewed public exports and internal module imports across assets, audio, camera, characters, core, effects, motion, runtime and scene. Engine modules import engine code. Pack content and URLs are supplied by each host. The new v1 compiler composes the existing scene, timeline, camera, character and audio validators. The observatory fixture lives under examples.

A same-turn load/destroy sequence used to call an already-cleared loader. An accepted request now retains its loader while cache generation prevents a late write. A Node regression covers this sequence.

Pages verification now exercises both examples on pull requests. Publishing requires the main branch. Desktop and Pixel emulation cover DOM geometry, image decode, controls and teardown. Physical Android frame times, memory, WebView audio and production character artwork remain outside this coverage.
