import { validateStudioSequenceV1 } from "./index.js";

export function createAssetRegistry(sequence, { maxBytes = 64 * 1024 * 1024 } = {}) {
  let snapshot = validateStudioSequenceV1(sequence);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid asset budget");
  const blobs = new Map();
  let bytes = 0;
  function references(id) {
    return Object.freeze(snapshot.scenes.filter(scene =>
      scene.project.layers.some(layer => layer.assetId === id) ||
      scene.audioTracks.some(track => track.clips.some(clip => clip.asset === id))
    ).map(scene => scene.id));
  }
  function validateLink(id, blob) {
    const asset = snapshot.assets.find(item => item.id === id);
    if (!asset) throw new RangeError("Unknown asset");
    if (!(blob instanceof Blob) || blob.size !== asset.size || blob.type.toLowerCase() !== asset.mimeType)
      throw new TypeError("Asset bytes do not match metadata");
    const next = bytes - (blobs.get(id)?.size ?? 0) + blob.size;
    if (next > maxBytes) throw new RangeError("Asset budget exceeded");
    return next;
  }
  function relink(id, blob) {
    const next = validateLink(id, blob);
    blobs.set(id, blob);
    bytes = next;
  }
  function remove(id) {
    if (!snapshot.assets.some(asset => asset.id === id)) throw new RangeError("Unknown asset");
    if (references(id).length) throw new Error("Asset is referenced by a scene");
    // Character tracks may contain additional asset references; fail closed until audited.
    if (snapshot.scenes.some(scene => scene.characterTracks.length)) throw new Error("Character references require audit before deletion");
    const next = validateStudioSequenceV1({ ...snapshot, assets: snapshot.assets.filter(asset => asset.id !== id) });
    bytes -= blobs.get(id)?.size ?? 0;
    blobs.delete(id);
    snapshot = next;
    return snapshot;
  }
  function add(asset) {
    snapshot = validateStudioSequenceV1({ ...snapshot, assets: [...snapshot.assets, asset] });
    return snapshot;
  }
  return Object.freeze({ get sequence() { return snapshot; }, get linkedBytes() { return bytes; },
    references, validateLink, relink, remove, add, get: id => blobs.get(id) ?? null });
}
