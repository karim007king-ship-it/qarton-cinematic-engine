/**
 * Platform-injected DOM transition adapter.
 *
 * renderScene(scene, profile) must resolve to a DOM Element containing the
 * rendered scene. No document/window access occurs during module import.
 */
export function createDOMTransitionAdapter({
  root,
  renderScene,
  duration = 350,
  reducedMotion = false,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  animate = (element, keyframes, options) => {
    if (typeof element.animate !== "function") return null;
    return element.animate(keyframes, options);
  }
} = {}) {
  if (!root || typeof root.appendChild !== "function") {
    throw new TypeError("DOM transition adapter requires a root element");
  }
  if (typeof renderScene !== "function") {
    throw new TypeError("DOM transition adapter requires renderScene()");
  }
  if (!Number.isFinite(duration) || duration < 0) {
    throw new TypeError("Transition duration must be a non-negative finite number");
  }
  if (typeof wait !== "function" || typeof animate !== "function") {
    throw new TypeError("wait and animate must be functions");
  }

  let destroyed = false;
  const mounted = new Set();

  async function mount(scene, profile) {
    if (destroyed) throw new Error("DOM transition adapter has been destroyed");
    const content = await renderScene(scene, profile);
    if (!content || typeof content !== "object" || !content.style) {
      throw new TypeError("renderScene() must return a DOM element");
    }
    if (destroyed) throw new Error("DOM transition adapter has been destroyed");

    const wrapper = root.ownerDocument.createElement("div");
    wrapper.className = "qarton-scene qarton-scene--entering";
    wrapper.dataset.qartonSceneId = String(scene.id);
    Object.assign(wrapper.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      opacity: "0",
      overflow: "hidden",
      willChange: "opacity, filter"
    });
    wrapper.appendChild(content);
    root.appendChild(wrapper);
    mounted.add(wrapper);
    return wrapper;
  }

  async function crossfade({ from, to, duration: requestedDuration = duration }) {
    if (destroyed) throw new Error("DOM transition adapter has been destroyed");
    if (!to || !mounted.has(to)) throw new TypeError("Target scene is not mounted");
    if (!Number.isFinite(requestedDuration) || requestedDuration < 0) {
      throw new TypeError("Transition duration must be a non-negative finite number");
    }

    const instant = Boolean(typeof reducedMotion === "function" ? reducedMotion() : reducedMotion)
      || requestedDuration === 0 || !from;
    if (instant) {
      to.style.opacity = "1";
      to.style.filter = "none";
      to.classList?.remove("qarton-scene--entering");
      if (from && from !== to) from.style.opacity = "0";
      return;
    }

    const ms = requestedDuration;
    const fromAnimation = from ? animate(from, [
      { opacity: 1, filter: "blur(0px)" },
      { opacity: 0, filter: "blur(8px)" }
    ], { duration: ms, easing: "ease-in-out", fill: "forwards" }) : null;
    const toAnimation = animate(to, [
      { opacity: 0, filter: "blur(8px)" },
      { opacity: 1, filter: "blur(0px)" }
    ], { duration: ms, easing: "ease-in-out", fill: "forwards" });

    if (fromAnimation && toAnimation) {
      try {
        await Promise.all([fromAnimation.finished, toAnimation.finished]);
      } catch (error) {
        fromAnimation.cancel?.();
        toAnimation.cancel?.();
        throw error;
      }
    } else {
      if (from) Object.assign(from.style, { transition: `opacity ${ms}ms ease-in-out, filter ${ms}ms ease-in-out`, opacity: "0", filter: "blur(8px)" });
      Object.assign(to.style, { transition: `opacity ${ms}ms ease-in-out, filter ${ms}ms ease-in-out`, opacity: "1", filter: "blur(0px)" });
      await wait(ms);
    }

    to.style.opacity = "1";
    to.style.filter = "none";
    to.classList?.remove("qarton-scene--entering");
    if (from) {
      from.style.opacity = "0";
      from.style.filter = "none";
    }
  }

  function unmount(handle) {
    if (!handle || !mounted.has(handle)) return;
    mounted.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const handle of mounted) {
      handle.remove?.();
      if (handle.parentNode === root) root.removeChild(handle);
    }
    mounted.clear();
  }

  return Object.freeze({ mount, crossfade, unmount, destroy });
}
