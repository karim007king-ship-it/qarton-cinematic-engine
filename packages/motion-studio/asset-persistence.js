import { createAssetRegistry } from "./asset-registry.js";

// Own the registry privately so async writes cannot race synchronous edits.
export function createPersistentAssetRegistry(sequence, {storage, projectId, maxBytes} = {}) {
  if (!storage || typeof storage.put !== "function" || typeof storage.get !== "function") throw new TypeError("Storage adapter required");
  const registry = createAssetRegistry(sequence, {maxBytes});
  let tail = Promise.resolve();
  function enqueue(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  return Object.freeze({
    get sequence() { return registry.sequence; },
    get linkedBytes() { return registry.linkedBytes; },
    get: id => registry.get(id),
    references: id => registry.references(id),
    relink(id, blob, options = {}) {
      return enqueue(async () => {
        registry.validateLink(id, blob);
        await storage.put(projectId, id, blob, options);
        registry.relink(id, blob);
      });
    },
    restore(options = {}) {
      return enqueue(async () => {
        const missing = [];
        for (const asset of registry.sequence.assets) {
          const blob = await storage.get(projectId, asset.id, options);
          if (blob === null) missing.push(asset.id);
          else registry.relink(asset.id, blob);
        }
        return Object.freeze(missing);
      });
    }
  });
}
