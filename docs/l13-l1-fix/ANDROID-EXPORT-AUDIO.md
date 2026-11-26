# L13-L1 Android export and microphone findings

## Microphone access

Motion Studio requests the microphone through `navigator.mediaDevices.getUserMedia` directly from the record-button gesture. Do not infer security from the `content://` scheme alone: the HONOR 400 Pro report for `content://com.hihonor.filemanager.share.fileprovider` recorded `secureContext: true`, `getUserMedia: true`, and `mediaRecorder: true`. Its concrete failure was `microphonePermission: denied`; that is an Android/browser permission denial, with a separate `AudioContext` state of `not active`. The UI now distinguishes denied permission, prompt denial, source policy/security restrictions, timeout, missing hardware, and capture-busy errors, and retains the original DOMException name and message in the on-device report.

After a permission denial, open Android Settings → Apps → the app/browser that opened Motion Studio → Permissions → Microphone → Allow. If the editor is running in a browser tab, also open the site's permissions and allow Microphone. Return to Motion Studio and use **أعد المحاولة**. If permission is denied by a parent frame or WebView policy, open the HTTPS editor directly in the browser or enable microphone access in the host app's WebView permission handler. A report with `secureContext: true` and `getUserMedia: true` does not itself grant microphone access.

The diagnostic report stays on the device: it is not uploaded or sent to a server. Clipboard denial now selects the report text for manual copy; the user can also save it locally as TXT or JSON. A separate HTTPS origin is used for the full editor rather than the shared project Pages origin.

## PCM working budget

The exporter keeps the 32 MiB decoded PCM limit. It now plans only audible clips overlapping the selected export interval, deduplicates shared asset IDs, and estimates each requested source span. It decodes one compressed source at a time, includes the full decoder output and retained cropped ranges in the peak budget, copies only the required range into the retained buffer, and releases the full decode before decoding the next source. Unreferenced, muted, zero-master-volume, and out-of-range assets are not resolved or decoded.

The Web Audio `decodeAudioData` API still decodes the compressed source as a whole. A single very large source can therefore exceed the safe working budget before a crop is possible. The exporter rejects that case with a specific message; it does not raise the limit, remove audio, or claim progressive codec decoding. True partial compressed decoding would require a streaming demux/decode path and is not part of this patch.

## Retention and compatibility

Repeated clips and scene references to the same asset share one decoded/cropped buffer. Legacy projects continue to use their existing audio tracks and defaults. Projects without audio still export without allocating PCM. The requested export range is passed to both sequence decoding and scheduling so preview/export timestamps remain aligned.

## Verification boundary

Node tests cover range planning, repeated/shared assets, selected-range cropping, long sources, unused assets, cancellation cleanup, and multi-scene timing. The CI Chromium microphone/import and IndexedDB checks are enabled for PR #145. Those checks do not prove microphone behavior on the HONOR 400 Pro; the independent HTTPS preview must still be exercised on that phone.
