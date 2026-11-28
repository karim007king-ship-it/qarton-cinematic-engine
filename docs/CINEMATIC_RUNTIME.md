# QARTON Cinematic Runtime

## Production Canvas renderer

`CinematicRenderer` (`src/runtime/cinematic-renderer.js`) is the reusable Canvas host for `CinematicSceneV1` frames. It composes the existing `drawTextCinematicScene` and `drawLayeredCharacter` implementations, the shared camera sampler, and the existing cinematic director/effects compositor. It is not an editor dependency; the host passes a Canvas, a Runtime frame and decoded local assets.

```js
import { CinematicRenderer, createCinematicStoryRuntime } from "@qarton/cinematic-engine";
const renderer = new CinematicRenderer(canvas, { quality: "medium" });
const runtime = createCinematicStoryRuntime({ scenes, render: frame => renderer.render(frame), transition: p => renderer.transition(p) });
```

The renderer draws background layers in authored z order with `cover`, `contain`, or `fill`, then uses the existing text-scene character path. `contain` fills the matte with a subdued cover crop of that same image, avoiding accidental black bars. `characterAssets` from Runtime provide decoded full images or role/variant layers. Camera translations and effect samples are scaled from the canonical 720×1280 coordinate space to the actual Canvas dimensions, including landscape and 4:3 canvases. `quality` controls image smoothing (`low`, `medium`, `high`). `maxCanvasPixels` is enforced at construction, and transition endpoints are downsampled so the main Canvas plus both temporary surfaces remain within that pixel budget. A separate `maxDecodedPixels` limit (12 MP by default) is enforced on unique decoded images at render time.

Layer layout anchors are normalized in the full character box. Head, hair, each eye, each brow, and mouth share the authored head pivot; hand pivots sit at the wrist. Front and side rigs can supply separate transparent layers and anchors with `view: "front"` or `view: "side"`. Facial animation is enabled only when the selected view has explicit anchor bounds and pivots for the head, both eyes, both brows, and all five mouth poses. Incomplete rigs have facial overlays and facial motion disabled; a full portrait is never painted over with guessed features or a skin-colored mouth patch. `renderer.metrics.lastDraw.characterGeometry` exposes the resolved anchors, pivots, order, rotation, and per-character `faceRigValid` status.

`renderer.transition({from,to,type,durationMs})` renders transition endpoints with the same scene renderer and supports `cut`, `crossfade`, `through-black`, `through-light`, and `focus`. `dispose()` cancels active transition frames and rejects subsequent draws. The Runtime provides `frame.isCurrent()` so asynchronous hosts can ignore superseded frames.

Full-image portraits keep their original, static faces until a complete transparent facial rig is supplied. The layered visual test page uses locally authored transparent SVG fixtures with independently anchored eyes, brows, and all five mouth variants in front and side views. These fixtures validate compositor geometry and pose selection only; they are not final character art.

## Rendering and event guarantees

Runtime `render()` calls are serialized. A scene-generation token prevents old frames from notifying state or being submitted after a scene change, and every submitted frame has an `isCurrent()` guard. Hosts should check that guard after their own asynchronous work. Event adapters receive a stable `eventKey` (`sceneId:eventId`); external side effects must persist this key idempotently if they need safe retry across process restarts. Story seek/replay changes visual time and does not replay story events. A confirmed choice emits its idempotency key before the transition; if its target mount fails, the choice remains pending and can be retried with the same key.

Restore validates the complete candidate state before loading and only installs saved choices and event ledger after the target scene assets and transition succeed. A failed asset load leaves the prior scene/save state active. Adapters should treat scene/music synchronization as idempotent by scene ID because external adapter failure cannot be rolled back by a local JSON save.

## Scope and architecture

`createCinematicStoryRuntime` is a host-independent playback service. It reuses `compileTextScene` and the text-viseme compiler, `createSceneClock`, camera sampling, `sampleCinematicDirector`, `SceneTransitionManager`, the existing `AssetManager` URL cache, and the existing timeline event ordering. Motion Studio is only one possible authoring environment; the Runtime takes plain JSON plus host adapters and never queries Studio DOM nodes. The example host is `examples/cinematic-runtime-lab/` and all of its assets are local.

The Runtime has no audio dependency. It does not create `AudioContext`, request microphone access, or play a human recording. The `music` adapter receives intent only. `game`, `music`, and `language` adapters in the Lab are mocks for contract testing, not integrations with the QARTON game, music, or language engines.

## CinematicSceneV1 contract

The JSON Schema is in [`docs/schemas/cinematic-scene-v1.schema.json`](schemas/cinematic-scene-v1.schema.json); `compileCinematicSceneV1` is authoritative and performs strict runtime checks including unknown keys, unique stable IDs, asset and speaker references, supported versions, scene duration, and cross-scene targets. The Lab story is a runnable five-scene JSON example.

A scene contains `id`, `chapterId`, `title`, `language` (`tn`, `ar`, `fr`, `en`), local image `assets`, ordered `backgrounds`, stable-ID `characters`, `dialogue`, `camera`, `direction`, `lighting`, `effects`, `transition`, `music` intent, `choices`, `flow`, and idempotent `events`. Character records use exactly one of `assetId` for a complete transparent PNG/WebP or `layers` for body/head/hair/eyes/brows/mouth/hands with optional normalized layout/pivots. Dialogue IDs refer to stable character IDs; repeated lines never create a second character. A language adapter resolves `textId` synchronously at scene compilation and may supply translations and future pronunciation metadata outside the scene contract.

`choices[].options[]` contains `id`, `text`, and either `targetSceneId` or `endingId`; optional `condition` is retained in the data contract. A flow has an optional default `nextSceneId` and ordered host-evaluated conditions. The runtime pauses its shared scene clock at a choice boundary; choosing is committed once and emits a single `choice:selected` event. An option-level `condition` is checked by `selectChoice` through `game.evaluateCondition`; absent or false evaluation rejects that selection. Hosts may pre-filter such options for presentation. Story `events` are forward-time events with exactly-once keys `<sceneId>:<eventId>`; seeking skips event execution, restoring imports the prior event ledger, and replay resets the visual clock while retaining the event ledger. Thus replay does not re-run story side effects.

## Runtime API

```js
const runtime = createCinematicStoryRuntime({
  scenes, render, decodeAsset, releaseAsset, transition,
  game, music, language, now, requestFrame, cancelFrame
});
await runtime.loadScene("home");
await runtime.play();
```

| API | Behavior |
| --- | --- |
| `loadScene(sceneId, { autoplay })` | Strictly resolves, preloads and mounts a scene; replaces prior scene after successful asset loading. |
| `preloadAssets(sceneId?)` | Loads a bounded single-scene lease; defaults to a known next-scene route. |
| `play`, `pause`, `resume`, `stop`, `seek`, `replay` | Transport controlled by the single scene clock. Seek is visual-only and does not dispatch historical story events. |
| `skipDialogue`, `advanceDialogue` | Finish the visible text turn or step a manually paced dialogue; choices remain barriers. |
| `selectChoice(optionId)` | Commits one currently pending choice and follows its branch or ending. |
| `getState`, `subscribe` | Read immutable transport/dialogue/choice/viseme state; observe state updates. |
| `exportState`, `restoreState` | JSON-only Runtime checkpoint with scene, time, choices, transport, dialogue mode, ending, and event ledger. |
| `dispose` | Stops playback and releases scene/preload leases and decoded bitmap resources. |

Required host adapters: `render(frame)` draws a frame and receives the active timed dialogue, per-character expression/viseme/motion state, and focused speaker ID; `decodeAsset(url, descriptor)` resolves a drawable browser image; optional `releaseAsset(resource, descriptor)` frees it (defaults to `close()`); `transition(payload)` runs host visual transition. `game.emit(event)` and `game.evaluateCondition(expression,state)` bridge story events/conditions; `music.setScene(intent)` and `music.stop(intent)` bridge music intent; `language.resolve({textId,language,fallback})` resolves text. The Lab uses bounded `Image` objects and generated local backdrops. Shared asset IDs must always map to the same source URL. Runtime state does not include decoded image bytes or game state.

### Clock, events and save semantics

All dialogue, camera, viseme, and director samples receive the same scene-relative milliseconds. Play/pause/resume/seek/replay are deterministic at the same clock sample. Events dispatch in forward timeline order, only once per scene/event key for the Runtime session and after restoration. Seek deliberately skips them; replay is a visual replay. To replay story side effects, a host must create a new story session with a fresh event ledger. Save state is separate from game state and carries only JSON data. Restore remounts and decodes assets, reconciles music once, restores a pending choice or manual dialogue wait without re-emitting earlier events. Choice condition eligibility is a host concern before a choice is exposed; see current limitation above.

## Offline Lab

Open `examples/cinematic-runtime-lab/index.html` through a local file viewer/WebView or serve the folder locally. On browsers that block ES modules from `file://`, use the bundled `dist/qarton-cinematic-runtime-standalone.html` or the Android ZIP; these require no HTTPS or network. The story includes five linked scenes, four named characters, Tunisian dialogue, generated day/night/dusk backdrops, two choices, two branch routes and two ending IDs. Portrait art is original preview art; provenance and limits are in the Lab's `ASSET_PROVENANCE.md`. The portraits are full sprites, not segmented production rigs.

## Performance and production limitations

The runtime's decoded-asset pool deduplicates by asset ID and retains one scene plus at most one preloaded next-scene lease; it closes image resources when the last owner releases them. Runtime performance is measured with a Canvas host and real bundled portraits/backdrops, not an empty-scene clock. Chromium results are not Android measurements. A real HONOR/Android 30 FPS and memory test remains required before production acceptance. The Canvas sample is a functional reference host, not an authored multi-layer anime rig; character-specific layered animation and mouth artwork quality still depend on suitable production assets and host rendering.

## تكامل مشاهد الأطلس مع محركات QARTON

- طبقات الشخصية تدعم `sourceRect: { x, y, width, height }` بوحدات بكسل الصورة بعد فكّها. `x` و`y` يبدأان من صفر، والمقاسان موجبان. الحد المساوي لحافة الصورة مقبول. الحقل اختياري لطبقة تستخدم الصورة كاملة.
- `compileCinematicSceneV1` يتحقق من شكل المستطيل. `loadScene` و`preloadAssets` يتحققان من كل القصاصات عند توفر الصورة المفكوكة، بما فيها الوضعيات التي لم تُعرض بعد. خطأ الحدود يحدد المشهد والشخصية والأصل والطبقة. يستطيع المضيف معالجة رفض التحميل وعرض الرسالة مع إبقاء المشهد السابق.
- مرّر إلى `decodeAsset(src, descriptor)` محمّل الأصول المحلي الذي يعيد `ImageBitmap` أو صورة HTML بعد `decode()`. يستدعي المحرك `releaseAsset(image, descriptor)` في نهاية آخر استخدام للصورة. إذا كان للمضيف مخزن أصول مشترك، يجب أن يحرّر حصته فقط داخل هذا المحوّل. حجم `decodedAssetBytes` تقدير RGBA ‏(4 بايت لكل بكسل) ولا يحصي التخزين المضغوط أو نسخ GPU.
- محرك الألعاب يربط `game.emit(event)` بموجّه الأحداث ويستعمل `event.eventKey` لإعادة المحاولة الآمنة، ويربط `game.evaluateCondition(condition, state)` بحالة اللعبة. محرك اللغة يربط `language.resolve({ textId, language, fallback })` لإرجاع النص تزامنيًا قبل التحريك. محرك الموسيقى يختار كيفية تحويل `music.setScene(intent)` و`music.stop(context)` إلى موسيقى محلية.
- اعرض `render(frame)` وأرسل `transition(payload)` إلى `CinematicRenderer`. لتحرير موارد المضيف، انتظر `runtime.dispose()` ثم نفّذ `renderer.dispose()`. راجع [قالب ومعايرة شخصية أنمي](ANIME_CHARACTER_CALIBRATION.md) لربط الأصول بالمشهد.
