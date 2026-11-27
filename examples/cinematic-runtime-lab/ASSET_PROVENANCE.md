# L14-C3 character art provenance

The four bundled character portrait sprites in `characters/` were newly generated for this QARTON preview with OpenAI image generation on 2026-11-27. Their character names and IDs are Layla (`layla`), Youssef (`youssef`), Nour (`nour`) and Salim (`salim`). The alpha-channel WebP files are original generated artwork, not downloaded, traced, or derived from an existing anime or film character. They are included only as preview/demo assets; replace them with approved production art before shipping a commercial title.

No external stock images, font files, runtime image API, model download, paid asset service, or third-party code dependency is used by the preview. Scenic backdrops are drawn by the project code. Imported user artwork stays in browser memory for the current session.

## Import formats and names

- One transparent `PNG` or `WebP` file imports as a full character portrait.
- A multi-layer character uses names like `layla__body.png`, `layla__head.png`, `layla__hair_back.webp`, `layla__eyes.png`, `layla__brows__angry.png`, and `layla__mouth__round.webp`.
- Supported parts: `body`, `head`, `hair_back`, `hair_front`, `eyes`, `brows`, `mouth`, `hand_left`, `hand_right`. Parts may be suffixed with an expression (`happy`, `sad`, `angry`, `afraid`, `surprised`, `thinking`, `determined`), view (`front`, `side`), pose (`pose1`, `pose2`) or mouth shape (`open`, `round`, `wide`, `teeth`, `closed`, `rest`).
- Layer name prefix is the stable character ID. The current character must match it.
- An optional `characterId.character.json` file can set `facing`, `pose`, face anchor, layer position, size, pivot and z order. Start from `character-layer-manifest.example.json`. Coordinates are normalized from 0 to 1 on the scene bounds.
- The browser validates PNG/WebP decoding and bounds decoded pixel dimensions. Imported character images share a 12-megapixel decoded-memory budget across the session. Large uploads are rejected before the renderer retains them.

Each generated bundled sprite has one portrait layer. The renderer supports independently imported face/body/hand/hair layers and expression/viseme variants; these preview portraits do not contain separated artwork parts. For production skeletal motion, an artist must supply correctly segmented and pivot-aligned transparent layers or alternate poses.

The Chromium multi-layer regression derives distinct body/head crops from the bundled Layla WebP at test time so it exercises the importer and layer renderer with real anime pixels without pretending the full portrait is two separate production layers. It is test-only and is not included as an authored animation asset.
