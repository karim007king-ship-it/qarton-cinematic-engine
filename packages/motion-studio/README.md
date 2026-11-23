# Motion Studio core (S2-B)

Import `compileProject`, `sampleFrame` and `drawFrame` from
`@qarton/cinematic-engine/motion-studio`. The core also lives in a standalone
ES module under this directory. A native browser module host can resolve the
three engine subpath imports with its import map.

```js
const project = {
  version: 1,
  durationMs: 3000,
  viewport: { width: 720, height: 1280, fps: 24 },
  layers: [{ id: "portrait", assetId: "photo", z: 0 }],
  camera: [
    { atMs: 0, value: { x: 0, y: 0, zoom: 1, rotation: 0 } },
    { atMs: 3000, value: { x: -18, y: 10, zoom: 1.2, rotation: 0 } }
  ]
};
const compiled = compileProject(project, new Map([["photo", decodedImage]]));
drawFrame(canvas.getContext("2d"), sampleFrame(compiled, 1500));
```

- Use a dedicated 2D canvas with matching backing dimensions and no host clip.
  Each image fills the viewport rectangle. Fit and cropping can be prepared by
  the host. Draw order is ascending signed 32-bit integer `z` with ties in
  input order. Each layer moves around the viewport center, then the camera
  moves the composed scene around the same center. Positive x/y moves content
  right/down. Positive rotation is clockwise in Canvas coordinates.
- Dimensions are positive integers up to 4096 each and 8,388,608 pixels total.
  FPS is 1–60, duration is 1–300,000 integer milliseconds, and the project has
  1–64 layers. Optional camera and layer tracks contain 1–1024 strictly
  increasing integer times in the inclusive project interval. The identity
  applies before the first key. The last key holds through the end. Bounds
  are ±32,768 pixels, zoom 0.01–64 and rotation ±36,000 degrees. Sampling
  clamps finite times to the project interval and accepts fractional
  milliseconds, for example `1000 * frameIndex / fps`.
- Layer IDs are unique. Layer and asset IDs are opaque ASCII alphanumeric,
  underscore and hyphen tokens, start with a letter or digit, and contain
  at most 64 characters. Filesystem paths, URLs and unknown fields are rejected.
- S2-B binds already decoded image sources through synchronous `get(id)`,
  once for each referenced ID. This narrows the S1 Blob provider contract.
  The host owns loading, decoding, disposal and image budgets. Use stable
  image sources for repeatable drawing. Sampling and drawing load no assets,
  dispatch no timeline events, and manage no playback, audio or storage.
  Face/voice schema fields and video encoding are reserved for later phases.
