import { compileCinematicAudioProject } from "../../src/audio/cinematic-audio-core.js";

export const AUDIO_TRACK_TYPES = Object.freeze(["dialogue", "music", "sfx"]);
export const AUDIO_VISEMES = Object.freeze(["rest", "open", "wide", "round", "closed", "teeth"]);
export const AUDIO_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const AUDIO_FORMATS = Object.freeze(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]);

export function makeAudioTracks() {
  return AUDIO_TRACK_TYPES.map((type) => ({ id: `audio-${type}`, type, volume: 1, clips: [] }));
}

function checked(tracks, durationMs) {
  const candidate = tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({
    ...clip, ...(clip.visemes ? { visemes: clip.visemes.map((cue) => ({ ...cue })) } : {})
  })) }));
  compileCinematicAudioProject({ durationMs, tracks: candidate });
  return candidate;
}

export function updateAudioTracks(tracks, durationMs, update) {
  if (typeof update !== "function") throw new TypeError("Audio update requires a callback");
  return checked(update(tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip })) })), durationMs), durationMs);
}

export function addAudioClip(tracks, durationMs, trackId, clip) {
  return updateAudioTracks(tracks, durationMs, (next) => {
    const track = next.find((item) => item.id === trackId);
    if (!track) throw new TypeError("لم يتم العثور على مسار الصوت.");
    track.clips.push({ volume: 1, loop: false, ...clip });
    return next;
  });
}

export function editAudioClip(tracks, durationMs, trackId, clipId, patch) {
  return updateAudioTracks(tracks, durationMs, (next) => {
    const clip = next.find((item) => item.id === trackId)?.clips.find((item) => item.id === clipId);
    if (!clip) throw new TypeError("لم يتم العثور على مقطع الصوت المحدد.");
    Object.assign(clip, patch);
    return next;
  });
}

export function deleteAudioClip(tracks, durationMs, trackId, clipId) {
  return updateAudioTracks(tracks, durationMs, (next) => {
    const track = next.find((item) => item.id === trackId);
    if (!track || !track.clips.some((clip) => clip.id === clipId)) throw new TypeError("لم يتم العثور على المقطع المحدد.");
    track.clips = track.clips.filter((clip) => clip.id !== clipId);
    return next;
  });
}

export function setAudioTrackVolume(tracks, durationMs, trackId, volume) {
  return updateAudioTracks(tracks, durationMs, (next) => {
    const track = next.find((item) => item.id === trackId);
    if (!track) throw new TypeError("لم يتم العثور على مسار الصوت.");
    track.volume = volume;
    return next;
  });
}

export function setAudioViseme(tracks, durationMs, trackId, clipId, atMs, viseme, phoneme = undefined) {
  return updateAudioTracks(tracks, durationMs, (next) => {
    const clip = next.find((item) => item.id === trackId)?.clips.find((item) => item.id === clipId);
    if (!clip || clip.language === undefined) throw new TypeError("اختر مقطع حوار لتحرير Viseme.");
    if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs >= clip.durationMs) throw new RangeError("توقيت Viseme يجب أن يقع داخل مدة الحوار.");
    const cues = clip.visemes ?? [];
    const cue = { atMs, viseme, ...(phoneme?.trim() ? { phoneme: phoneme.trim() } : {}) };
    const index = cues.findIndex((item) => item.atMs === atMs);
    if (index >= 0) cues[index] = cue; else cues.push(cue);
    clip.visemes = cues.sort((a, b) => a.atMs - b.atMs);
    return next;
  });
}

export function validateAudioFile(file) {
  if (!file || typeof file.name !== "string" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > AUDIO_MAX_FILE_BYTES) {
    throw new RangeError("ملف الصوت فارغ أو يتجاوز الحد الآمن 20 MiB.");
  }
  const mime = String(file.type || "").toLowerCase();
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const byExtension = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", webm: "audio/webm" };
  if (!AUDIO_FORMATS.includes(mime) && !byExtension[extension]) throw new TypeError("صيغة الصوت غير مدعومة. اختر MP3 أو M4A/AAC أو WAV أو OGG أو WebM.");
  return { mime: AUDIO_FORMATS.includes(mime) ? mime : byExtension[extension], name: file.name.slice(0, 180), size: file.size };
}

export function makeAudioAssetMetadata(id, file) {
  if (typeof id !== "string" || !id.trim() || id.length > 128) throw new TypeError("معرّف ملف الصوت غير صالح.");
  const { mime, name, size } = validateAudioFile(file);
  return { id, name, type: mime, size };
}

export async function readAudioDuration(file, { AudioClass = globalThis.Audio,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, timeoutMs = 10000 } = {}) {
  const { mime } = validateAudioFile(file);
  const source = file.type === mime ? file : new Blob([file], { type: mime });
  let metadataDuration = null;
  if (typeof AudioClass === "function") {
    const audio = new AudioClass();
    const url = URL.createObjectURL(source);
    try {
      metadataDuration = await new Promise(resolve => {
        let settled = false;
        const finish = value => { if (settled) return; settled = true; clearTimeout(timer);
          audio.removeEventListener?.("loadedmetadata", loaded); audio.removeEventListener?.("error", failed); resolve(value); };
        const timer = setTimeout(() => finish(null), timeoutMs);
        const loaded = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= 3600 ? audio.duration : null);
        const failed = () => finish(null);
        audio.addEventListener?.("loadedmetadata", loaded, { once: true });
        audio.addEventListener?.("error", failed, { once: true });
        audio.preload = "metadata";
        audio.src = url;
        if (!audio.addEventListener) audio.onloadedmetadata = loaded;
      });
    } finally {
      audio.removeAttribute?.("src"); audio.load?.(); URL.revokeObjectURL(url);
    }
  }
  if (Number.isFinite(metadataDuration)) return Math.round(metadataDuration * 1000);

  // Some Android WebViews report Infinity/NaN for valid MediaRecorder output.
  // Decode only on that path and use the decoded PCM duration as the authority.
  if (typeof AudioContextClass !== "function") throw new Error("تعذر تحديد مدة الصوت: بيانات الوسائط غير صالحة ولا يتوفر فك الترميز.");
  const context = new AudioContextClass();
  try {
    const bytes = await source.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (!Number.isFinite(buffer?.duration) || buffer.duration <= 0 || buffer.duration > 3600) {
      throw new RangeError("مدة الصوت المفكوك غير صالحة أو أطول من ساعة.");
    }
    return Math.round(buffer.duration * 1000);
  } catch (error) {
    throw new Error(`تعذر فك ترميز ملف الصوت للتحقق من مدته: ${error?.message || error}`);
  } finally {
    try { await context.close?.(); } catch { /* Release best-effort on Android WebView. */ }
  }
}

export function compileAudioTracks(tracks, durationMs) {
  return compileCinematicAudioProject({ durationMs, tracks });
}
