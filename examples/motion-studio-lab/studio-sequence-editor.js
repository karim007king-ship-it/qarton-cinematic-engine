import {
  addStudioSequenceScene, compileStudioSequence, createStudioSequenceV1,
  deleteStudioSequenceScene, duplicateStudioSequenceScene, reorderStudioSequenceScene,
  sampleStudioSequence, validateStudioSequenceV1
} from "../../packages/motion-studio/index.js";

const NAME_LIMIT = 80;
export const STUDIO_SEQUENCE_FILE_FORMAT = "qarton-motion-studio-sequence-project";
const MAX_SEQUENCE_FILE_BYTES = 2 * 1024 * 1024;

function checkedName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > NAME_LIMIT) {
    throw new TypeError(`Scene name must contain 1–${NAME_LIMIT} characters`);
  }
  return value.trim();
}

function sceneIndex(sequence, id) {
  const index = sequence.scenes.findIndex(scene => scene.id === id);
  if (index < 0) throw new RangeError(`Unknown scene: ${id}`);
  return index;
}

export function createStudioSequenceEditor(sequence, { names = {}, activeSceneId } = {}) {
  let snapshot = validateStudioSequenceV1(sequence);
  let compiledSnapshot = compileStudioSequence(snapshot);
  const labels = new Map();
  for (const scene of snapshot.scenes) labels.set(scene.id, checkedName(names[scene.id] ?? `المشهد ${sceneIndex(snapshot, scene.id) + 1}`));
  let activeId = activeSceneId ?? snapshot.scenes[0].id;
  sceneIndex(snapshot, activeId);

  function adopt(next, nextActive = activeId) {
    snapshot = validateStudioSequenceV1(next);
    compiledSnapshot = compileStudioSequence(snapshot);
    const present = new Set(snapshot.scenes.map(scene => scene.id));
    for (const id of labels.keys()) if (!present.has(id)) labels.delete(id);
    snapshot.scenes.forEach((scene, index) => {
      if (!labels.has(scene.id)) labels.set(scene.id, `المشهد ${index + 1}`);
    });
    activeId = present.has(nextActive) ? nextActive : snapshot.scenes[0].id;
    return view();
  }

  function view() {
    const compiled = compileStudioSequence(snapshot);
    return Object.freeze({ sequence: snapshot, activeSceneId: activeId,
      scenes: Object.freeze(snapshot.scenes.map((scene, index) => Object.freeze({
        ...scene, name: labels.get(scene.id), index,
        startMs: compiled.scenes.slice(0, index).reduce((sum, item) => sum + item.project.durationMs, 0),
        endMs: compiled.scenes.slice(0, index + 1).reduce((sum, item) => sum + item.project.durationMs, 0)
      }))),
      durationMs: compiled.durationMs,
      compiled });
  }

  function updateScene(id, update) {
    const index = sceneIndex(snapshot, id);
    if (typeof update !== "function") throw new TypeError("Scene update callback required");
    const scenes = snapshot.scenes.map((scene, sceneNo) => sceneNo === index ? update(scene) : scene);
    return adopt(createStudioSequenceV1({ viewport: snapshot.viewport, scenes, assets: snapshot.assets }));
  }

  return Object.freeze({
    get sequence() { return snapshot; },
    get activeSceneId() { return activeId; },
    get durationMs() { return snapshot.scenes.reduce((sum, scene) => sum + scene.project.durationMs, 0); },
    get scenes() { return Object.freeze(snapshot.scenes.map((scene, index) => Object.freeze({
      ...scene, name: labels.get(scene.id), index,
      startMs: snapshot.scenes.slice(0, index).reduce((sum, item) => sum + item.project.durationMs, 0),
      endMs: snapshot.scenes.slice(0, index + 1).reduce((sum, item) => sum + item.project.durationMs, 0)
    }))); },
    snapshot: view,
    nameOf(id) { sceneIndex(snapshot, id); return labels.get(id); },
    activate(id) { sceneIndex(snapshot, id); activeId = id; return view(); },
    rename(id, value) { sceneIndex(snapshot, id); labels.set(id, checkedName(value)); return view(); },
    replaceSequence(next) { return adopt(next); },
    add(scene, index = snapshot.scenes.length, name = undefined) {
      const next = addStudioSequenceScene(snapshot, scene, index);
      if (name !== undefined) labels.set(scene.id, checkedName(name));
      return adopt(next, scene.id);
    },
    duplicate(id, newId, index = undefined) {
      const next = duplicateStudioSequenceScene(snapshot, id, { newId, index });
      labels.set(newId, `${labels.get(id)} — نسخة`);
      return adopt(next, newId);
    },
    remove(id) {
      const index = sceneIndex(snapshot, id);
      const nextActive = activeId === id ? snapshot.scenes[Math.max(0, index - 1)]?.id : activeId;
      const next = deleteStudioSequenceScene(snapshot, id);
      return adopt(next, nextActive);
    },
    reorder(id, index) { return adopt(reorderStudioSequenceScene(snapshot, id, index)); },
    updateScene,
    setDuration(id, durationMs) {
      if (!Number.isSafeInteger(durationMs) || durationMs < 3000 || durationMs > 60_000) {
        throw new RangeError("Scene duration must be between 3,000 and 60,000 ms");
      }
      return updateScene(id, scene => {
        const oldDuration = scene.project.durationMs;
        const project = structuredClone(scene.project);
        project.durationMs = durationMs;
        if (project.camera?.at(-1)?.atMs === oldDuration) project.camera.at(-1).atMs = durationMs;
        return { ...scene, project };
      });
    },
    sample(timeMs) { return sampleStudioSequence(compiledSnapshot, timeMs); },
    timeFor(id, localMs) {
      const index = sceneIndex(snapshot, id);
      const scene = snapshot.scenes[index];
      if (!Number.isFinite(localMs)) throw new TypeError("Local scene time must be finite");
      const startMs = snapshot.scenes.slice(0, index).reduce((sum, item) => sum + item.project.durationMs, 0);
      return startMs + Math.max(0, Math.min(scene.project.durationMs, localMs));
    }
  });
}

export function serializeStudioSequenceFile(editor, { projectId, aspectPreset = "original", fitMode = "fit", audioMasterVolume = 1 } = {}) {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(projectId)) throw new TypeError("Invalid local project identifier");
  if (!["original", "square", "portrait", "landscape", "post", "classic-landscape", "classic-portrait"].includes(aspectPreset) ||
      !["fit", "fill"].includes(fitMode) || !Number.isFinite(audioMasterVolume) || audioMasterVolume < 0 || audioMasterVolume > 1) {
    throw new TypeError("Invalid sequence project settings");
  }
  const sceneNames = Object.fromEntries(editor.scenes.map(scene => [scene.id, checkedName(scene.name)]));
  const data = { format: STUDIO_SEQUENCE_FILE_FORMAT, version: 1, projectId, sequence: editor.sequence,
    sceneNames, settings: { aspectPreset, fitMode }, audioMasterVolume };
  const text = JSON.stringify(data);
  if (new TextEncoder().encode(text).byteLength > MAX_SEQUENCE_FILE_BYTES) throw new RangeError("Sequence project exceeds 2 MiB");
  return text;
}

export function parseStudioSequenceFile(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_SEQUENCE_FILE_BYTES) throw new RangeError("Sequence project is invalid or exceeds 2 MiB");
  let data;
  try { data = JSON.parse(text); } catch { throw new TypeError("Sequence project JSON is invalid"); }
  const keys = ["audioMasterVolume", "format", "projectId", "sceneNames", "sequence", "settings", "version"].sort();
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).sort().join("|") !== keys.join("|")) {
    throw new TypeError("Sequence project envelope has invalid fields");
  }
  if (data.format !== STUDIO_SEQUENCE_FILE_FORMAT || data.version !== 1 ||
      typeof data.projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(data.projectId) ||
      !data.sceneNames || typeof data.sceneNames !== "object" || Array.isArray(data.sceneNames) ||
      !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings) ||
      !["original", "square", "portrait", "landscape", "post", "classic-landscape", "classic-portrait"].includes(data.settings.aspectPreset) ||
      !["fit", "fill"].includes(data.settings.fitMode) || !Number.isFinite(data.audioMasterVolume) ||
      data.audioMasterVolume < 0 || data.audioMasterVolume > 1) throw new TypeError("Sequence project metadata is invalid");
  const snapshot = validateStudioSequenceV1(data.sequence);
  const expectedIds = new Set(snapshot.scenes.map(scene => scene.id));
  if (Object.keys(data.sceneNames).length !== expectedIds.size || Object.keys(data.sceneNames).some(id => !expectedIds.has(id))) {
    throw new TypeError("Sequence project scene names do not match the sequence");
  }
  const names = Object.fromEntries(Object.entries(data.sceneNames).map(([id, name]) => [id, checkedName(name)]));
  return Object.freeze({ editor: createStudioSequenceEditor(snapshot, { names }), projectId: data.projectId,
    settings: Object.freeze({ ...data.settings }), audioMasterVolume: data.audioMasterVolume });
}
