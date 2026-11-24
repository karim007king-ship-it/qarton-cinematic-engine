# Motion Studio L11-D multi-scene editor

The editor uses `StudioSequenceV1` as the source of truth for ordered scenes,
per-scene project data, shared asset identifiers, and the total sequence clock.
Scene names remain editor metadata keyed by scene ID; they do not change the
L11-C sequence schema. Project JSON stores this metadata in a versioned
`qarton-motion-studio-sequence-project` envelope. Existing single-scene project
JSON continues to load through the legacy project parser.

## Scene and timeline behavior

- A project contains at most 32 scenes. Each scene duration is 3–60 seconds;
  the sequence core validates the cumulative duration limit.
- The scene strip offers select, add, duplicate, delete, and adjacent reorder
  controls sized for touch input. The final scene cannot be deleted.
- The selected scene's existing timeline is local to that scene. The project
  timeline lays scenes end-to-end and transitions between them with zero-duration
  Cuts.
- Seek uses absolute sequence time. At an exact scene boundary, the following
  scene is selected at local time zero. The sequence sampler clamps at the end
  of the project. Replay returns to the first scene and starts from time zero.
- Play, pause, and seek use one monotonic sequence clock; scene-local audio and
  visual samplers receive the corresponding local time. Seeking while playing
  resets the clock origin at the requested sequence time.

## Shared assets and persistence

Image, audio, and character sprite references use the sequence asset registry.
Bytes stay in device-local IndexedDB and are not embedded in JSON. Projects
opened on another device can retain asset identifiers and metadata while asking
the user to relink missing local files. The registry blocks deletion whenever
any scene references an asset. Sequence edits are serialized through the
persistence adapter so replacement and removal do not race storage writes.

## Export boundary

This change adds multi-scene editing and preview. It does not change the
existing L10 integrated export or L5 video-only export paths; export remains
limited to the selected single scene until a separately designed sequence
export implementation is approved.
