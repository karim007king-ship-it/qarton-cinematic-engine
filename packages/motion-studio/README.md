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

## Immutable camera keyframe editing

The same package also exports pure project-editing operations:

```js
import {
  addCameraKeyframe,
  updateCameraKeyframe,
  moveCameraKeyframe,
  deleteCameraKeyframe
} from "@qarton/cinematic-engine/motion-studio";

let next = addCameraKeyframe(project, {
  atMs: 1500,
  value: { x: 20, y: -8, zoom: 1.3, rotation: 5 }
});
next = updateCameraKeyframe(next, 1500, { zoom: 1.4 });
next = moveCameraKeyframe(next, 1500, 2000);
next = deleteCameraKeyframe(next, 2000);
```

- Every operation returns a new project and camera array; the input is not changed. Keyframes contain a complete `x`, `y`, `zoom`, `rotation` pose. Updates accept a non-empty partial pose patch.
- Times are safe integer milliseconds within the inclusive project duration. Duplicate times, collisions on move, unknown fields, invalid poses, and missing edit targets are rejected. Bounds match `compileProject`: x/y ±32,768, zoom 0.01–64, rotation ±36,000 degrees.
- Keys are sorted chronologically. Before the first camera key, the engine's identity pose applies. The last key holds through the project end. Deleting the last key removes the optional camera track, yielding identity for the project.
- `validateCameraKeyframes` validates imported camera data without rewriting it. The Motion Studio JSON reader accepts 1–1024 keys, preserving older L4/L5 two-key files and newer multi-key files. Existing start/end controls preserve intermediate keyframes when their endpoint values are edited. Shortening duration retimes the final key if the intermediate keys still fit; if one would collide with or pass the new endpoint, the edit is rejected without changing the active project or deleting keys.
- UI project updates compile a candidate before replacing the active project and compiled frame, so compile failures leave the previous project and preview state in place.
- These APIs organize and validate project data. Sampling and interpolation continue to use the existing `createCameraTrack`/`sampleCameraTrack` and `createTimeline` rules; this package does not add a second animation engine or visual Timeline UI.

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

## StudioSequenceV1 (L11-B)

`createStudioSequenceV1`, `validateStudioSequenceV1` and `compileStudioSequence`
provide a separate immutable multi-scene envelope. Each scene contains one
existing `StudioProjectV1` plus optional audio, character and visual-effects
tracks, all checked with their existing validators. Pass asset metadata through
`assets`; media bytes stay outside the sequence and references must resolve to
assets of the expected kind. Sequences require 1–32 scenes, at most 256 assets,
a shared viewport, valid unique IDs, and a combined duration no longer than
300,000 ms. Each scene keeps the existing project duration bounds.

L11-B supports direct `cut` transitions only. A cut has zero duration and must
join adjacent scenes in their list order; transitions are regenerated after
scene edits. Scene intervals are contiguous and half-open: a scene owns times
from its start up to, but not including, its end. At a shared boundary the
following scene is selected. The final sequence endpoint samples the final
scene endpoint. Seeking outside the sequence clamps to its first or last
sample. Since adjacent scene starts are determined by the cumulative durations,
there is no independent start-time tie to resolve. Sampling uses absolute time,
so seek and replay results do not depend on prior samples.

The immutable edit operations are `addStudioSequenceScene`,
`deleteStudioSequenceScene`, `duplicateStudioSequenceScene` and
`reorderStudioSequenceScene`. A sequence must retain at least one scene.
Deletion leaves asset metadata intact because another scene may still reference
it. Duplicating requires a caller-supplied fresh scene ID; mutable project and
track data is copied while asset IDs remain shared. Use
`legacyStudioProjectToSequence(project, options)` to wrap a legacy single-scene
project. Provide its asset metadata and any sidecar tracks in `options`; the
adapter clones and validates the old data without modifying it.

This core does not render or encode multi-scene video, manage the asset store,
or implement dissolve transitions or UI. Rendering integration remains a
separate phase.
