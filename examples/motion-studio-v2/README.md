# QARTON Motion Studio V2 — L14-A standalone Android preview

This prototype keeps `index.html`, `app.css`, and `app.js` separate for development. Run `python build_standalone.py --commit <full-sha>` to inline them into `dist/qarton-motion-studio-v2.html`.

The generated HTML contains its CSS and JavaScript, has no external file dependencies, and can be opened directly after extracting the preview ZIP, including from Android's `content://` file picker. The visible Commit label identifies the source revision used for the build.

## Offline validation

Run `python check-prototype.py` after installing Playwright and Chromium. It builds the standalone document, rejects missing/empty CSS or JavaScript, blocks HTTPS requests, checks CSS application and JavaScript readiness, and exercises demo controls at five phone widths.

## Prototype limits

Image preview, playback, scene selection/addition, motion, effects, and audio filename selection are UI demonstrations. Save, undo, export, and microphone recording are not connected to the engine. Engine integration waits for design approval.
