# QARTON MASTER PLAN — Multi-game cinematic engine

Status: living architecture and product plan. This document describes intended direction, not claims that every capability already exists.

## Non-negotiable principles
1. QARTON Cinematic Engine is **independent** of every game. No Carthage, Kairouan, or Sawt fi al-Madina story data or game-specific UI belongs in the engine core.
2. Preserve existing functionality, saves, narrative content, localization and game repositories. Changes must be backward-compatible or migrated explicitly.
3. QARTON TEST LAB is the integration and regression test bed. Validate on desktop browsers and real Android devices where available.
4. Ship capabilities incrementally with automated tests, performance budgets, and a reversible integration path.
5. Do not assume 3D, generative AI, speech synthesis or asset-generation features exist until implemented and tested.

## Product portfolio
- **QARTON Cinematic Engine:** reusable scene graph, 2D character animation, camera, timeline, transitions, layered backgrounds, particles, audio and configurable quality.
- **QARTON TEST LAB:** isolated demos, performance and compatibility checks, visual/audio regression scenarios.
- **آخر يوم في قرطاج:** main game; redesign presentation and add scene backgrounds/characters while retaining Tunisian narrative, choices, clues, endings, localization and save compatibility.
- **القيروان:** independent future game with its own assets, story and configuration.
- **صوت في المدينة:** independent game; integration should be opt-in and avoid altering its current gameplay and translations.
- **Football Manager 4:** separate management game; may reuse selected engine components only if justified.

## Architectural boundaries
- Engine core: generic runtime APIs, rendering, animation, camera, timeline, audio, input, asset loading and adaptive quality.
- Game adapters: optional glue translating a game's events/state into engine commands. Each game retains authority over progression, saves and business logic.
- Game content: story scripts, characters, backgrounds, audio, translations and UI themes live in each game's own repository.
- Test Lab: demonstration scenarios and integration checks, not production game content.
- Prefer data-driven scene definitions and versioned APIs; no hard-coded game names or asset paths in engine core.

## Prioritized roadmap
### Phase 0 — baseline and safety
- Record currently passing CI and Android browser smoke test; protect a stable revision.
- Inventory existing modules, public APIs, tests, audio restrictions and device performance.
- Establish compatibility tests and error logging.

### Phase 1 — reusable scene presentation
- Define a versioned scene schema: background layers, characters, timeline events, camera, audio cues and transitions.
- Add configurable responsive layout and mobile controls.
- Support static backgrounds first, then parallax and animated layers; use external game assets.
- Build a test scene in Test Lab, preserving existing demo.

### Phase 2 — expressive 2D cinematic features
- Character states: idle, walk, gesture, expression; optional layered sprite rigs.
- Camera: pan, zoom, shake, focus and transition presets.
- Audio: ambient layers, SFX and dialogue hooks respecting mobile gesture/autoplay rules.
- Adaptive quality and asset preloading with fallbacks.

### Phase 3 — Carthage adapter and presentation migration
- Map current game state to scene commands without moving game logic into engine.
- Prototype one reversible cinematic scene and new display mode behind a feature flag.
- Add backgrounds and character art with source/license records.
- Verify new game, resume, settings, all supported languages, choices, clues, endings and old saves before wider rollout.

### Phase 4 — multi-game validation
- Create separate adapters/prototypes for Kairouan and Sawt fi al-Madina only when their owners' game requirements are defined.
- Verify that changes to one game cannot change another.
- Reassess whether any FM4 subsystem benefits from optional engine modules.

## Definition of done for each feature
- Documented reusable API and example; no game-specific coupling.
- Automated tests pass; desktop and mobile browser behavior checked.
- Existing game content and save data preserved.
- Accessibility, audio permissions and performance reviewed.
- Rollback path documented.

## Immediate next steps
1. Audit current engine code and tests against this plan; mark implemented vs proposed.
2. Implement a reusable scene definition and one Test Lab demonstration.
3. Prepare a separate Carthage adapter specification before touching the game repository.
