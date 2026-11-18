const TERMINAL_STATES = new Set(["completed", "skipped", "cancelled", "failed"]);

/**
 * Run the shared QARTON brand opener followed by a game-specific intro.
 * Rendering, audio, asset loading, and frame scheduling remain host-owned.
 */
export function createIntroSequence({
  playBrandIntro,
  playGameIntro,
  onStageChange = () => {}
} = {}) {
  if (typeof playBrandIntro !== "function") {
    throw new TypeError("Intro sequence requires playBrandIntro()");
  }
  if (typeof playGameIntro !== "function") {
    throw new TypeError("Intro sequence requires playGameIntro()");
  }
  if (typeof onStageChange !== "function") {
    throw new TypeError("onStageChange must be a function");
  }

  let state = "idle";
  let runPromise = null;
  let activeController = null;

  function setState(next) {
    state = next;
    onStageChange(next);
  }

  async function runStage(name, play) {
    if (TERMINAL_STATES.has(state)) return false;

    const controller = new AbortController();
    activeController = controller;
    setState(name);

    let removeAbortListener = () => {};
    const aborted = new Promise(resolve => {
      const onAbort = () => resolve(false);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) onAbort();
    });

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => play({ signal: controller.signal, stage: name }))
          .then(() => true),
        aborted
      ]);
      return result && !controller.signal.aborted && !TERMINAL_STATES.has(state);
    } finally {
      removeAbortListener();
      if (activeController === controller) activeController = null;
    }
  }

  function start() {
    if (runPromise) return runPromise;
    if (state !== "idle") return Promise.resolve(state);

    runPromise = (async () => {
      try {
        if (!await runStage("brand", playBrandIntro)) return state;
        if (!await runStage("game", playGameIntro)) return state;
        if (!TERMINAL_STATES.has(state)) setState("completed");
        return state;
      } catch (error) {
        if (!TERMINAL_STATES.has(state)) setState("failed");
        throw error;
      } finally {
        activeController = null;
      }
    })();
    return runPromise;
  }

  function stop(nextState) {
    if (TERMINAL_STATES.has(state)) return state;
    if (state === "idle") {
      setState(nextState);
      return state;
    }
    setState(nextState);
    activeController?.abort();
    return state;
  }

  return Object.freeze({
    start,
    skip: () => stop("skipped"),
    cancel: () => stop("cancelled"),
    get state() { return state; }
  });
}
