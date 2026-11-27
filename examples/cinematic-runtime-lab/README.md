# Cinematic Runtime Lab

Offline five-scene Tunisian interactive story using the host-independent QARTON Cinematic Runtime. Start at `index.html`. For strict `file://` browsers use the standalone single HTML build. No microphone, `AudioContext`, remote service, network asset, or Motion Studio element is used.

The host renders through the reusable `CinematicRenderer` and its existing character/effects cores. `layered-character-test.html` is a separate offline visual fixture that composes transparent SVG layers and shows closed/open/round/wide/teeth mouth variants.

- Opening family scene branches to the city gate or harbor.
- Both paths meet at the confrontation and continue to the dawn scene.
- The last choice selects one of two experimental endings.
- Save and restore use browser localStorage and the JSON Runtime checkpoint.
- The event panel records mock game/music adapter calls only.

Art sources and preview limitations: `ASSET_PROVENANCE.md`. Story contract: `../../docs/CINEMATIC_RUNTIME.md`. Data: `story.json`.
