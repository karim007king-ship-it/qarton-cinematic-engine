import { compileCinematicAudioProject } from "../../../src/audio/cinematic-audio-core.js";

export const EXPORT_LIMITS = Object.freeze({
  projectDurationMs: 300_000,
  outputBytes: 24 * 1024 * 1024,
  pcmBytes: 32 * 1024 * 1024,
  canvasPixels: 8_388_608,
  audioSampleRate: 48_000,
  audioChannels: 2,
  audioBytesPerSample: 4,
  estimateHeadroom: 1.2
});

export const EXPORT_PROFILES = Object.freeze({
  "480p": Object.freeze({ shortEdge: 480, longEdge: 854, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000 }),
  "720p": Object.freeze({ shortEdge: 720, longEdge: 1280, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 }),
  "1080p": Object.freeze({ shortEdge: 1080, longEdge: 1920, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 })
});

const FORMAT_ORDER = Object.freeze({ mp4: 0, webm: 1 });
const MIMES = Object.freeze({ mp4: /^video\/mp4(?:;|$)/iu, webm: /^video\/webm(?:;|$)/iu });
const ownObject = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class ExportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) { throw new ExportError(code, message, details); }
function assertKeys(value, allowed, label) {
  if (!ownObject(value) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key))) {
    fail("INVALID_REQUEST", `${label} has invalid fields`);
  }
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_REQUEST", `${label} must be an integer in [${min}, ${max}]`);
  return value;
}
function finite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) fail("INVALID_REQUEST", `${label} must be finite and in [${min}, ${max}]`);
  return value;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function validateProject(snapshot) {
  assertKeys(snapshot, ["project", "audioTracks", "audioAssets", "audioAssetInfo", "audioMasterVolume", "characterTrack", "visualEffectsTrack"], "snapshot");
  const project = snapshot.project;
  if (!ownObject(project) || project.version !== 1 || !ownObject(project.viewport)) fail("INVALID_REQUEST", "Snapshot needs a StudioProjectV1 project");
  integer(project.durationMs, 1, EXPORT_LIMITS.projectDurationMs, "project.durationMs");
  const { width, height, fps } = project.viewport;
  integer(width, 1, 4096, "project.viewport.width");
  integer(height, 1, 4096, "project.viewport.height");
  if (width * height > EXPORT_LIMITS.canvasPixels) fail("BUDGET_EXCEEDED", "Project viewport exceeds the Canvas pixel budget");
  integer(fps, 1, 60, "project.viewport.fps");
  const audioTracks = snapshot.audioTracks ?? [];
  let audioProject;
  try { audioProject = compileCinematicAudioProject({ durationMs: project.durationMs, tracks: audioTracks }); }
  catch (error) { fail("INVALID_REQUEST", `Audio project is invalid: ${error.message}`); }
  const audioAssets = snapshot.audioAssets ?? [];
  if (!Array.isArray(audioAssets) || audioAssets.some(asset => !ownObject(asset) || typeof asset.id !== "string" || !asset.id.trim()) ||
      new Set(audioAssets.map(asset => asset.id)).size !== audioAssets.length) fail("INVALID_REQUEST", "Audio asset metadata is invalid");
  const referenced = new Set(audioProject.clips.map(clip => clip.asset));
  const assetIds = new Set(audioAssets.map(asset => asset.id));
  if ([...referenced].some(id => !assetIds.has(id))) fail("INVALID_REQUEST", "An audio clip references unknown asset metadata");
  const master = finite(snapshot.audioMasterVolume ?? 1, 0, 1, "audioMasterVolume");
  const audioAssetInfo = snapshot.audioAssetInfo ?? [];
  if (!Array.isArray(audioAssetInfo) || audioAssetInfo.some(info => !ownObject(info) || typeof info.id !== "string" ||
      !Number.isSafeInteger(info.durationMs) || info.durationMs < 1 || info.durationMs > 3_600_000 ||
      (info.channels !== undefined && ![1, 2].includes(info.channels)) ||
      (info.sampleRate !== undefined && (!Number.isSafeInteger(info.sampleRate) || info.sampleRate < 8_000 || info.sampleRate > 192_000)))) {
    fail("INVALID_REQUEST", "Decoded audio metadata is invalid");
  }
  const infoById = new Map(audioAssetInfo.map(info => [info.id, info]));
  if (new Set(audioAssetInfo.map(info => info.id)).size !== audioAssetInfo.length) fail("INVALID_REQUEST", "Audio duration metadata contains duplicate assets");
  for (const info of audioAssetInfo) {
    if (!assetIds.has(info.id)) fail("INVALID_REQUEST", `Audio metadata references an unknown asset: ${info.id}`);
    finite(info.sampleRate ?? 48_000, 8_000, 192_000, `audioAssetInfo(${info.id}).sampleRate`);
  }
  return { project, audioProject, audioAssets, audioAssetInfo, audioMasterVolume: master, audioInfoById: infoById };
}

function validateRequest(request, project) {
  const value = request ?? {};
  assertKeys(value, ["range", "quality", "fps", "format", "audio", "missingAudio"], "request");
  const range = value.range ?? { startMs: 0, endMs: project.durationMs };
  assertKeys(range, ["startMs", "endMs"], "request.range");
  const startMs = integer(range.startMs, 0, project.durationMs - 1, "range.startMs");
  const endMs = integer(range.endMs, startMs + 1, project.durationMs, "range.endMs");
  const quality = value.quality ?? "720p";
  if (!Object.hasOwn(EXPORT_PROFILES, quality)) fail("INVALID_REQUEST", "quality must be 480p, 720p, or 1080p");
  const fps = integer(value.fps ?? project.viewport.fps, 1, 60, "fps");
  const format = value.format ?? "auto";
  if (!Object.hasOwn({ auto: true, mp4: true, webm: true }, format)) fail("INVALID_REQUEST", "format must be auto, mp4, or webm");
  const audio = value.audio ?? "mix";
  if (audio !== "mix" && audio !== "none") fail("INVALID_REQUEST", "audio must be mix or none");
  const missingAudio = value.missingAudio ?? "error";
  if (missingAudio !== "error" && missingAudio !== "silence") fail("INVALID_REQUEST", "missingAudio must be error or silence");
  return { startMs, endMs, durationMs: endMs - startMs, quality, fps, format, audio, missingAudio };
}

export function rasterForQuality(viewport, quality) {
  const profile = EXPORT_PROFILES[quality];
  if (!profile) fail("INVALID_REQUEST", `Unsupported export quality: ${quality}`);
  const scale = Math.min(1, profile.shortEdge / Math.min(viewport.width, viewport.height), profile.longEdge / Math.max(viewport.width, viewport.height));
  const makeEven = value => Math.max(2, Math.floor(value * scale / 2) * 2);
  const width = makeEven(viewport.width), height = makeEven(viewport.height);
  if (width * height > EXPORT_LIMITS.canvasPixels) fail("BUDGET_EXCEEDED", "Export canvas exceeds the pixel budget");
  return Object.freeze({ width, height });
}

function decodedPcmBytes(audioProject, infoById, requestRange, masterVolume) {
  if (masterVolume === 0) return 0;
  const ids = new Set(audioProject.clips.filter(clip => clip.startMs < requestRange.endMs && clip.endMs > requestRange.startMs &&
    clip.volume > 0 && clip.trackVolume > 0).map(clip => clip.asset));
  let total = 0;
  for (const id of ids) {
    const info = infoById.get(id);
    const bytes = Math.ceil(info.durationMs / 1000 * (info.channels ?? 2) * (info.sampleRate ?? 48_000) * EXPORT_LIMITS.audioBytesPerSample);
    total += bytes;
    if (total > EXPORT_LIMITS.pcmBytes) fail("BUDGET_EXCEEDED", "Decoded audio assets exceed the 32 MiB PCM budget", { assetId: id, estimatedPcmBytes: total });
  }
  return total;
}

function peakConcurrentGain(audioProject, requestRange, masterVolume) {
  if (masterVolume === 0) return 0;
  const clips = audioProject.clips.filter(clip => clip.startMs < requestRange.endMs && clip.endMs > requestRange.startMs && clip.volume > 0 && clip.trackVolume > 0);
  const points = clips.flatMap(clip => [Math.max(clip.startMs, requestRange.startMs), Math.min(clip.endMs, requestRange.endMs)])
    .sort((a, b) => a - b);
  let peak = 0;
  for (const atMs of points) {
    const concurrent = clips.filter(clip => clip.startMs <= atMs && clip.endMs > atMs)
      .reduce((sum, clip) => sum + clip.volume * clip.trackVolume, 0) * masterVolume;
    peak = Math.max(peak, concurrent);
  }
  return peak;
}

function candidateMatches(capability, mimeType, raster, fps, audioMode) {
  return capability?.verification === "verified" && capability.mimeType === mimeType &&
    capability.width === raster.width && capability.height === raster.height && capability.fps === fps && capability.audioMode === audioMode;
}

function selectCapability(capabilities, request, raster) {
  if (!Array.isArray(capabilities)) fail("UNSUPPORTED_FORMAT", "Verified export capabilities are required");
  const candidates = request.format === "auto" ? ["mp4", "webm"] : [request.format];
  let selected;
  for (const format of candidates) {
    selected = capabilities.find(capability => MIMES[format].test(capability?.mimeType ?? "") &&
      candidateMatches(capability, capability.mimeType, raster, request.fps, request.audio));
    if (selected) break;
  }
  if (!selected) fail("UNSUPPORTED_FORMAT", `No verified ${request.format === "auto" ? "MP4 or WebM" : request.format} capability matches the requested raster, rate, and audio mode`);
  return selected;
}

export function planExport(snapshot, request = {}, capabilities = []) {
  const normalized = validateProject(snapshot);
  const options = validateRequest(request, normalized.project);
  const raster = rasterForQuality(normalized.project.viewport, options.quality);
  const range = Object.freeze({ startMs: options.startMs, endMs: options.endMs });
  const audioProject = options.audio === "mix" ? normalized.audioProject : compileCinematicAudioProject({ durationMs: normalized.project.durationMs, tracks: [] });
  const activeAudio = options.audio === "mix" ? audioProject.clips.filter(clip => clip.startMs < range.endMs && clip.endMs > range.startMs) : [];
  const availableAudioIds = new Set(normalized.audioAssetInfo.map(info => info.id));
  const missingAudio = [...new Set(activeAudio.map(clip => clip.asset))].filter(id => !availableAudioIds.has(id));
  if (missingAudio.length && options.missingAudio === "error") fail("ASSET_MISSING", "Audio assets are missing", { assetIds: missingAudio });
  const usableAudioProject = options.audio === "mix" ? {
    ...audioProject,
    clips: audioProject.clips.filter(clip => !missingAudio.includes(clip.asset))
  } : audioProject;
  const pcmBytes = options.audio === "mix" ? decodedPcmBytes(usableAudioProject, normalized.audioInfoById, range, normalized.audioMasterVolume) : 0;
  const profile = EXPORT_PROFILES[options.quality];
  const audioBitsPerSecond = options.audio === "mix" ? profile.audioBitsPerSecond : 0;
  const estimatedOutputBytes = Math.ceil(options.durationMs / 1000 * (profile.videoBitsPerSecond + audioBitsPerSecond) / 8 * EXPORT_LIMITS.estimateHeadroom);
  if (estimatedOutputBytes > EXPORT_LIMITS.outputBytes) fail("BUDGET_EXCEEDED", "Estimated output exceeds the 24 MiB recording budget", { estimatedOutputBytes });
  const matched = selectCapability(capabilities, options, raster);
  const concurrentPeak = options.audio === "mix" ? peakConcurrentGain(usableAudioProject, range, normalized.audioMasterVolume) : 0;
  const headroomGain = concurrentPeak > 0 ? Math.min(1, 10 ** (-1 / 20) / concurrentPeak) : 1;
  const headroomDb = headroomGain > 0 ? -20 * Math.log10(headroomGain) : 0;
  const clips = activeAudio.filter(clip => !missingAudio.includes(clip.asset)).map(clip => Object.freeze({
    id: clip.id, trackId: clip.trackId, type: clip.type, asset: clip.asset,
    clipStartMs: clip.startMs, clipEndMs: clip.endMs, startMs: Math.max(clip.startMs, range.startMs),
    endMs: Math.min(clip.endMs, range.endMs), offsetMs: Math.max(clip.startMs, range.startMs) - clip.startMs,
    volume: clip.volume * clip.trackVolume * normalized.audioMasterVolume, loop: clip.loop,
    language: clip.language, visemes: clip.visemes
  }));
  const frozenSnapshot = deepFreeze({
    project: structuredClone(normalized.project), audioTracks: structuredClone(snapshot.audioTracks ?? []),
    audioAssets: structuredClone(normalized.audioAssets), audioAssetInfo: structuredClone(normalized.audioAssetInfo),
    audioMasterVolume: normalized.audioMasterVolume,
    ...(snapshot.characterTrack ? { characterTrack: structuredClone(snapshot.characterTrack) } : {}),
    ...(snapshot.visualEffectsTrack ? { visualEffectsTrack: structuredClone(snapshot.visualEffectsTrack) } : {})
  });
  return Object.freeze({
    snapshot: frozenSnapshot, range, durationMs: options.durationMs, quality: options.quality,
    viewport: raster, fps: options.fps, format: matched.mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    mimeType: matched.mimeType, audio: options.audio, missingAudio: options.missingAudio,
    audioClips: Object.freeze(clips), audioBitsPerSecond, videoBitsPerSecond: profile.videoBitsPerSecond,
    estimatedOutputBytes, outputBudgetBytes: EXPORT_LIMITS.outputBytes, estimatedPcmBytes: pcmBytes,
    pcmBudgetBytes: EXPORT_LIMITS.pcmBytes, estimatedCanvasBytes: raster.width * raster.height * 4,
    peakConcurrentGain: concurrentPeak, headroomGain, headroomDb, missingAudioAssetIds: Object.freeze(missingAudio)
  });
}
