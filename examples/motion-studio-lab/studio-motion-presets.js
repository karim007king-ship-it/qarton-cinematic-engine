import { createCameraTrack, sampleCameraTrack } from "../../src/camera/camera-track.js";

export const CAMERA_MOTION_PRESETS = Object.freeze([
  Object.freeze({ id: "zoom-in", label: "تقريب" }),
  Object.freeze({ id: "zoom-out", label: "إبعاد" }),
  Object.freeze({ id: "static", label: "كاميرا ثابتة" }),
  Object.freeze({ id: "pan-horizontal", label: "تحريك يمين ويسار" }),
  Object.freeze({ id: "pan-vertical", label: "تحريك أعلى وأسفل" }),
  Object.freeze({ id: "cinematic", label: "حركة سينمائية مركبة" })
]);

const DEFAULT_POSE = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function cameraSampler(project) {
  if (!Array.isArray(project?.camera) || project.camera.length === 0) {
    return () => DEFAULT_POSE;
  }
  const track = createCameraTrack(project.camera.map(({ atMs, value }) => ({ atMs, ...value })));
  return (timeMs) => sampleCameraTrack(track, timeMs);
}

function poseForMotion(preset, base, progress, { viewport, strength, focusX, focusY }) {
  const amount = strength / 100;
  const zoomDelta = 0.42 * amount;
  const focusXOffset = (0.5 - focusX / 100) * viewport.width;
  const focusYOffset = (0.5 - focusY / 100) * viewport.height;
  const baseZoom = base.zoom;
  let zoom = baseZoom;
  let x = base.x;
  let y = base.y;

  if (preset === "zoom-in") {
    zoom = baseZoom * (1 + zoomDelta * progress);
    x += focusXOffset * (zoom / baseZoom - 1);
    y += focusYOffset * (zoom / baseZoom - 1);
  } else if (preset === "zoom-out") {
    zoom = baseZoom * (1 + zoomDelta * (1 - progress));
    x += focusXOffset * (zoom / baseZoom - 1);
    y += focusYOffset * (zoom / baseZoom - 1);
  } else if (preset === "cinematic") {
    zoom = baseZoom * (1 + zoomDelta * 0.55 * progress);
    const travel = viewport.width * 0.035 * amount;
    x += focusXOffset * (zoom / baseZoom - 1) + (progress * 2 - 1) * travel;
    y += focusYOffset * (zoom / baseZoom - 1);
  } else if (preset === "pan-horizontal") {
    const travel = viewport.width * 0.12 * amount;
    x = base.x + focusXOffset * amount + (progress * 2 - 1) * travel;
  } else if (preset === "pan-vertical") {
    const travel = viewport.height * 0.12 * amount;
    y = base.y + focusYOffset * amount + (progress * 2 - 1) * travel;
  } else if (preset !== "static") {
    throw new TypeError(`Unknown camera motion preset: ${preset}`);
  }
  return { x, y, zoom, rotation: base.rotation };
}

/**
 * Replace camera samples only in the requested interval and keep existing
 * samples outside it. `speed` changes the midpoint timing while preserving
 * the chosen start and end boundary; strength is a percentage from 0 to 100.
 */
export function createCameraMotionProject(project, {
  preset, fromSeconds = 0, toSeconds = project?.durationMs / 1000,
  speed = 1, strength = 50, focusX = 50, focusY = 50
} = {}) {
  if (!project || !Number.isSafeInteger(project.durationMs) || !project.viewport) {
    throw new TypeError("A valid Motion Studio project is required");
  }
  if (!CAMERA_MOTION_PRESETS.some((item) => item.id === preset)) throw new TypeError("Unknown camera motion preset");
  finite(fromSeconds, "Start time", 0, project.durationMs / 1000);
  finite(toSeconds, "End time", 0, project.durationMs / 1000);
  finite(speed, "Speed", 0.5, 2);
  finite(strength, "Strength", 0, 100);
  finite(focusX, "Focus X", 0, 100);
  finite(focusY, "Focus Y", 0, 100);
  const startMs = Math.round(fromSeconds * 1000);
  const endMs = Math.round(toSeconds * 1000);
  if (startMs >= endMs) throw new RangeError("End time must be later than start time");

  const sample = cameraSampler(project);
  const viewport = project.viewport;
  const middleProgress = 0.5;
  const midpointMs = Math.max(startMs + 1, Math.min(endMs - 1,
    Math.round(startMs + (endMs - startMs) * Math.pow(middleProgress, speed))));
  const options = { viewport, strength, focusX, focusY };
  const startPose = sample(startMs);
  const endPose = sample(endMs);
  const anchor = preset === "static" ? startPose : null;
  const generated = [
    { atMs: startMs, value: poseForMotion(preset, startPose, 0, options) },
    ...(endMs - startMs > 1 ? [{ atMs: midpointMs, value: poseForMotion(preset, anchor ?? sample(midpointMs), middleProgress, options) }] : []),
    { atMs: endMs, value: poseForMotion(preset, anchor ?? endPose, 1, options) }
  ];
  const outside = (project.camera ?? []).filter(({ atMs }) => atMs < startMs || atMs > endMs)
    .map(({ atMs, value }) => ({ atMs, value: { ...value } }));
  const cameraByTime = new Map(outside.map((frame) => [frame.atMs, frame]));
  for (const frame of generated) cameraByTime.set(frame.atMs, frame);
  const camera = [...cameraByTime.values()].sort((a, b) => a.atMs - b.atMs);
  if (camera[0].atMs > 0) camera.unshift({ atMs: 0, value: { ...sample(0) } });
  if (camera.at(-1).atMs < project.durationMs) camera.push({ atMs: project.durationMs, value: { ...sample(project.durationMs) } });
  return { ...project, camera };
}
