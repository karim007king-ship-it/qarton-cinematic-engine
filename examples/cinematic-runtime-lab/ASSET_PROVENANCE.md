# L14-C3 character art provenance

The four bundled character portrait sprites in `characters/` were newly generated for this QARTON preview with OpenAI image generation on 2026-11-27. Their character names and IDs are Layla (`layla`), Youssef (`youssef`), Nour (`nour`) and Salim (`salim`). The alpha-channel WebP files are original generated artwork, not downloaded, traced, or derived from an existing anime or film character. They are included only as preview/demo assets; replace them with approved production art before shipping a commercial title.

No external stock images, font files, runtime image API, model download, paid asset service, or third-party code dependency is used by the preview. Scenic backdrops are drawn by the project code. Imported user artwork stays in browser memory for the current session.

## Import formats and names

- One transparent `PNG` or `WebP` file imports as a full character portrait.
- A multi-layer character uses names like `layla__body.png`, `layla__head.png`, `layla__hair_back.webp`, `layla__eye_left.png`, `layla__eye_right.png`, `layla__brow_left.png`, `layla__brow_right.png`, and `layla__mouth__round.webp`.
- Supported parts: `body`, `head`, `hair_back`, `hair_front`, `eye_left`, `eye_right`, `brow_left`, `brow_right`, `eyes`, `brows`, `mouth`, `hand_left`, `hand_right`. Parts may be suffixed with an expression (`happy`, `sad`, `angry`, `afraid`, `surprised`, `thinking`, `determined`), view (`front`, `side`), pose (`pose1`, `pose2`) or mouth shape (`open`, `round`, `wide`, `teeth`, `closed`, `rest`). For example, `layla__mouth__round__side.webp` is the side-view round mouth.
- Layer name prefix is the stable character ID. The current character must match it.
- Character records set `facing`, `pose`, layer position, size, per-part pivot and z order. Coordinates are normalized from 0 to 1 on the character bounds. Front and side face rigs can use independent `view` values.
- The Runtime enforces a 12-megapixel unique decoded-image budget and a Canvas backing-pixel budget. Transition surfaces are reduced to fit the same Canvas budget.

Each bundled story sprite is one complete portrait containing already-drawn facial features. It is intentionally face-static in the Runtime: the renderer does not add approximate eyes or mouth overlays to an uncalibrated image. For facial motion, an artist must supply separately segmented, transparent layers with independent eye, brow, and mouth anchors plus all five mouth variants for the authored view.

The isolated `layered-character-test.html` page uses original transparent SVG body, head, rear/front hair, independent left/right eye and brow layers, hands, and five mouth layers authored in this repository. It exercises four stable actor IDs and front/side anchor sets. No external source artwork or third-party font is embedded in that fixture. These shapes test renderer alignment and variant selection; they are not final licensed production character art.

## Importing a calibrated face rig

Import transparent PNG/WebP face parts together with [`FACE_RIG_MANIFEST.example.json`](FACE_RIG_MANIFEST.example.json). A face needs the head base, two independently exported eyes, two brows, and separate closed/open/round/wide/teeth mouth images. Each part needs normalized bounds and a pivot. Provide a separately drawn side-view set and give those file entries `"view": "side"` in the manifest. Animation remains disabled until the selected view has every required anchored part and all five mouth poses.
