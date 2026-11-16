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
    let next = null;
    let nextReleased = false;
    const isCurrentRequest = () => generation === this.#generation && !this.#destroyed;
    const releaseCandidate = async () => {
      if (next == null || nextReleased || next === this.#current) return;
      // Mark before awaiting so a failing unmount is never invoked twice.
      nextReleased = true;
      await this.#unmount(next);
    };

    try {
      next = await this.#mount(scene, profile);
      if (next == null) throw new TypeError("mount() must return a scene handle");
      if (!isCurrentRequest()) {
        await releaseCandidate();
        return false;
      }

      const completed = await this.#crossfade({
        from: previous,
        to: next,
        duration,
        generation
      });
      // A transition adapter may explicitly report cancellation without
      // throwing. Such a result must never be committed as the current scene.
      if (completed === false || !isCurrentRequest()) {
        await releaseCandidate();
        return false;
      }
    } catch (error) {
      try {
        await releaseCandidate();
      } catch {
        // Preserve the mount/crossfade error; cleanup is best-effort here.
      }
      if (isCurrentRequest()) this.#current = previous;
      throw error;
    }

    // Commit only after the adapter confirms that the visual transition
    // completed. Retirement of the old scene is a separate cleanup phase:
    // if its unmount fails, do not roll back to a scene that may be half-removed.
    this.#current = next;
    if (previous != null && previous !== next) await this.#unmount(previous);
    return true;
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
