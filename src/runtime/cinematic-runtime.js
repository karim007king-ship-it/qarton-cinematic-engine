import { AssetManager } from "../assets/asset-manager.js";
import { createAdaptivePerformanceMonitor, createRuntimeActivityGate } from "./adaptive-performance.js";
import { createDOMTransitionAdapter } from "./dom-transition-adapter.js";
import { SceneTransitionManager } from "./scene-transition-manager.js";

/**
 * Compose the independent runtime modules into one host-facing engine.
 * renderScene(scene, profile, { assets }) returns a DOM element; the host
 * controls drawing, asset manifests, audio, and lifecycle notifications.
 */
export function createCinematicRuntime({
  root,
  loadAsset,
  renderScene,
  device = {},
  duration = 350,
  reducedMotion = device.reducedMotion === true,
  wait,
  nextFrame,
  animate,
  onProfileChange = () => {},
  onPause = () => {},
  onResume = () => {}
} = {}) {
  if (typeof loadAsset !== "function") throw new TypeError("Cinematic runtime requires loadAsset()");
  if (typeof renderScene !== "function") throw new TypeError("Cinematic runtime requires renderScene()");
  let destroyed = false;
  let destroyPromise = null;

  const assets = new AssetManager({ loader: loadAsset });
  const adaptive = createAdaptivePerformanceMonitor({ device, onProfileChange });
  const activity = createRuntimeActivityGate({ onPause, onResume });
  const transitionOptions = { root, duration, reducedMotion };
  if (wait !== undefined) transitionOptions.wait = wait;
  if (nextFrame !== undefined) transitionOptions.nextFrame = nextFrame;
  if (animate !== undefined) transitionOptions.animate = animate;
  const dom = createDOMTransitionAdapter({
    ...transitionOptions,
    renderScene: (scene, profile) => renderScene(scene, profile, { assets })
  });
  const scenes = new SceneTransitionManager({
    mount: dom.mount,
    crossfade: dom.crossfade,
    unmount: dom.unmount,
    duration
  });

  async function transitionTo(scene, { profile = adaptive.getProfile(), duration: transitionDuration } = {}) {
    if (destroyed) throw new Error("Cinematic runtime has been destroyed");
    const options = transitionDuration === undefined ? {} : { duration: transitionDuration };
    return scenes.transitionTo(scene, profile, options);
  }

  function destroy() {
    if (destroyPromise) return destroyPromise;
    if (destroyed) return Promise.resolve();
    destroyed = true;
    destroyPromise = (async () => {
      try {
        await scenes.destroy();
      } finally {
        dom.destroy();
        assets.destroy();
        activity.destroy();
      }
    })();
    return destroyPromise;
  }

  return Object.freeze({
    transitionTo,
    loadAsset: (key, metadata) => {
      if (destroyed) return Promise.reject(new Error("Cinematic runtime has been destroyed"));
      return assets.load(key, metadata);
    },
    preloadAssets: keys => {
      if (destroyed) return Promise.reject(new Error("Cinematic runtime has been destroyed"));
      return assets.preload(keys);
    },
    recordFrame: frameDurationMs => {
      if (destroyed) throw new Error("Cinematic runtime has been destroyed");
      return adaptive.recordFrame(frameDurationMs);
    },
    getProfile: adaptive.getProfile,
    setActive: activity.setActive,
    get currentScene() { return scenes.current; },
    destroy
  });
}
