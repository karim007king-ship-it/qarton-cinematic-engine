/**
 * Optional DOM overlay adapter for cinematic visual treatments.
 * The host supplies a positioned scene viewport. The adapter owns only three
 * pointer-transparent overlays and never reads browser globals.
 */
export function createDOMVisualTreatmentAdapter({ root, document = root?.ownerDocument } = {}) {
  if (!root || typeof root.appendChild !== "function") {
    throw new TypeError("Visual treatment adapter requires a root element");
  }
  if (!document || typeof document.createElement !== "function") {
    throw new TypeError("Visual treatment adapter requires a DOM document");
  }

  const overlays = {
    vignette: document.createElement("div"),
    bloom: document.createElement("div"),
    grain: document.createElement("div")
  };
  let destroyed = false;
  const animationStyles = document.createElement("style");
  animationStyles.textContent = "@keyframes qarton-film-grain { 0% { transform: translate3d(0,0,0); } 25% { transform: translate3d(-1px,1px,0); } 50% { transform: translate3d(1px,-1px,0); } 75% { transform: translate3d(-1px,-1px,0); } 100% { transform: translate3d(0,0,0); } }";
  const styleHost = document.head && typeof document.head.appendChild === "function" ? document.head : root;
  styleHost.appendChild(animationStyles);

  for (const [name, element] of Object.entries(overlays)) {
    element.className = `qarton-visual-treatment qarton-visual-treatment--${name}`;
    element.setAttribute?.("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      opacity: "0",
      zIndex: name === "vignette" ? "20" : name === "bloom" ? "19" : "21"
    });
    root.appendChild(element);
  }

  function apply(treatment = {}) {
    if (destroyed) throw new Error("Visual treatment adapter has been destroyed");
    const { vignetteOpacity = 0, bloomOpacity = 0, grainOpacity = 0, grainAnimated = false } = treatment;
    const values = [vignetteOpacity, bloomOpacity, grainOpacity];
    if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new TypeError("Visual treatment overlay opacities must be between 0 and 1");
    }

    overlays.vignette.style.background =
      "radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,.88) 100%)";
    overlays.vignette.style.opacity = String(vignetteOpacity);
    overlays.bloom.style.background =
      "radial-gradient(ellipse at 50% 38%, rgba(255,238,205,.72), transparent 68%)";
    overlays.bloom.style.mixBlendMode = "screen";
    overlays.bloom.style.opacity = String(bloomOpacity);
    overlays.grain.style.backgroundImage = [
      "repeating-radial-gradient(circle at 17% 31%, rgba(255,255,255,.22) 0 0.45px, transparent .6px 2.4px)",
      "repeating-radial-gradient(circle at 73% 68%, rgba(0,0,0,.2) 0 0.5px, transparent .7px 2.8px)"
    ].join(",");
    overlays.grain.style.backgroundSize = "7px 7px, 9px 9px";
    overlays.grain.style.mixBlendMode = "soft-light";
    overlays.grain.style.opacity = String(grainOpacity);
    overlays.grain.style.animation = grainAnimated && grainOpacity > 0
      ? "qarton-film-grain 180ms steps(2) infinite"
      : "none";
    return true;
  }

  function clear() {
    if (destroyed) return;
    for (const element of Object.values(overlays)) {
      element.style.opacity = "0";
      element.style.animation = "none";
    }
  }

  function removeElement(element, parent) {
    try {
      element.remove?.();
    } catch {
      // Fall back to the injected parent when a host remove() implementation fails.
    }
    if (element.parentNode === parent) {
      try {
        parent.removeChild(element);
      } catch {
        // Continue releasing the remaining overlays.
      }
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const element of Object.values(overlays)) {
      try {
        element.style.opacity = "0";
        element.style.animation = "none";
      } catch {
        // A broken host style object must not block the remaining teardown.
      }
    }
    removeElement(animationStyles, styleHost);
    for (const element of Object.values(overlays)) removeElement(element, root);
  }

  return Object.freeze({ apply, clear, destroy, elements: Object.freeze({ ...overlays }) });
}
