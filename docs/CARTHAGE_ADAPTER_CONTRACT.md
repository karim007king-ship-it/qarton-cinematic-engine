# Carthage ↔ QARTON cinematic adapter — contract draft

Status: specification only; no game code modified. Based on inspected Carthage README, package.json, scripts/prepare-web.cjs, and engine public API on 2026-11-21. Do not treat as tested integration.

## Ownership boundaries
- Carthage owns story, choices, chapter/scene index, languages, inventory, clues, endings, progression, UI navigation and persistence.
- QARTON owns only cinematic presentation: scene packages, background layers, characters, camera, timeline, optional audio and resource cleanup.
- The adapter translates a **read-only presentation snapshot** into a versioned QARTON scene package. Never import game state into engine core.
- Opt-in feature flag defaults OFF; legacy renderer remains available. Failed asset load or engine initialization must return to legacy presentation without changing gameplay state.

## Current Carthage integration facts and risks
- Main game lives in a large self-contained `index.html`; Android preparation copies it into `www/index.html` and applies string-replacement hooks in `scripts/prepare-web.cjs`.
- These hooks rely on minified identifiers and exact strings. Changing the game bundle or inserting transformations before these hooks can break Android preparation.
- Existing Android preparation writes `shiganshina-slots-v1`, `shiganshina-autosave-v1` and `shiganshina-autosave-time-v1` in localStorage. These keys and save JSON fields must remain untouched.
- The Android preparation exposes `window.__carthageSaveNow`, `window.__carthageContinue`, `window.__carthageStartPart3` and `window.__carthageCanStartPart3`. Treat them as legacy integration surfaces, not as APIs to replace without tests.
- README describes the story as Tunisian Arabic and documents experimental cinematic content. No scene-level public adapter hook was verified in this review.

## Proposed host-owned adapter API (NOT implemented)
```js
createCarthageCinematicAdapter({
  engine,                    // imported QARTON engine module
  resolveScenePackage,       // (presentationSnapshot) => Promise<scenePackageJSON|null>
  resolveAsset,              // game-owned key -> asset URL or decoded resource
  mountRoot,                 // separate cinematic DOM mount point
  onError,                   // diagnostics; never mutate story state
  reducedMotion = false
}) => ({
  show(snapshot),            // render presentation only; returns success boolean
  pause(), resume(), seek(ms),
  hide(), destroy()
});
```
This is an interface proposal, not a current exported symbol.

### Snapshot input: allowlist
```js
{
  sceneId: "game-owned-stable-scene-key",
  locale: "game-owned-locale",
  visualVariant: "optional-game-owned-key",
  accessibility: { reducedMotion: false }
}
```
No `state`, `flags`, `inventory`, `trust`, save objects or narrative decision functions cross into the engine. The game selects the scene package. No engine event is allowed to advance story or save progress automatically.

## Pilot rollout
1. Add adapter as a separate, opt-in game-owned module and a distinct mount root. Do not alter minified bundle or `prepare-web.cjs` string hooks in the first pilot.
2. Use a single visual-only scene and externally owned assets. Disable flag by default and provide a one-click fallback.
3. Validate both browser `index.html` and generated `www/index.html` paths. Avoid relying on file:// module/fetch behavior; test through HTTP and Android WebView.
4. Run existing Carthage `npm test` and `npm run prepare:web`, engine Node suite, Pages Playwright checks, and a physical Android save/resume check. Record observed results.
5. Verify: new game, continue last save, slot save/export/import, settings and language changes, story choices, chapter transitions, clues, endings, Part 3 lock, and return home.
6. Compare saved JSON before/after cinematic mode and confirm no schema changes. Back up real saves before device testing.
7. Only widen rollout after pilot passes and the game owner accepts the visual result.

## Open questions requiring code inspection
- Exact stable scene identifier and lifecycle event exposed by the original game runtime.
- Whether locale switching and settings emit safe events usable by the adapter.
- How best to bundle ESM assets into the Android `www` output without interfering with existing transforms.
- Physical Android WebView audio unlock, memory, frame-time and app background/resume behavior.

## Stop conditions
- Any regression in save/recovery, new-game flow, localization, or legacy navigation.
- Unhandled animation/audio promise rejection or resources remaining after destroy.
- Changes to original story text, progression rules, or save keys.

Next engineering deliverable: a **read-only Carthage integration hook inventory** and a tested standalone adapter prototype on a separate branch. Do not merge into the game by default.
