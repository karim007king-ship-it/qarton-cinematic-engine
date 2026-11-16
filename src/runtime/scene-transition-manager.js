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
  #ownedHandles = new Set();
  #releaseInFlight = new Map();
  #destroyPromise = null;
  #pendingTransitions = new Set();

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

  async #release(handle) {
    if (handle == null || !this.#ownedHandles.has(handle)) return;
    const pending = this.#releaseInFlight.get(handle);
    if (pending) return pending;

    const release = (async () => {
      // Keep ownership until unmount succeeds. A later clear()/destroy() can
      // retry transient cleanup failures instead of losing the scene handle.
      await this.#unmount(handle);
      this.#ownedHandles.delete(handle);
    })();
    this.#releaseInFlight.set(handle, release);
    try {
      await release;
    } finally {
      if (this.#releaseInFlight.get(handle) === release) {
        this.#releaseInFlight.delete(handle);
      }
    }
  }

  /**
   * Mount the next scene before fading, so the current scene remains visible
   * while assets are prepared. Failed mounts/transitions preserve the current.
   */
  transitionTo(scene, profile, { duration = this.#duration } = {}) {
    if (this.#destroyed) return Promise.reject(new Error("SceneTransitionManager has been destroyed"));
    if (!Number.isFinite(duration) || duration < 0) {
      return Promise.reject(new TypeError("Transition duration must be a non-negative finite number"));
    }

    const operation = this.#performTransition(scene, profile, duration);
    const tracked = operation.finally(() => this.#pendingTransitions.delete(tracked));
    this.#pendingTransitions.add(tracked);
    return tracked;
  }

  async #performTransition(scene, profile, duration) {

    const generation = ++this.#generation;
    const previous = this.#current;
    let next = null;
    const isCurrentRequest = () => generation === this.#generation && !this.#destroyed;
    const releaseCandidate = async () => {
      if (next == null || next === this.#current) return;
      await this.#release(next);
    };

    try {
      next = await this.#mount(scene, profile);
      if (next == null) throw new TypeError("mount() must return a scene handle");
      this.#ownedHandles.add(next);
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
      if (completed === false || !isCurrentRequest()) {
        await releaseCandidate();
        return false;
      }
    } catch (error) {
      try {
        await releaseCandidate();
      } catch {
        // Keep the failed handle owned so clear()/destroy() can retry it.
      }
      if (isCurrentRequest()) this.#current = previous;
      throw error;
    }

    // Commit only after the adapter confirms that the visual transition
    // completed. Retirement of the old scene is a separate cleanup phase.
    this.#current = next;
    if (previous != null && previous !== next) await this.#release(previous);
    return true;
  }

  /** Invalidate pending work and attempt to release every owned scene. */
  async clear() {
    this.#generation += 1;
    this.#current = null;

    // Let invalidated transitions finish their rollback first. Hosts that
    // own a cancellable adapter must cancel its active visual transition before
    // calling destroy(); the composed CinematicRuntime enforces that ordering.
    const transitions = await Promise.allSettled([...this.#pendingTransitions]);
    const errors = transitions
      .filter(result => result.status === "rejected")
      .map(result => result.reason);

    const releases = await Promise.allSettled(
      [...this.#ownedHandles].map(handle => this.#release(handle))
    );
    errors.push(...releases
      .filter(result => result.status === "rejected")
      .map(result => result.reason));

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more scene transitions or handles could not be cleaned up");
    }
  }

  /** Invalidate pending work and release all scenes; failed cleanup is retryable. */
  destroy() {
    this.#destroyed = true;
    if (this.#destroyPromise) return this.#destroyPromise;
    this.#destroyPromise = this.clear().finally(() => {
      this.#destroyPromise = null;
    });
    return this.#destroyPromise;
  }
}
