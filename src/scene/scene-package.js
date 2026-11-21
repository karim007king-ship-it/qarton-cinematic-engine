import { createSceneDefinition } from "./scene-definition.js";
import { buildLayerPlan } from "./layer-plan.js";
import { createCameraTrack } from "../camera/camera-track.js";
import { createCharacterController } from "../character/character-controller.js";
import { createTimeline } from "../motion/timeline.js";
import { normalizeAudioCues } from "../audio/audio-cue-controller.js";

/** Compile JSON scene data into existing runtime inputs. Asset keys belong to the host. */
export function createScenePackage(data) {
  if (data?.version !== 1) throw new TypeError("Unsupported scene package version");
  const scene = createSceneDefinition(data);
  const tracks = Object.create(null);
  for (const layer of data.layers) {
    if (layer.keyframes !== undefined) tracks[layer.id.trim()] = createCameraTrack(layer.keyframes);
  }
  const ids = new Set();
  const characters = (data.characters ?? []).map(character => {
    const controller = createCharacterController(character);
    if (ids.has(controller.id)) throw new TypeError("Duplicate character id");
    ids.add(controller.id);
    const sprites = { ...character.sprites };
    if (!Object.hasOwn(sprites, "default") ||
        Object.values(sprites).some(key => typeof key !== "string" || !key.trim())) {
      throw new TypeError("Character sprites require a default and non-empty asset keys");
    }
    return Object.freeze({ controller, sprites: Object.freeze(sprites) });
  });
  const transitionMs = data.transitionMs ?? 350;
  if (!Number.isFinite(transitionMs) || transitionMs < 0) throw new TypeError("Invalid transitionMs");
  return Object.freeze({
    version: 1, scene, transitionMs,
    camera: createCameraTrack(data.camera ?? [{ atMs: 0 }]),
    layerTracks: Object.freeze(tracks),
    characters: Object.freeze(characters),
    timeline: createTimeline(data.events ?? []),
    audioCues: Object.freeze(normalizeAudioCues(data.audioCues ?? [])),
    imageKeys(profile) {
      const keys = buildLayerPlan(scene, profile).map(layer => layer.asset);
      for (const { sprites } of characters) keys.push(...Object.values(sprites));
      return [...new Set(keys)];
    }
  });
}
