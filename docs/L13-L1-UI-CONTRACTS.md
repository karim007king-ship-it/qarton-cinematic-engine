# L13-L1 — Easy Studio mobile rebuild: UI contracts and shell

Status: Draft implementation on `feature/motion-studio-easy-mobile-l13l1`, based on PR #143 head `2459e5a6143c1d20226d73a8321f2bbeeb9e477b`. Reconciled with Sol L13-S1 audit on PR #144. PR #144 and Sol's branch were read-only; this implementation is on PR #145.

## Current structure

`examples/motion-studio-lab/studio.js` is the browser composition root and still contains project orchestration, playback/export coordination, UI state, and event wiring. A source scan finds 68 `.addEventListener(...)` call sites in this file. Some attach during rendering and are recreated with their controls; lifecycle listeners include `pagehide`, `pageshow`, and `focus`. The current stable behavior includes project/image open and save, undo, scene CRUD/reorder, playback/seek/replay, camera presets and manual keyframes, characters, audio record/import/music, visual effects, and video export.

The existing engine boundary is already partly modular: Motion Studio model/export/runtime code lives under `packages/motion-studio/`; camera, motion, audio, character, and effects primitives live under `src/`; browser-specific presentation and file pickers live under `examples/motion-studio-lab/`. This L13-L1 shell does not move browser concerns into the engine or change the project schema.

## Initial control and listener inventory

| Domain | Current listener behavior | Contract for L13 |
| --- | --- | --- |
| Navigation / editor mode | Top bar save/undo/export, mode and section selectors, fullscreen | One navigation controller owns section selection and focus restoration; action handlers delegate to domain controllers. |
| Camera / motion | Preset actions, strength/focus inputs, From/To timing fields, undo | A motion controller receives typed user intent and returns project updates; controls never compile/sample frames themselves. |
| Scenes / clock | Add/duplicate/delete/reorder, play/pause/replay, scene and sequence seek | Scene controller owns sequence mutations; playback controller owns clock actions; UI subscribes to state snapshots. |
| Assets / image | Image picker, asset library, project open, import intent/cancel | Asset controller owns picker and asset lifecycle; UI retains labels, progress, and errors. |
| Audio | Record/import/music, clip play/delete, volume/viseme, diagnostics, page lifecycle | Audio controller owns capture/import/storage/playback; its interface reports state snapshots and typed errors. Preserve L12-A2 locks and cleanup. |
| Effects / characters | Add/edit/delete, timeline selection and drag handlers | Domain editors emit validated commands; renderers consume immutable snapshots. |
| Export | Probe/start/cancel, profile controls, progress/error | Export controller owns preflight and cleanup; UI receives progress, result, and error events. |

The scan count is a source inventory, not a claim that each handler is unique or defective. No control will be removed based only on this scan.

## Sol L13-S1 reconciliation and L13-L1 shell

- The shell now has a persistent preview, top save/undo/export actions, a scene thumbnail strip with an add-scene action, and six bottom sections: Scenes, Motion, Audio, Characters, Effects, and Project.
- The simple mode remains the default. Mode selection is inside Project; changing a section does not silently switch to professional mode.
- Character timeline is presented in its own section. Existing scene, project, and export controls remain reachable; technical project/export controls remain in their advanced disclosures.
- This is the L13-L1 shell stage only. It keeps existing DOM IDs and engine/project APIs. It does not claim the full operation-state/controller split or completion of every simplified workflow.
- **EditorState**: selected scene, active section, simplified/professional mode, focus target, and transient busy state. Keep this out of saved project JSON.
- **Domain controllers**: `SceneController`, `MotionController`, `CharacterController`, `AudioController`, `EffectsController`, `ProjectController`, and `ExportController`. Controllers accept commands and return state/results without DOM access.
- **View modules**: section-specific render/update functions subscribe to controller state and update only their own panel. Rendering must preserve focused inputs and pointer capture.
- **Engine adapters**: narrow wrappers call the existing `packages/motion-studio` and `src/` APIs. Do not duplicate sampling, camera, character, effect, audio, or export calculations in views.

## Compatibility and acceptance invariants

1. Existing project files open and save with the current schema; editor mode and selection stay out of project data.
2. Every existing core action remains reachable unless a later approved design explicitly relocates it. No feature is deleted without a reason and approval.
3. The stage stays visible while changing editor sections; only the selected section's settings are presented.
4. Touch targets are at least 44 CSS px; the page shell does not scroll vertically on short Android screens, while long settings can scroll inside their panel.
5. Keyboard focus, Android keyboard state, pointer capture, selection, and pending asynchronous picker targets survive panel updates.
6. Simplified mode is the default; technical controls remain available through a deliberate professional/advanced path.
7. A UI adapter cannot modify the engine clock or project except through validated controller commands.

## Remaining staged work

Continue with section workflow simplification, central busy/operation state, focus and pointer-preserving view updates, and full Android-sized Chromium action coverage in follow-up L13 stages. Sol L13-S1 prototype is a design reference only; it does not prove real microphone capture or replace production editor controls. Keep publication isolated from the existing GitHub Pages origin because its site-wide replacement and shared browser storage would affect unrelated content.
