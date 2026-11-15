/**
 * Platform-injected DOM transition adapter.
 *
 * renderScene(scene, profile) must resolve to a DOM Element containing the
 * rendered scene. Browser globals are only consulted when an adapter method
 * runs, never while importing this module.
 */
export function createDOMTransitionAdapter({
  root,
  renderScene,
  duration = 350,
  reducedMotion = false,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  nextFrame = () => new Promise(resolve => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else Promise.resolve().then(resolve);
  }),
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
  if (typeof wait !== "function" || typeof nextFrame !== "function" || typeof animate !== "function") {
    throw new TypeError("wait, nextFrame and animate must be functions");
  }

  let destroyed = false;
  const mounted = new Set();
  let activeTransition = null;

  function cancelActiveTransition() {
    if (!activeTransition) return;
    const active = activeTransition;
    activeTransition = null;
    active.animations.forEach(animation => {
      try { animation?.cancel?.(); } catch { /* best-effort cancellation */ }
    });
    try { active.cleanup?.(); } catch { /* best-effort visual rollback */ }
    active.cancel();
  }

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

    cancelActiveTransition();
    const instant = Boolean(typeof reducedMotion === "function" ? reducedMotion() : reducedMotion)
      || requestedDuration === 0 || !from;
    if (instant) {
      to.style.opacity = "1";
      to.style.filter = "none";
      to.classList?.remove("qarton-scene--entering");
      if (from && from !== to) from.style.opacity = "0";
      return true;
    }

    let cancel;
    const cancelled = new Promise(resolve => { cancel = resolve; });
    const transition = { cancel, animations: [], cleanup: null, from, to };
    activeTransition = transition;
    const isCurrent = () => activeTransition === transition && !destroyed;
    const finish = () => {
      if (!isCurrent()) return false;
      activeTransition = null;
      to.style.opacity = "1";
      to.style.filter = "none";
      to.style.transition = "";
      to.classList?.remove("qarton-scene--entering");
      if (from) {
        from.style.opacity = "0";
        from.style.filter = "none";
        from.style.transition = "";
      }
      return true;
    };

    // Web Animations are all-or-nothing: if either side cannot animate, use
    // the CSS path for both sides. A synchronous animate() failure is treated
    // as an unavailable animation implementation rather than a stuck scene.
    let fromAnimation = null;
    let toAnimation = null;
    try {
      if (from) fromAnimation = animate(from, [
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 0, filter: "blur(8px)" }
      ], { duration: requestedDuration, easing: "ease-in-out", fill: "forwards" });
      toAnimation = animate(to, [
        { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)" }
      ], { duration: requestedDuration, easing: "ease-in-out", fill: "forwards" });
    } catch {
      fromAnimation?.cancel?.();
      toAnimation?.cancel?.();
      fromAnimation = null;
      toAnimation = null;
    }

    if (fromAnimation && toAnimation) {
      transition.animations = [fromAnimation, toAnimation];
      try {
        const outcome = await Promise.race([
          Promise.all([fromAnimation.finished, toAnimation.finished]).then(() => "finished"),
          cancelled.then(() => "cancelled")
        ]);
        if (outcome === "cancelled" || !isCurrent()) return false;
        return finish();
      } catch (error) {
        if (!isCurrent()) return false;
        fromAnimation.cancel?.();
        toAnimation.cancel?.();
        activeTransition = null;
        throw error;
      }
    }

    // Cancel a partial WAAPI setup before switching both elements to CSS.
    fromAnimation?.cancel?.();
    toAnimation?.cancel?.();
    if (from) {
      from.style.transition = "none";
      from.style.opacity = "1";
      from.style.filter = "blur(0px)";
    }
    to.style.transition = "none";
    to.style.opacity = "0";
    to.style.filter = "blur(8px)";
    transition.cleanup = () => {
      if (from) Object.assign(from.style, { transition: "", opacity: "1", filter: "none" });
      Object.assign(to.style, { transition: "", opacity: "0", filter: "blur(8px)" });
    };

    try {
      // Establish the initial styles in a distinct rendering frame before
      // enabling transitions and applying their target values.
      await nextFrame();
      if (!isCurrent()) return false;
      const ms = requestedDuration;
      const transitionStyle = `opacity ${ms}ms ease-in-out, filter ${ms}ms ease-in-out`;
      if (from) from.style.transition = transitionStyle;
      to.style.transition = transitionStyle;
      if (from) {
        from.style.opacity = "0";
        from.style.filter = "blur(8px)";
      }
      to.style.opacity = "1";
      to.style.filter = "blur(0px)";

      const outcome = await Promise.race([
        Promise.resolve().then(() => wait(ms)).then(() => "finished"),
        cancelled.then(() => "cancelled")
      ]);
      if (outcome === "cancelled" || !isCurrent()) return false;
      return finish();
    } catch (error) {
      if (isCurrent()) {
        transition.cleanup?.();
        activeTransition = null;
      }
      throw error;
    }
  }

  function unmount(handle) {
    if (!handle || !mounted.has(handle)) return;
    if (activeTransition && (activeTransition.from === handle || activeTransition.to === handle)) {
      cancelActiveTransition();
    }
    mounted.delete(handle);
    handle.remove?.();
    if (handle.parentNode === root) root.removeChild(handle);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelActiveTransition();
    for (const handle of mounted) {
      handle.remove?.();
      if (handle.parentNode === root) root.removeChild(handle);
    }
    mounted.clear();
  }

  return Object.freeze({ mount, crossfade, unmount, destroy });
}
