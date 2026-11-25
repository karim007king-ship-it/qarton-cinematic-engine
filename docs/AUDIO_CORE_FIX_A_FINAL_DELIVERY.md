# AUDIO-CORE-FIX-A — Final Delivery

This follow-up branch is based on PR #141 at b07f856ade5080a193d89001a58bff5136dac4b7. It preserves the recording, duration persistence, and preview/export fixes already implemented there. Its workflow changes enable those same checks and a uniquely named Android preview artifact for a Draft PR stacked on PR #141.

## Verified audio path

- Chromium's virtual microphone records through getUserMedia and MediaRecorder; the test decodes the resulting WebM/Opus and MP4 audio with FFmpeg and measures duration, RMS signal, and dominant tone.
- The captured recording is validated, imported through the normal audio asset path, and inserted into the selected Timeline track. Its measured duration is retained in project metadata when the container does not report a finite duration.
- The recording is saved and reopened; restored preview playback and exported video audio are measured from decoded samples. The export path verifies the signal itself rather than treating a successful MP3 import as proof of microphone capture.

## Existing PR #141 validation

The latest PR #141 checks at b07f856ade5080a193d89001a58bff5136dac4b7 completed successfully:

- Node: 379 tests passed.
- Virtual microphone: WebM decoded to 1.800 s with RMS 0.2614 and 660 Hz; MP4 audio decoded to 1.720 s with RMS 0.2077 and 660 Hz.
- Timeline insertion: 1832 ms. After save/reopen, preview signal measured RMS 0.6206 at 662 Hz.
- Exported WebM: 6.000 s with decoded audio RMS 0.3200 at 660 Hz.
- Motion Studio Android Preview and virtual microphone/signal GitHub Actions both passed and uploaded artifacts.

## Android constraints

- Direct microphone capture requires a secure origin (HTTPS, or an Android WebView configured to grant microphone access and expose getUserMedia) plus the user's microphone permission. Permission denial, unavailable input devices, insecure origins, and unsupported recorder formats surface errors.
- Android's file picker remains the supported route for local content:// audio files. The browser must be able to decode the selected media during preview/export.
- Standard Chromium MediaRecorder does not provide AMR recording. The app selects only a format reported as supported; AMR conversion is outside this change.
- GitHub's virtual microphone and Chromium checks verify the browser pipeline, not device-specific HONOR/WebView permission prompts, codecs, latency, or memory pressure. Those still need a physical Android check.

## Scope

No game files, PR #141 branch, video recorder core, or audio-mixing implementation are changed. This task does not start L10 work.
