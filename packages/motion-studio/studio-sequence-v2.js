import { clamp } from "@qarton/cinematic-engine/motion";

/** Build the V2 API with V1 validators injected by the package entry point. */
export function createStudioSequenceV2Core({ createStudioSequenceV1, validateStudioSequenceV1 } = {}) {
  if (typeof createStudioSequenceV1 !== "function" || typeof validateStudioSequenceV1 !== "function") {
    throw new TypeError("StudioSequenceV2 requires the StudioSequenceV1 constructors and validators");
  }
  const SEQUENCE_LIMITS = Object.freeze({ scenes: 64, assets: 256, durationMs: 300_000 });
  const MAX_SEQUENCE_V2_JSON_BYTES = 2 * 1024 * 1024;
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
  const compiledStudioSequencesV2 = new WeakMap();

  function fields(value, required, optional, label) {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        required.some(key => !Object.hasOwn(value, key)) ||
        Reflect.ownKeys(value).some(key => !required.includes(key) && !optional.includes(key))) {
      throw new TypeError(`${label} has invalid fields`);
    }
  }
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  function identifier(value, label) {
    if (typeof value !== "string" || !ID.test(value) || /\s/u.test(value)) throw new TypeError(`${label} must be an opaque ASCII identifier`);
  }
  function cloneData(value, label) {
    try { return structuredClone(value); }
    catch (cause) { throw new TypeError(`${label} must contain cloneable JSON data`, { cause }); }
  }
  function assertDenseSequenceData(value, label, seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index) || value[index] === null || value[index] === undefined) {
          throw new TypeError(`${label}[${index}] must not be a sparse or empty array entry`);
        }
        assertDenseSequenceData(value[index], `${label}[${index}]`, seen);
      }
      return;
    }
    for (const key of Object.keys(value)) assertDenseSequenceData(value[key], `${label}.${key}`, seen);
  }

  function cutTransitionV2(fromSceneId, toSceneId) {
    return Object.freeze({ fromSceneId, toSceneId, type: "cut", durationMs: 0, audioCrossfadeMs: 0 });
  }

  function validateSequenceV2Transitions(transitions, scenes) {
    if (!Array.isArray(transitions) || transitions.length !== Math.max(0, scenes.length - 1)) {
      throw new RangeError("StudioSequenceV2 requires exactly one transition between each adjacent pair of scenes");
    }
    const snapshot = transitions.map((transition, index) => {
      fields(transition, ["fromSceneId", "toSceneId", "type", "durationMs", "audioCrossfadeMs"], [], `Sequence V2 transition ${index}`);
      const from = scenes[index], to = scenes[index + 1];
      if (transition.fromSceneId !== from.id || transition.toSceneId !== to.id) {
        throw new TypeError(`Sequence V2 transition ${index} must connect its adjacent scenes in order`);
      }
      if (!["cut", "fade", "dissolve"].includes(transition.type)) {
        throw new TypeError(`Sequence V2 transition ${index} has an unsupported type`);
      }
      integer(transition.durationMs, 0, 3000, `Sequence V2 transition ${index} durationMs`);
      integer(transition.audioCrossfadeMs, 0, transition.durationMs, `Sequence V2 transition ${index} audioCrossfadeMs`);
      if (transition.type === "cut" && transition.durationMs !== 0) {
        throw new RangeError("Cut transitions must have zero duration");
      }
      if (transition.type !== "cut" && transition.durationMs === 0) {
        throw new RangeError("Fade and Dissolve transitions must have positive duration");
      }
      if (transition.type === "cut" && transition.audioCrossfadeMs !== 0) {
        throw new RangeError("Cut transitions cannot have an audio crossfade in StudioSequenceV2");
      }
      if (transition.durationMs > Math.min(from.project.durationMs, to.project.durationMs)) {
        throw new RangeError(`Sequence V2 transition ${index} is longer than an adjacent scene`);
      }
      return Object.freeze({ fromSceneId: from.id, toSceneId: to.id, type: transition.type,
        durationMs: transition.durationMs, audioCrossfadeMs: transition.audioCrossfadeMs });
    });
    for (let index = 1; index < scenes.length - 1; index++) {
      const incoming = snapshot[index - 1].durationMs;
      const outgoing = snapshot[index].durationMs;
      if (incoming + outgoing > scenes[index].project.durationMs) {
        throw new RangeError(`Sequence V2 transitions overlap inside scene ${scenes[index].id}`);
      }
    }
    return snapshot;
  }

  /** Validate, clone, and freeze a strict StudioSequenceV2 envelope with overlap transitions. */
  function validateStudioSequenceV2(input) {
    fields(input, ["version", "kind", "viewport", "scenes", "assets", "transitions"], [], "StudioSequenceV2");
    if (input.version !== 2 || input.kind !== "studio-sequence") throw new TypeError("Expected StudioSequenceV2");
    assertDenseSequenceData(input, "StudioSequenceV2");
    if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > SEQUENCE_LIMITS.scenes) {
      throw new RangeError(`StudioSequenceV2 scenes must contain between 1 and ${SEQUENCE_LIMITS.scenes} scenes`);
    }
    // Validate each scene through the established V1 scene/track validators, but
    // keep the project duration check here: V2's overlap reduces total duration,
    // so the sum of local scene durations can legitimately exceed V1's cap.
    const validatedFirstScene = validateStudioSequenceV1({ version: 1, kind: "studio-sequence", viewport: input.viewport,
      scenes: [input.scenes[0]], assets: input.assets, transitions: [] });
    const { viewport, assets } = validatedFirstScene;
    const scenes = [validatedFirstScene.scenes[0]];
    const sceneIds = new Set([scenes[0].id]);
    for (const scene of input.scenes.slice(1)) {
      const normalized = validateStudioSequenceV1({ version: 1, kind: "studio-sequence", viewport,
        scenes: [scene], assets, transitions: [] }).scenes[0];
      if (sceneIds.has(normalized.id)) throw new TypeError(`Duplicate sequence scene id: ${normalized.id}`);
      sceneIds.add(normalized.id);
      scenes.push(normalized);
    }
    const transitions = validateSequenceV2Transitions(input.transitions, scenes);
    const intervals = [];
    let startMs = 0;
    for (let index = 0; index < scenes.length; index++) {
      const durationMs = scenes[index].project.durationMs;
      const endMs = startMs + durationMs;
      if (!Number.isSafeInteger(endMs)) throw new RangeError("StudioSequenceV2 timeline exceeds safe integer precision");
      intervals.push(Object.freeze({ sceneIndex: index, sceneId: scenes[index].id, startMs, endMs, durationMs }));
      if (index < transitions.length) startMs = endMs - transitions[index].durationMs;
    }
    const totalDurationMs = intervals.at(-1).endMs;
    if (totalDurationMs > SEQUENCE_LIMITS.durationMs) {
      throw new RangeError(`StudioSequenceV2 duration must not exceed ${SEQUENCE_LIMITS.durationMs} ms`);
    }
    const snapshot = Object.freeze({ version: 2, kind: "studio-sequence", viewport,
      scenes: Object.freeze(scenes), assets, transitions: Object.freeze(transitions) });
    compiledStudioSequencesV2.set(snapshot, Object.freeze({ durationMs: totalDurationMs, intervals: Object.freeze(intervals) }));
    return snapshot;
  }
  /** Construct a V2 sequence; omitted transitions become zero-duration Cuts. */
  function createStudioSequenceV2({ viewport, scenes, assets = [], transitions } = {}) {
    const initialScenes = Array.isArray(scenes) ? scenes : [];
    assertDenseSequenceData(initialScenes, "StudioSequenceV2 scenes");
    const resolvedTransitions = transitions ?? initialScenes.slice(1).map((scene, index) =>
      cutTransitionV2(initialScenes[index].id, scene.id));
    return validateStudioSequenceV2({ version: 2, kind: "studio-sequence", viewport, scenes: initialScenes, assets, transitions: resolvedTransitions });
  }

  /** Serialize validated V2 metadata without touching or embedding external media bytes. */
  function serializeStudioSequenceV2(sequence) {
    const text = JSON.stringify(validateStudioSequenceV2(sequence));
    if (new TextEncoder().encode(text).byteLength > MAX_SEQUENCE_V2_JSON_BYTES) {
      throw new RangeError("StudioSequenceV2 JSON exceeds 2 MiB");
    }
    return text;
  }

  /** Parse a V2 JSON snapshot strictly; callers persist media bytes in the asset registry separately. */
  function parseStudioSequenceV2(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_SEQUENCE_V2_JSON_BYTES) {
      throw new RangeError("StudioSequenceV2 JSON is invalid or exceeds 2 MiB");
    }
    let value;
    try { value = JSON.parse(text); }
    catch { throw new TypeError("StudioSequenceV2 JSON is invalid"); }
    return validateStudioSequenceV2(value);
  }

  /** Compile V2 overlaps once for deterministic absolute-time sampling. */
  function compileStudioSequenceV2(sequence) {
    const snapshot = validateStudioSequenceV2(sequence);
    const metadata = compiledStudioSequencesV2.get(snapshot);
    const byScene = new Map(snapshot.scenes.map((scene, index) => [scene.id, Object.freeze({ scene, interval: metadata.intervals[index] })]));
    const transitionIntervals = snapshot.transitions.map((transition, index) => Object.freeze({
      ...transition, startMs: metadata.intervals[index + 1].startMs, endMs: metadata.intervals[index].endMs
    }));
    const compiled = Object.freeze({ version: 2, kind: "compiled-studio-sequence-v2", sequence: snapshot,
      viewport: snapshot.viewport, durationMs: metadata.durationMs, scenes: snapshot.scenes,
      transitions: snapshot.transitions, transitionIntervals: Object.freeze(transitionIntervals) });
    compiledStudioSequencesV2.set(compiled, Object.freeze({ durationMs: metadata.durationMs,
      intervals: metadata.intervals, byScene, transitionIntervals: compiled.transitionIntervals }));
    return compiled;
  }

  /** Return one scene or both transition scenes at an absolute project time. */
  function sampleStudioSequenceV2(compiled, timeMs) {
    const metadata = compiledStudioSequencesV2.get(compiled);
    if (!metadata || compiled.kind !== "compiled-studio-sequence-v2") throw new TypeError("Expected a compiled StudioSequenceV2");
    if (!Number.isFinite(timeMs)) throw new TypeError("Sequence sample time must be finite");
    const sequenceTimeMs = clamp(timeMs, 0, metadata.durationMs);
    for (const transition of metadata.transitionIntervals) {
      if (transition.durationMs === 0 || sequenceTimeMs < transition.startMs || sequenceTimeMs >= transition.endMs) continue;
      const progress = clamp((sequenceTimeMs - transition.startMs) / transition.durationMs, 0, 1);
      const from = metadata.byScene.get(transition.fromSceneId);
      const to = metadata.byScene.get(transition.toSceneId);
      const outgoingTimeMs = clamp(sequenceTimeMs - from.interval.startMs, 0, from.interval.durationMs);
      const incomingTimeMs = clamp(sequenceTimeMs - to.interval.startMs, 0, to.interval.durationMs);
      let outgoingOpacity = 1 - progress;
      let incomingOpacity = progress;
      let blackOpacity = 0;
      if (transition.type === "fade") {
        outgoingOpacity = progress < 0.5 ? 1 - 2 * progress : 0;
        incomingOpacity = progress < 0.5 ? 0 : 2 * progress - 1;
        blackOpacity = progress < 0.5 ? 2 * progress : 2 * (1 - progress);
      }
      let audioMix;
      if (transition.audioCrossfadeMs === 0) {
        const boundaryMs = transition.startMs + transition.durationMs / 2;
        const outgoingActive = sequenceTimeMs < boundaryMs;
        audioMix = Object.freeze({ phase: "hard-cut", startMs: boundaryMs, endMs: boundaryMs, progress: null,
          outgoingGain: outgoingActive ? 1 : 0, incomingGain: outgoingActive ? 0 : 1 });
      } else {
        const windowStartMs = transition.startMs + (transition.durationMs - transition.audioCrossfadeMs) / 2;
        const windowEndMs = windowStartMs + transition.audioCrossfadeMs;
        if (sequenceTimeMs < windowStartMs) {
          audioMix = Object.freeze({ phase: "before", startMs: windowStartMs, endMs: windowEndMs, progress: null,
            outgoingGain: 1, incomingGain: 0 });
        } else if (sequenceTimeMs < windowEndMs) {
          const audioProgress = clamp((sequenceTimeMs - windowStartMs) / transition.audioCrossfadeMs, 0, 1);
          audioMix = Object.freeze({ phase: "crossfade", startMs: windowStartMs, endMs: windowEndMs,
            progress: audioProgress, outgoingGain: Math.cos(audioProgress * Math.PI / 2),
            incomingGain: Math.sin(audioProgress * Math.PI / 2) });
        } else {
          audioMix = Object.freeze({ phase: "after", startMs: windowStartMs, endMs: windowEndMs, progress: null,
            outgoingGain: 0, incomingGain: 1 });
        }
      }
      return Object.freeze({ kind: "transition", sequenceTimeMs, totalDurationMs: metadata.durationMs,
        transition, progress,
        outgoing: Object.freeze({ sceneIndex: from.interval.sceneIndex, sceneId: from.scene.id, scene: from.scene,
          sceneTimeMs: outgoingTimeMs, opacity: outgoingOpacity }),
        incoming: Object.freeze({ sceneIndex: to.interval.sceneIndex, sceneId: to.scene.id, scene: to.scene,
          sceneTimeMs: incomingTimeMs, opacity: incomingOpacity }),
        blackOpacity, audioMix });
    }
    let low = 0, high = metadata.intervals.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (metadata.intervals[middle].startMs <= sequenceTimeMs) low = middle;
      else high = middle - 1;
    }
    const interval = metadata.intervals[low];
    const { scene } = metadata.byScene.get(interval.sceneId);
    return Object.freeze({ kind: "scene", sequenceTimeMs, totalDurationMs: metadata.durationMs,
      sceneIndex: low, sceneId: scene.id, sceneTimeMs: clamp(sequenceTimeMs - interval.startMs, 0, interval.durationMs), scene });
  }

  /** Migrate metadata only; V1 tracks, scene IDs, asset references and local timestamps are preserved. */
  function migrateStudioSequenceV1ToV2(sequence) {
    const source = validateStudioSequenceV1(sequence);
    return createStudioSequenceV2({ viewport: source.viewport, scenes: source.scenes, assets: source.assets,
      transitions: source.transitions.map(transition => ({ ...transition, audioCrossfadeMs: 0 })) });
  }

  /** Downgrade only losslessly representable V2 Cut sequences to the V1 contract. */
  function migrateStudioSequenceV2ToV1(sequence) {
    const source = validateStudioSequenceV2(sequence);
    if (source.transitions.some(transition => transition.type !== "cut" || transition.durationMs !== 0 || transition.audioCrossfadeMs !== 0)) {
      throw new RangeError("StudioSequenceV2 contains transitions that StudioSequenceV1 cannot represent");
    }
    return createStudioSequenceV1({ viewport: source.viewport, scenes: source.scenes, assets: source.assets });
  }

  function rebuildStudioSequenceV2(sequence, scenes) {
    const oldEdges = new Map(sequence.transitions.map(transition =>
      [JSON.stringify([transition.fromSceneId, transition.toSceneId]), transition]));
    const transitions = scenes.slice(1).map((scene, index) => oldEdges.get(JSON.stringify([scenes[index].id, scene.id])) ??
      cutTransitionV2(scenes[index].id, scene.id));
    return createStudioSequenceV2({ viewport: sequence.viewport, scenes, assets: sequence.assets, transitions });
  }

  function addStudioSequenceSceneV2(sequence, scene, index = sequence?.scenes?.length) {
    const source = validateStudioSequenceV2(sequence);
    integer(index, 0, source.scenes.length, "Scene insertion index");
    const scenes = source.scenes.map(item => cloneData(item, "Scene"));
    scenes.splice(index, 0, cloneData(scene, "Scene"));
    return rebuildStudioSequenceV2(source, scenes);
  }

  function deleteStudioSequenceSceneV2(sequence, sceneId) {
    const source = validateStudioSequenceV2(sequence);
    if (!source.scenes.some(scene => scene.id === sceneId)) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
    if (source.scenes.length === 1) throw new RangeError("StudioSequenceV2 must contain at least one scene");
    const scenes = source.scenes.filter(scene => scene.id !== sceneId).map(scene => cloneData(scene, "Scene"));
    return rebuildStudioSequenceV2(source, scenes);
  }

  function duplicateStudioSequenceSceneV2(sequence, sceneId, { newId, index } = {}) {
    const source = validateStudioSequenceV2(sequence);
    identifier(newId, "Duplicate scene id");
    if (source.scenes.some(scene => scene.id === newId)) throw new TypeError(`Duplicate sequence scene id: ${newId}`);
    const sourceIndex = source.scenes.findIndex(scene => scene.id === sceneId);
    if (sourceIndex < 0) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
    const insertionIndex = index ?? sourceIndex + 1;
    integer(insertionIndex, 0, source.scenes.length, "Scene insertion index");
    const scenes = source.scenes.map(scene => cloneData(scene, "Scene"));
    const duplicate = cloneData(scenes[sourceIndex], "Scene");
    duplicate.id = newId;
    scenes.splice(insertionIndex, 0, duplicate);
    return rebuildStudioSequenceV2(source, scenes);
  }

  function reorderStudioSequenceSceneV2(sequence, sceneId, toIndex) {
    const source = validateStudioSequenceV2(sequence);
    const fromIndex = source.scenes.findIndex(scene => scene.id === sceneId);
    if (fromIndex < 0) throw new RangeError(`Unknown sequence scene: ${sceneId}`);
    integer(toIndex, 0, source.scenes.length - 1, "Scene reorder index");
    const scenes = source.scenes.map(scene => cloneData(scene, "Scene"));
    const [moved] = scenes.splice(fromIndex, 1);
    scenes.splice(toIndex, 0, moved);
    return rebuildStudioSequenceV2(source, scenes);
  }
  return Object.freeze({ addStudioSequenceSceneV2, compileStudioSequenceV2, createStudioSequenceV2,
    deleteStudioSequenceSceneV2, duplicateStudioSequenceSceneV2, migrateStudioSequenceV1ToV2,
    migrateStudioSequenceV2ToV1, parseStudioSequenceV2, reorderStudioSequenceSceneV2,
    sampleStudioSequenceV2, serializeStudioSequenceV2, validateStudioSequenceV2 });
}

