# Android WebView validation

This repository includes a standalone, dependency-free diagnostics page at
`examples/android-webview-diagnostics.html`.

## Run on a target phone

1. Serve the repository over HTTP(S) from a development machine or a trusted
   static host. Do not open the file through an opaque file-provider URL if the
   host application applies a restrictive WebView origin policy.
2. Open `/examples/android-webview-diagnostics.html` inside the Android
   application's actual WebView, not only in Chrome.
3. Tap **Run compatibility checks** and review the raw report.
4. Tap **Test HTMLAudio**. Confirm the sample starts, then use **Pause / resume
   HTMLAudio** to verify the media element can be paused and resumed.
5. Tap **Test Web Audio**. Audio is deliberately initiated only by this user
   gesture because Android WebView may suspend or reject playback without it.
6. Background the app, return to it, and inspect the recorded
   `visibilitychange`, `pagehide`, and `pageshow` events. HTMLAudio is paused
   when the page becomes inactive; resume it with the button after returning.
7. Copy the report or manually select the JSON if clipboard access is denied.

## What it checks

- Android/WebView user-agent hints (informational only; user-agent strings vary).
- ES module/Promise support, AbortController and abort event delivery.
- requestAnimationFrame, Page Visibility, matchMedia and reduced-motion query.
- Web Animations API availability, CSS transition execution, transform/filter.
- Image.decode() or the image-load fallback, including inline SVG decoding.
- Canvas 2D, HTMLAudio capability and Web Audio API availability.
- HTMLAudio playback from a five-second locally generated WAV sample, long enough to test pause/resume manually and observe natural completion.
- Web Audio resume/playback initiated from a tap, AudioContext state changes, and sample completion.
- Optional hardware concurrency, device-memory and JS-heap hints when exposed by the browser; these are not native RAM or GPU measurements.
- Page visibility and page lifecycle events, plus viewport and device-pixel ratio. The diagnostic pauses HTMLAudio and suspends Web Audio when the page becomes hidden; returning to foreground does not auto-resume either API, so use the explicit audio buttons again.
- A short foreground requestAnimationFrame sample: average FPS, p95 frame interval, and proportion of intervals above 25 ms.

A capability being present does not prove that every engine feature behaves
correctly under load. In particular, this page does not benchmark GPU memory,
long-running animation stability, audio focus interruptions, or the host app's
native lifecycle callbacks. Those require a device-specific integration test. The frame sample is a quick diagnostic, not a controlled benchmark; run it under the actual scene workload and compare repeated reports. AudioContext is never resumed automatically after backgrounding; tap the audio test again to verify foreground recovery.

## Evidence boundary

The page is a manual diagnostic instrument. A successful Node test or desktop
Chromium run is not evidence that a particular Android WebView passed. Record
the Android version, System WebView provider/version, device model, and the
exported report when validating a physical device.
