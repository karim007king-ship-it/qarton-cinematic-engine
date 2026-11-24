# L11-A — Multi-scene Motion Studio architecture (draft)
Baseline: PR #126, 99764b17. Preserve StudioProjectV1 and existing single-scene export API.

## Contract
Introduce a separate StudioSequenceV1 envelope: {version:1, kind:"studio-sequence", viewport:{width,height,fps}, scenes:[{id,project,audioTracks,characterTracks,visualEffectsTrack}], assets:[{id,kind,name,mimeType,size}], transitions:[{fromSceneId,toSceneId,type,durationMs}]}. Track payloads must reuse existing validators; exact editor serialization adapters must be audited before implementation. Asset bytes remain outside JSON, referenced by opaque IDs. No network URLs or filesystem paths. Unique IDs, strict fields, safe integer durations, shared viewport, bounded counts (initially 32 scenes, 256 assets, total 300000 ms; UI export limits remain unchanged). Validate references and reject invalid or missing assets before export. Legacy projects open via an explicit single-scene adapter; original data is not mutated.

## Timeline
Compile scene intervals once. Cuts are half-open, final endpoint samples final scene end. Dissolve overlaps adjacent scenes by duration; total duration is sum minus overlaps. Reject nonadjacent transitions, duplicate pairs, overlaps consuming an entire scene or causing triple overlap. At global time t return active scene IDs, local times and linear blend weights. Preview and export use the same pure sampler; seek/replay must be deterministic. Start with cuts, add dissolve only after cut integration passes. Render overlap using bounded reusable surfaces; do not compile or decode all images without a budget.

## Assets and editing
Shared asset registry with stable IDs, reference counting for deletion checks, explicit relink, local Blob storage adapter; never delete referenced assets implicitly. Duplicate scenes get fresh scene IDs and independent mutable editor metadata while sharing asset IDs. Reorder/delete transactions validate or explicitly remove affected transitions. Preserve undo and selection; lock edits during export. No persistence migration in place; export/import versioned JSON plus separate local asset handling. Android touch UI must avoid horizontal page overflow.

## Export
Keep L10 recorder and shared AudioContext clock. Add a sequence adapter producing global render samples and flattened audio clip intervals; namespace track/clip IDs by scene. Deduplicate audio by asset ID, retain PCM/compressed budgets, account for overlap gains and clip offsets. Do not concatenate recorded blobs. Cut first; dissolve audio crossfade requires explicit gain envelopes and measured tests. One recorder session, one frozen snapshot, no new recorder per scene. Existing output caps, cancellation and cleanup apply.

## Implementation gates
L11-B: pure sequence validation, legacy adapter, interval compiler and cut sampler; Node tests for boundaries, reorder, invalid IDs, missing refs, immutability and total duration.
L11-C: asset registry and storage adapter; tests for deduplication, relink, referenced deletion, quotas and cancellation.
L11-D: touch scene list, add/duplicate/reorder/delete, local/global time navigation, stable selection; Chromium pointer tests.
L11-E: integrated cut export, then dissolve compositor and audio envelopes; measured Chromium output markers around boundaries, seek, cancellation, Android 720p test. No main merge or game changes. Each gate gets independent draft review. L10 long-duration and low-memory physical tests remain outstanding.
