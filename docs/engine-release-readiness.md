# QARTON Cinematic Engine — Release Readiness Checklist

This checklist is a release gate, not a claim that all items are complete. It tracks what must be verified before promoting the current lifecycle/audio work from draft PRs to a stable release.

## Current verified state (2026-11-18)

- Draft PR #48 integrates lifecycle, audio adapter, asset cancellation, and runtime changes into main.
- Draft PR #49 stacks teardown/rollback hardening on PR #48.
- Latest reported GitHub Actions run for PR #49 passed Node tests and Chromium smoke checks.
- The Node suite currently reports 229 passing tests (0 failed, 0 skipped).
- Chromium smoke covers the showcase and diagnostic-page startup/reset.
- Physical Android WebView testing has not been completed; no release or device-compatibility claim is made.

## Release gates

### A. Public API and package
- [ ] Verify all documented exports resolve from the root package.
- [ ] Verify each supported subpath export resolves in a clean consumer fixture.
- [ ] Check package contents include required source/docs/examples and exclude unintended files.
- [ ] Confirm minimum Node version and browser compatibility notes are accurate.
- [ ] Verify no import-time browser globals or side effects.

### B. Runtime lifecycle
- [x] Activity gate can pause/resume owned work.
- [x] Page lifecycle adapter handles visibilitychange, pagehide, pageshow.
- [x] Listener attachment rollback and retryable removal are covered.
- [x] Runtime ignores late lifecycle callbacks after destroy.
- [x] Director serializes updates and invalidates queued frames after destroy.
- [x] Destroy waits for active character-stage update before resource release.
- [ ] Verify repeated enter/exit in target WebView without listener accumulation.

### C. Audio
- [x] HTMLAudio adapter is injectable and lazy.
- [x] Playback errors are reported through callback.
- [x] Failed native setup retains ownership when rollback fails.
- [x] Stop/destroy cleanup retries retained resources.
- [x] Pause/resume and ended-voice cleanup have regression tests.
- [ ] Validate real device audio route, lifecycle, resume policy, and screen-lock behavior.
- [ ] Verify Bluetooth route/disconnect behavior if available.

### D. Scene and asset safety
- [x] Asset loading deduplicates concurrent requests and supports cancellation.
- [x] Stale renderer/transition outcomes are guarded.
- [x] Scene transitions preserve current scene when preparation/crossfade fails.
- [ ] Measure memory during repeated transitions on device.
- [ ] Verify image decode and visible compositing on Android WebView.

### E. Device validation record
Record:
- Device model and OS/MagicOS build:
- Android System WebView / Chromium version:
- Engine commit:
- Test date:
- Audio route:
- Test steps and observed results:

Acceptance:
- No duplicate voices after repeated resume.
- No audible playback after stop/destroy.
- Background time does not advance the cinematic clock while inactive.
- Returning to foreground does not burst missed one-shot cues.
- Repeated lifecycle and scene transitions do not accumulate listeners or DOM nodes.
- Failed resume is recoverable through a user gesture.
- Cleanup failures remain visible and retryable.

## Integration gate for Carthage

- [ ] Inventory scene IDs, asset keys, character IDs, expression names, audio assets, and save schema.
- [ ] Add a Carthage-owned adapter boundary; do not put story branching or save logic in the engine.
- [ ] Pin the engine to a tested commit or release.
- [ ] Select one revisitable, non-critical scene as a pilot.
- [ ] Keep the existing renderer as fallback until device validation passes.
- [ ] Run save/load, chapter progression, and story-choice regression tests.
- [ ] Do not change story text, Tunisian dialogue, save schema, or progression as part of the presentation pilot.

## Promotion procedure

1. Review draft PR #48 and stacked draft PR #49 as one coherent change set.
2. Re-run CI on the exact candidate commit.
3. Complete device validation and attach the test record.
4. Resolve review comments and remove draft status only after the gates are satisfied.
5. Merge the stack in order; verify main CI after each merge.
6. Tag a version only after the final main-branch checks pass.
