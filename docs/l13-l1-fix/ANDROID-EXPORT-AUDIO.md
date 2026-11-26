# L13-L1 Android export and microphone findings

## Microphone access

Motion Studio requests the microphone through `navigator.mediaDevices.getUserMedia` from the record button. Android's `content://` document picker is not a secure web origin, so the browser may omit `getUserMedia` entirely even when Android's microphone permission is granted. Imported files continue to work through the picker. Direct recording needs an HTTPS origin (or an app WebView that explicitly exposes secure media capture); granting the OS permission alone does not change the origin's secure-context status.

## PCM working budget

The exporter keeps the 32 MiB decoded PCM limit. It now plans only audible clips overlapping the selected export interval, deduplicates shared asset IDs, and estimates each requested source span. It decodes one compressed source at a time, includes the full decoder output and retained cropped ranges in the peak budget, copies only the required range into the retained buffer, and releases the full decode before decoding the next source. Unreferenced, muted, zero-master-volume, and out-of-range assets are not resolved or decoded.

The Web Audio `decodeAudioData` API still decodes the compressed source as a whole. A single very large source can therefore exceed the safe working budget before a crop is possible. The exporter rejects that case with a specific message; it does not raise the limit, remove audio, or claim progressive codec decoding. True partial compressed decoding would require a streaming demux/decode path and is not part of this patch.

## Retention and compatibility

Repeated clips and scene references to the same asset share one decoded/cropped buffer. Legacy projects continue to use their existing audio tracks and defaults. Projects without audio still export without allocating PCM. The requested export range is passed to both sequence decoding and scheduling so preview/export timestamps remain aligned.

## Verification boundary

Node tests cover range planning, repeated/shared assets, selected-range cropping, long sources, unused assets, cancellation cleanup, and multi-scene timing. The CI Chromium microphone/import and IndexedDB checks are enabled for PR #145. Those checks do not prove microphone behavior on the HONOR 400 Pro; the independent HTTPS preview must still be exercised on that phone.
