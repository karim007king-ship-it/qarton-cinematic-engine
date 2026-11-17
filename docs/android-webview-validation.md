# Android WebView Validation Protocol

Status: manual device protocol. This document does not claim that a CI or emulator result is a physical-device pass.

## Target device

Record the exact device, Android version, WebView provider/version, app build, engine commit, and test date before each run. For the current validation campaign, the target is the HONOR 400 Pro running Android 17.

## Rules

- Use the diagnostics build or a dedicated host app; do not modify Carthage saves or production story state for this test.
- Do not force-stop or swipe away the app between background and foreground steps. That resets the in-process evidence and is not a lifecycle test.
- Start playback only through the page's explicit user-gesture control.
- Test HTMLAudio and Web Audio independently.
- Capture the generated diagnostic report after returning to the app. A fresh launch report cannot prove what happened during backgrounding.

## HTMLAudio active-playback test

1. Launch the diagnostics app and wait for capability checks to finish.
2. Start the five-second HTMLAudio sample using its play control.
3. Immediately press Home while playback is active; do not close the app.
4. Wait until the sample would naturally have ended, then return through Android Recents.
5. Export the report.
6. Repeat with a looping/long-running sample if the host provides one.

Expected evidence:
- A background visibility/page lifecycle event is recorded.
- The active HTMLAudio element is paused while hidden.
- No automatic playback occurs merely because the app becomes visible.
- A new explicit user gesture can start or resume playback according to host policy.
- No duplicate voice remains after repeated background/foreground cycles.

## Web Audio active-playback test

1. Launch the diagnostics app and start the eight-second Web Audio sample through its explicit play control.
2. While the AudioContext is running and the sample is audible, press Home.
3. Wait several seconds, then return through Android Recents without force-stopping.
4. Export the report.
5. Repeat once with screen lock/unlock if the device permits the test without terminating the app.

Expected evidence:
- The report records that interruption occurred while playback was active.
- The AudioContext transitions to `suspended` while backgrounded (or records a specific platform error explaining why it did not).
- The sample does not silently restart or continue from an unintended position on foreground return.
- Resume is attempted only after an explicit user gesture when required by the WebView.
- The report distinguishes a successful resume from a rejected resume; a rejected resume must preserve enough state for a later retry.

## Repetition and cleanup

- Perform at least three Home/Recents cycles for each audio API.
- Navigate away from and back to a test scene repeatedly; verify there are no duplicate audio voices, lifecycle listeners, or scene DOM nodes.
- Test pause during an asynchronous character/sprite update; the cinematic clock and audio cue cursor must not advance while paused.
- Test a rejected audio resume followed by a successful gesture-driven retry; verify the playhead does not jump to the beginning.
- Test screen lock/unlock separately from Home/Recents; do not treat one as proof of the other.

## Result classification

Mark each API independently as:
- **PASS**: the expected lifecycle and audio-state evidence is present in the same uninterrupted app session.
- **FAIL**: the report contradicts an expected behavior or shows duplicate playback/resource leakage.
- **INCONCLUSIVE**: playback was not active at background time, the app was force-stopped/restarted, lifecycle events are missing, or the report was not exported after returning.

A capability check, foreground FPS sample, Node test, headless Chromium run, or successful manual play/pause/resume control is not by itself a physical Android background/foreground pass.

## Report fields to retain

Keep the raw report and record:
- device and OS/WebView versions;
- app/diagnostics build and engine commit;
- API under test (HTMLAudio or Web Audio);
- whether playback was confirmed active before pressing Home/locking;
- lifecycle event sequence and timestamps;
- audio state before background, while hidden if observable, and after return;
- resume result and whether a user gesture was used;
- final classification and any console/native errors.
