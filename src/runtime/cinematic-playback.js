import { createSceneClock } from "../motion/scene-clock.js";
import { createCinematicDirector } from "./cinematic-director.js";
import { sampleCameraTrack } from "../camera/camera-track.js";

/** One scene session. The host schedules tick() and owns its visual root. */
export function createCinematicPlayback({ pack, characterStage, audio, present, onEvent,
  reducedMotion = false, now }) {
  if (typeof present !== "function") throw new TypeError("A presentation callback is required");
  const duration = pack.scene.durationMs;
  const clock = createSceneClock({ durationMs: duration, now });
  const director = createCinematicDirector({ characterStage, audio, timeline: pack.timeline, onEvent });
  const tracks = Object.entries(pack.layerTracks);
  let state = "new";
  let queue = Promise.resolve();
  let closing = false;

  function run(action) {
    if (closing) return Promise.reject(new Error("Playback has been closed"));
    const work = queue.then(action);
    queue = work.catch(() => {});
    return work;
  }
  function render(timeMs) {
    const t = reducedMotion ? 0 : timeMs;
    const layers = Object.fromEntries(tracks.map(([id, track]) => [id, sampleCameraTrack(track, t)]));
    return present({ timeMs, state, camera: sampleCameraTrack(pack.camera, t), layers });
  }
  async function prepare() {
    if (state !== "new") return;
    await director.mount();
    await characterStage?.update(0);
    state = "ready";
    await render(0);
  }
  async function start() {
    await prepare();
    if (state === "playing") return;
    if (state === "ended") return restart();
    if (state === "paused") director.resume(clock.time());
    const t = clock.time();
    await director.update(t);
    clock.resume();
    state = "playing";
    await render(t);
  }
  async function restart() {
    clock.pause();
    clock.seek(0);
    director.unmount();
    state = "new";
    await start();
  }
  async function advance(t, next) {
    await director.update(t);
    if (next !== "playing") {
      clock.pause();
      clock.seek(t);
      audio?.stopAll();
      director.pause(t);
    }
    state = next;
    await render(t);
  }
  return Object.freeze({
    mount: () => run(prepare),
    play: () => run(start),
    resume: () => run(start),
    replay: () => run(restart),
    pause: () => run(async () => {
      if (state === "playing") await advance(clock.pause(), "paused");
    }),
    tick: () => run(async () => {
      if (state !== "playing") return;
      const t = clock.time();
      await advance(t, t >= duration ? "ended" : "playing");
    }),
    seek: ms => run(async () => {
      await prepare();
      const t = clock.seek(ms);
      await director.seek(t);
      if (state !== "playing" || t >= duration) {
        clock.pause();
        clock.seek(t);
        director.pause(t);
        state = t >= duration ? "ended" : "paused";
      }
      await render(t);
    }),
    destroy() {
      closing = true;
      const work = queue.then(async () => {
        clock.pause();
        await director.destroy();
        state = "closed";
      });
      queue = work.catch(() => {});
      return work;
    },
    get state() { return state; }
  });
}
