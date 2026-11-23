# CinematicEffectsV1

`compileCinematicEffects(project)` validates and freezes plain JSON data. `sampleCinematicEffects(compiled, timeMs)` is a pure absolute-time sampler; repeated samples at the same time produce equal values. `createCinematicEffectsPlayer` delegates transport timing to the existing Scene Clock. `drawCinematicEffects(ctx, sample, assets)` paints a sample to a Canvas 2D context and returns the sampled shake offset for a host that also renders actors. Preview and video export remain host responsibilities.

## Project shape

```js
{
  version: "CinematicEffectsV1",
  width: 720, height: 1280, durationMs: 6000, seed: 12,
  camera: [{ atMs: 0, x: 0, y: 0, zoom: 1, rotation: 0 }],
  layers: [{ id: "sky", assetId: "sky-image", z: 0, depth: 0.2,
    x: 0, y: 0, speedX: -2, speedY: 0, color: "#26384a" }],
  clips: [{ id: "fade-in", type: "fade", atMs: 0, durationMs: 700,
    easing: "easeInOutCubic",
    from: { opacity: 0, color: "#000000" },
    to: { opacity: 1, color: "#000000" } }]
}
```

Dimensions, scene/clip/camera timestamps, clip durations, z order, and seeds must be safe integers. Dimensions are limited to 1–4096 pixels per side, scene duration to 1 ms–1 hour, project/clip seeds to ±1,000,000. Camera position is limited to ±4096 px, zoom to 0.1–8, and rotation to ±180°. Layer depth is ±4, velocity ±1000 px/s, and z order ±10,000. Clip starts and durations must fit inside the scene; zero-duration non-shake clips apply their final value at that timestamp, while a zero-duration shake is a one-sample pulse. Fractional scene sample times and subpixel camera/layer motion remain supported for smooth playback. IDs are unique within their respective lists.

Each object has a closed schema: unknown keys, null optional values, missing channel values, and extra `from`/`to` channel keys are rejected before compilation. The compiled project, clip records, channel maps, camera track, and layer records are frozen snapshots.

## Clip channels

All clips interpolate from/to values linearly unless `easing` is `easeInOutCubic` (the shared easing helper). Colors use `#RRGGBB` and switch at the midpoint.

| Type | `from` and `to` fields | Behavior |
|---|---|---|
| `fade` | `opacity` 0–1, `color` | Scene overlay from opaque to clear or reverse |
| `dissolve` | `progress` 0–1, `color` | Seed-independent 12×12 ordered color reveal, bounded to 144 cells |
| `vignette` | `intensity` 0–1 | Radial edge darkening |
| `letterbox` | `ratio` 0–0.2 | Black top and bottom bars as a fraction of scene height |
| `shake` | `amplitude` 0–64, `frequencyHz` 0–60, `seed` ±1,000,000 | Deterministic camera offset sampled using clip-local time plus project seed |
| `flash` | `intensity` 0–1, `color` | Screen-space color flash |
| `tint` | `strength` 0–1, `color` | Screen-space color tint |

Layers are sorted by `z` and stable `id`; background position combines authored offset, velocity×scene-time, and the shared parallax calculation from camera position and depth. The renderer transforms scene layers using the shared camera pose and draws screen-space lighting/transition overlays after restoring that transform. Callers may resolve `assetId` to `CanvasImageSource` objects; missing asset mappings use the layer's solid color.

The core allocates samples rather than frame buffers. The lab's 390×690 RGBA canvas holds about 1.03 MiB of raw pixels; actual browser backing memory can be larger due to device scale and compositor copies. It allocates no persistent offscreen canvas. Dissolve work is fixed at 144 rectangles per rendered frame. Very high resolution, many asset-backed layers, or multiple concurrent canvases can exceed entry-level phone memory or frame budgets; downscale the preview and avoid retaining duplicate image bitmaps on Android.

Canvas 2D is the only required renderer. The dissolve is a coarse ordered reveal and the vignette is a single gradient; these intentionally avoid per-pixel image processing, WebGL, and extra rendering dependencies. Export formats, audio, asset loading, and integration of actors outside the returned camera pose stay with the host.
