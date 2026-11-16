/**
 * Coordinates scene mounting and host-provided visual transitions.
 * The host owns rendering details; this class owns ordering, supersession,
 * rollback, and lifecycle cleanup.
 */
export class SceneTransitionManager {
  #mount;
  #crossfade;
  #unmount;
  #duration;
  #current = null;
  #generation = 0;
  #destroyed = false;

  constructor({ mount, crossfade, unmount, duration = 350 } = {}) {
    if (typeof mount !== "function") throw new TypeError("SceneTransitionManager requires mount()");
    if (typeof crossfade !== "function") throw new TypeError("SceneTransitionManager requires crossfade()");
    if (typeof unmount !== "function") throw new TypeError("SceneTransitionManager requires unmount()");
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("Transition duration must be a non-negative finite number");
    }
    this.#mount = mount;
    this.#crossfade = crossfade;
    this.#unmount = unmount;
    this.#duration = duration;
  }

  get current() {
    return this.#current;
  }

  /**
   * Mount the next scene before fading, so the current scene remains visible
   * while assets are prepared. Failed mounts/transitions preserve the current.
   */
  async transitionTo(scene, profile, { duration = this.#duration } = {}) {
    if (this.#destroyed) throw new Error("SceneTransitionManager has been destroyed");
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("Transition duration must be a non-negative finite number");
    }

    const generation = ++this.#generation;
    const previous = this.#current;
    let next;
    let committed = false;
    let nextReleaseAttempted = false;

    const releaseCandidate = async () => {
      if (next == null || next === this.#current || nextReleaseAttempted) return;
      // Mark before awaiting so a failed unmount is never attempted twice.
      nextReleaseAttempted = true;
      await this.#unmount(next);
    };

    try {
      next = await this.#mount(scene, profile);
      if (next == null) throw new TypeError("mount() must return a scene handle");
      if (generation !== this.#generation || this.#destroyed) {
        await releaseCandidate();
        return false;
      }

      const completed = await this.#crossfade({ from: previous, to: next, duration, generation });
      // A transition adapter may explicitly report cancellation without
      // throwing. Treat that as an aborted transition: retain the previous
      // scene and release the candidate rather than committing it.
      if (completed === false || generation !== this.#generation || this.#destroyed) {
        await releaseCandidate();
        return false;
      }

      this.#current = next;
      committed = true;
      // Once the new scene is committed, a cleanup failure for the old scene
      // must not roll the current handle back to an already-released scene.
      if (previous != null && previous !== next) await this.#unmount(previous);
      return true;
    } catch (error) {
      try {
        await releaseCandidate();
      } catch {
        // Preserve the transition/cleanup error that first caused the failure.
      }
      if (!committed && generation === this.#generation && !this.#destroyed) {
        this.#current = previous;
      }
      throw error;
    }
  }

  /** Invalidate pending work and unmount the active scene. */
  async clear() {
    this.#generation += 1;
    const previous = this.#current;
    this.#current = null;
    if (previous != null) await this.#unmount(previous);
  }

  async destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    await this.clear();
    // Keep adapters available until in-flight transitions settle. A mount
    // may resolve after destroy(); that stale handle still needs unmount().
  }
}
