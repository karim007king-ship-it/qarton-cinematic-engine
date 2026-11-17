# Android WebView Audio & Lifecycle Validation

This checklist is for the host application that integrates QARTON Cinematic Engine. It is a device-validation procedure, not a claim that CI can emulate Android audio focus.

## Test environment

- Device: record exact model and Android/MagicOS build.
- Host: record app version, Android System WebView version, and Chromium version.
- Engine: record branch and commit SHA.
- Audio route: test both the phone speaker and a connected Bluetooth headset when available.
- Start with media volume audible; disable silent mode only if the host app requires it.

## Required integration wiring

- Create one `createCinematicDirector` for the active scene.
- Pass that same director to the runtime's `audioController` lifecycle bridge.
- Start page lifecycle observation with the host's document and window EventTargets.
- Keep the Web Audio / HTMLAudio adapter owned by the host; destroy it when the scene or host is disposed.
- Start/resume Web Audio from a real user gesture. Do not assume returning from background grants autoplay permission.
- Route playback errors to a visible diagnostic callback; do not swallow them silently.

## Device test sequence

1. **Fresh start**
   - Open the host scene and start audio from its explicit audio control.
   - Confirm the cue starts once and the scene clock advances.
   - Confirm repeated taps do not create duplicate looping voices.

2. **Notification shade / app switch**
   - While a looping cue is audible, open the notification shade, then return.
   - Repeat by switching to another app and returning.
   - Confirm the director pauses while inactive, the cue becomes silent, and the logical scene clock excludes background time.
   - Confirm no burst of overdue one-shot cues plays on return.

3. **Screen lock**
   - Lock the screen while audio is active, wait at least 10 seconds, then unlock.
   - Record whether WebView receives visibility/page lifecycle events on this Android version.
   - Confirm the host does not leave the scene clock advancing invisibly.
   - If the product should not play in background, confirm audio is silent while locked.

4. **Resume gesture**
   - If the browser blocks automatic resume, tap the explicit audio control once.
   - Confirm the suspended looping cue resumes at its previous playhead where supported.
   - Confirm a failed resume remains retryable and does not allocate a duplicate voice.

5. **Scene transition and teardown**
   - Switch scenes while a loop and a one-shot cue are active.
   - Confirm the old scene's voices stop and the new scene does not inherit them.
   - Destroy the runtime, then leave and re-enter the screen.
   - Confirm no old audio, event listeners, or duplicate lifecycle callbacks remain.

6. **Repeated lifecycle**
   - Repeat app switch / return at least five times.
   - Confirm each transition produces one pause/resume edge and no cumulative clock drift.
   - Repeat with Bluetooth connected, then disconnect during playback and observe recovery.

## Record results

For each run, record:

- Device / OS / WebView versions:
- Engine commit:
- Audio adapter: Web Audio or HTMLAudio:
- Test step:
- Expected result:
- Actual result:
- Console or host diagnostic output:
- Pass / Fail:

## Acceptance criteria

- No audio continues after scene teardown.
- No duplicate looping voices after repeated resume attempts.
- A denied autoplay/resume is reported and can be retried from a user gesture.
- Background time does not advance the cinematic timeline.
- One-shot cues whose scheduled time elapsed while paused are skipped rather than burst-played.
- Repeated pause/resume and destroy operations do not leak listeners or active voices.

CI currently covers deterministic adapter tests and a Chromium headless scene/DOM smoke test. Passing CI does **not** replace this Android WebView device checklist.
