// Local asset bytes only; callers own project metadata and registry validation.
export async function openAssetStorage({ indexedDB = globalThis.indexedDB, name = "qarton-motion-assets-v1" } = {}) {
  if (!indexedDB?.open) throw new Error("IndexedDB unavailable");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("assets")) request.result.createObjectStore("assets");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Asset storage upgrade blocked")); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  db.onversionchange = () => db.close();
  function key(projectId, assetId) {
    for (const id of [projectId, assetId]) {
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id)) throw new TypeError("Invalid storage identifier");
    }
    return [projectId, assetId];
  }
  function run(mode, operation, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      const tx = db.transaction("assets", mode);
      let result;
      const abort = () => { try { tx.abort(); } catch {} };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => { cleanup(); resolve(result); };
      tx.onabort = () => { cleanup(); reject(signal?.aborted ? new DOMException("Cancelled", "AbortError") : tx.error ?? new Error("Asset transaction aborted")); };
      signal?.addEventListener("abort", abort, {once:true});
      try {
        const request = operation(tx.objectStore("assets"));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { cleanup(); abort(); reject(error); }
    });
  }
  return Object.freeze({
    async put(projectId, assetId, blob, {signal} = {}) {
      if (!(blob instanceof Blob)) throw new TypeError("Expected Blob");
      const id = key(projectId, assetId);
      await run("readwrite", store => store.put(blob, id), signal);
    },
    async get(projectId, assetId, {signal} = {}) {
      const id = key(projectId, assetId);
      return (await run("readonly", store => store.get(id), signal)) ?? null;
    },
    async remove(projectId, assetId, {signal} = {}) {
      const id = key(projectId, assetId);
      await run("readwrite", store => store.delete(id), signal);
    },
    close() { db.close(); }
  });
}
