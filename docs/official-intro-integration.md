# Official QARTON intro — integration contract

Approved source file: `1000040710.mp4` (confirmed by project owner on 2026-11-21).
SHA-256: `6b22dbc843affed208e066cb6c68044779683594e9826a52cb1f1619a53fe2ff`.
Duration: approximately 4.9 seconds.

**Important:** The MP4 is NOT stored in this repository yet. This PR adds the reusable player only.
Do not replace it with the older `VN20261117_140724.mp4` or a different file without explicit confirmation.

The host must first publish the approved video as an asset (e.g. `assets/qarton/official-intro.mp4`) and verify its SHA-256.

```js
import { createOfficialIntroPlayer } from './src/runtime/official-intro-player.js';
// Include src/runtime/official-intro.css in the host page.
const player = createOfficialIntroPlayer({
  mount: document.body,
  src: './assets/qarton/official-intro.mp4',
  onComplete: () => openGameHome()
});
await player.start();
```

The host owns when the intro appears and should ensure `openGameHome()` is called only once.
The player resolves on ended, skipped, missing source, playback error, or 10-second timeout.
If autoplay is blocked, the user can tap Play or Skip. Do not invoke it automatically on every route change.
For Android WebView, use a compatible asset URL and configure media playback appropriately.
Keep the game home accessible even if the MP4 cannot load.

Next before shipping: upload the approved binary, check its digest, run browser/mobile tests,
then integrate into Carthage and FM4 individually behind a feature flag.
