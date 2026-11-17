import { buildLayerPlan } from "../scene/layer-plan.js";

function raceWithAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? Object.assign(new Error("Background render was cancelled"), { name: "AbortError" }));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

/**
 * DOM renderer for scene layers.
 * The host supplies both the mount element and asset resolver; importing this
 * module never reads browser globals or mutates the document.
 */
export class BackgroundRenderer {
  #root;
  #document;
  #resolveAsset;
  #renderToken = 0;
  #renderController = null;
  #destroyed = false;

  constructor({ root, resolveAsset }) {
    if (!root || typeof root.replaceChildren !== "function") {
      throw new TypeError("BackgroundRenderer requires a DOM root with replaceChildren()");
    }
    if (typeof resolveAsset !== "function") {
      throw new TypeError("BackgroundRenderer requires an asset resolver function");
    }
    const document = root.ownerDocument;
    if (!document || typeof document.createElement !== "function" ||
        typeof document.createDocumentFragment !== "function") {
      throw new TypeError("The root must belong to a DOM document");
    }
    this.#root = root;
    this.#document = document;
    this.#resolveAsset = resolveAsset;
  }

  /**
   * Resolve every asset before replacing the current scene. If loading fails,
   * the previous scene remains visible. Returns false when superseded/cleared.
   */
  async render(scene, profile) {
    if (this.#destroyed) throw new Error("BackgroundRenderer has been destroyed");
    const plan = buildLayerPlan(scene, profile);
    // A newer scene supersedes asset resolution for the previous one. The
    // resolver may use this signal to stop fetch/decode work it owns.
    this.#renderController?.abort();
    const controller = new AbortController();
    this.#renderController = controller;
    const token = ++this.#renderToken;
    let assets;
    try {
      assets = await raceWithAbort(Promise.all(plan.map(async layer => {
        const url = await this.#resolveAsset(layer.asset, layer, { signal: controller.signal });
        if (typeof url !== "string" || !url.trim()) {
          throw new TypeError(`Asset resolver returned no URL for "${layer.asset}"`);
        }
        return url;
      })), controller.signal);
    } catch (error) {
      // A newer render or clear() owns the root now; stale failures must not
      // escape as errors from work that can no longer be committed.
      if (token !== this.#renderToken) return false;
      // Stop sibling layer requests when one layer fails. Promise.all rejects
      // early, but the other resolvers may still be consuming network/memory.
      controller.abort(error);
      if (this.#renderController === controller) this.#renderController = null;
      throw error;
    }

    if (token !== this.#renderToken) return false;

    const fragment = this.#document.createDocumentFragment();
    plan.forEach((layer, index) => {
      const wrapper = this.#document.createElement("div");
      const image = this.#document.createElement("img");
      wrapper.className = `qarton-layer qarton-layer--${layer.role}`;
      wrapper.dataset.layerId = layer.id;
      wrapper.dataset.layerRole = layer.role;
      Object.assign(wrapper.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        opacity: String(layer.opacity),
        zIndex: String(index),
        overflow: "hidden",
        pointerEvents: "none"
      });
      image.src = assets[index];
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      // Decode every layer before replacing the visible scene. Lazy loading here
      // could leave off-screen layers unresolved while the scene is committed.
      image.loading = "eager";
      Object.assign(image.style, {
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        userSelect: "none"
      });
      wrapper.appendChild(image);
      fragment.appendChild(wrapper);
    });

    try {
      await raceWithAbort(Promise.all(Array.from(fragment.children, wrapper => {
        const image = wrapper.children[0];
        if (typeof image.decode === "function") return image.decode();
        if (image.complete) {
          if (image.naturalWidth > 0) return Promise.resolve();
          return Promise.reject(new Error(`Image failed to load: ${image.src}`));
        }
        return new Promise((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Image failed to load: ${image.src}`));
        });
      })), controller.signal);
    } catch (error) {
      if (token !== this.#renderToken) return false;
      controller.abort(error);
      if (this.#renderController === controller) this.#renderController = null;
      throw error;
    }

    if (token !== this.#renderToken) return false;
    this.#root.replaceChildren(fragment);
    if (this.#renderController === controller) this.#renderController = null;
    this.#root.dataset.qartonSceneId = scene.id;
    return true;
  }

  clear() {
    if (this.#destroyed) return;
    this.#renderToken += 1;
    this.#renderController?.abort();
    this.#renderController = null;
    this.#root.replaceChildren();
    delete this.#root.dataset.qartonSceneId;
  }

  destroy() {
    if (this.#destroyed) return;
    this.clear();
    this.#destroyed = true;
    this.#root = null;
    this.#document = null;
    this.#resolveAsset = null;
  }
}
