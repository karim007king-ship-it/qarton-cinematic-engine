import { AssetManager } from "../assets/asset-manager.js";
import { createAdaptivePerformanceMonitor, createRuntimeActivityGate } from "./adaptive-performance.js";
import { createDOMTransitionAdapter } from "./dom-transition-adapter.js";
import { SceneTransitionManager } from "./scene-transition-manager.js";
import { createPageLifecycleAdapter } from "./page-lifecycle-adapter.js";

/**
 * Compose the independent runtime modules into one host-facing engine.
 * renderScene(scene, profile, { assets }) returns a DOM element; the host
 * controls drawing, asset manifests, audio ownership, and frame scheduling.
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
  onResume = () => {},
  onAudioError = () => {},
  onLifecycleError = () => {},
  audioController,
  lifecycleTarget,
  lifecyclePageTarget
} = {}) {
  if (typeof loadAsset !== "function") throw new TypeError("Cinematic runtime requires loadAsset()");
  if (typeof renderScene !== "function") throw new TypeError("Cinematic runtime requires renderScene()");
  if (typeof onAudioError !== "function") throw new TypeError("onAudioError must be a function");
  if (typeof onLifecycleError !== "function") throw new TypeError("onLifecycleError must be a function");
  if (audioController != null
    && (typeof audioController.pause !== "function" || typeof audioController.resume !== "function")) {
    throw new TypeError("audioController must expose pause() and resume()");
  }
  let destroyed = false;
  let destroyPromise = null;

  function reportLifecycleError(error, phase) {
    try { onLifecycleError(error, { phase }); } catch { /* diagnostics must not break lifecycle */ }
  }

  function syncAudioLifecycle(phase) {
    if (!audioController) return;
    try {
      audioController[phase]();
    } catch (error) {
      // Audio failure must not prevent the runtime activity gate from closing
      // or reopening. The host can log the error and offer a user-gesture retry.
      try { onAudioError(error, { phase }); } catch { /* diagnostics must not break lifecycle */ }
    }
  }

  const assets = new AssetManager({ loader: loadAsset });
  const adaptive = createAdaptivePerformanceMonitor({ device, onProfileChange });
  const activity = createRuntimeActivityGate({
    onPause: () => {
      adaptive.clearSamples();
      syncAudioLifecycle("pause");
      try { onPause(); } catch (error) { reportLifecycleError(error, "pause"); }
    },
    onResume: () => {
      adaptive.clearSamples();
      syncAudioLifecycle("resume");
      try { onResume(); } catch (error) { reportLifecycleError(error, "resume"); }
    }
  });
  const pageLifecycle = lifecycleTarget
    ? createPageLifecycleAdapter({
      target: lifecycleTarget,
      pageTarget: lifecyclePageTarget ?? lifecycleTarget,
      setActive: nextActive => {
        // A failed listener removal must not let a late page event call a destroyed activity gate.
        if (!destroyed) activity.setActive(nextActive);
      }
    })
    : null;
  const transitionOptions = { root, duration, reducedMotion };
  if (wait !== undefined) transitionOptions.wait = wait;
  if (nextFrame !== undefined) transitionOptions.nextFrame = nextFrame;
  if (animate !== undefined) transitionOptions.animate = animate;
  const dom = createDOMTransitionAdapter({
    ...transitionOptions,
    renderScene: (scene, profile) => renderScene(scene, profile, { assets })
  });
  const scenes = new SceneTransitionManager({
    mount: dom.mount, crossfade: dom.crossfade, unmount: dom.unmount, duration
  });

  // Opt-in only: existing hosts remain unchanged unless they inject a lifecycle target.
  pageLifecycle?.start();

  async function transitionTo(scene, { profile = adaptive.getProfile(), duration: transitionDuration } = {}) {
    if (destroyed) throw new Error("Cinematic runtime has been destroyed");
    const options = transitionDuration === undefined ? {} : { duration: transitionDuration };
    return scenes.transitionTo(scene, profile, options);
  }

  function destroy() {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    destroyPromise = (async () => {
      const errors = [];
      for (const cleanup of [
        () => pageLifecycle?.stop(),
        () => activity.destroy(),
        () => dom.destroy(),
        () => scenes.destroy(),
        () => assets.destroy()
      ]) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "One or more cinematic runtime resources could not be destroyed");
      }
    })().finally(() => { destroyPromise = null; });
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
    releaseAsset: key => {
      if (destroyed) throw new Error("Cinematic runtime has been destroyed");
      return assets.release(key);
    },
    cancelAsset: (key, reason) => {
      if (destroyed) throw new Error("Cinematic runtime has been destroyed");
      return assets.cancel(key, reason);
    },
    clearAssets: () => {
      if (destroyed) throw new Error("Cinematic runtime has been destroyed");
      assets.clear();
    },
    recordFrame: frameDurationMs => {
      if (destroyed) throw new Error("Cinematic runtime has been destroyed");
      if (!activity.isActive()) {
        return Object.freeze({ profile: adaptive.getProfile(), evaluated: false, averageFps: null, skipped: true });
      }
      return adaptive.recordFrame(frameDurationMs);
    },
    getProfile: adaptive.getProfile,
    setActive: activity.setActive,
    isActive: activity.isActive,
    startPageLifecycle: () => pageLifecycle?.start() ?? false,
    stopPageLifecycle: () => pageLifecycle?.stop() ?? false,
    syncPageLifecycle: () => pageLifecycle?.sync() ?? false,
    get pageLifecycleState() { return pageLifecycle?.getState() ?? null; },
    get currentScene() { return scenes.current; },
    destroy
  });
}
