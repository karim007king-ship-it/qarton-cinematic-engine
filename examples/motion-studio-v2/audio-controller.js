import { compileCinematicAudioProject, createCinematicAudioPlayer } from "../../src/audio/cinematic-audio-core.js";
import { addAudioClip, compileAudioTracks, deleteAudioClip, editAudioClip, makeAudioTracks, makeAudioAssetMetadata, setAudioTrackVolume, validateAudioFile } from "../motion-studio-lab/studio-audio-model.js";
import { classifyMicrophoneFailure } from "../motion-studio-lab/microphone-permission.js";

const PCM_BUDGET = 32 * 1024 * 1024;
const MIMES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
const LIMIT_BYTES = 20 * 1024 * 1024;

function measureSignal(buffer) {
  let squares = 0, count = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const sample = data[i], abs = Math.abs(sample);
      squares += sample * sample; count++; if (abs > peak) peak = abs;
    }
  }
  return { rms: count ? Math.sqrt(squares / count) : 0, peak };
}

function measureWaveform(buffer) {
  const data = buffer.getChannelData(0), bins = 72, values = [];
  for (let bin = 0; bin < bins; bin++) {
    const from = Math.floor(bin * data.length / bins), to = Math.max(from + 1, Math.floor((bin + 1) * data.length / bins));
    let peak = 0;
    for (let i = from; i < Math.min(to, data.length); i += Math.max(1, Math.floor((to - from) / 120))) peak = Math.max(peak, Math.abs(data[i]));
    values.push(peak);
  }
  return values;
}

function id(prefix, serial) { return prefix + "-" + serial.toString(36); }

export function createV2AudioController({
  getClock, getSequence, getSelectedScene, onState = () => {}, onAsset = () => {},
  onError = () => {}, onBusy = () => {}, AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  MediaRecorderClass = globalThis.MediaRecorder, mediaDevices = globalThis.navigator?.mediaDevices
} = {}) {
  let context = null, tracks = makeAudioTracks(), durationMs = 8000, serial = 0, audioPlayer = null;
  let recording = null, disposed = false, selection = null, revision = 0, muted = new Set();
  let micState = "unknown", lastMime = "—", lastDurationMs = 0, signal = { rms: 0, peak: 0 }, lastError = "";
  const assets = new Map();
  const sharedClock = Object.freeze({
    time: () => getClock().time(), pause: () => getClock().pause(),
    resume: () => getClock().resume(), seek: value => getClock().seek(value)
  });

  function currentTime() { return Math.max(0, Math.round(getClock().time())); }
  function pcmBytes(buffer) { return buffer.length * buffer.numberOfChannels * 4; }
  function retainedBytes() { let size = 0; for (const asset of assets.values()) size += pcmBytes(asset.buffer); return size; }
  async function ensureContext() {
    if (!AudioContextClass) throw new Error("فك الصوت غير متاح في هذا المتصفح.");
    if (!context || context.state === "closed") context = new AudioContextClass();
    if (context.state === "suspended") await context.resume();
    return context;
  }
  function trackList() { return tracks.map(track => ({ ...track, volume: muted.has(track.id) ? 0 : track.volume, clips: track.clips.map(clip => ({ ...clip })) })); }
  function emit() { revision++; onState(getState()); }
  function stopPlayer({ keepPlaying = false } = {}) {
    const time = currentTime(), wasPlaying = audioPlayer?.state === "playing";
    if (audioPlayer) { try { audioPlayer.destroy(); } catch (error) { lastError = error.message || String(error); } }
    audioPlayer = null;
    const compiled = compileAudioTracks(trackList(), Math.max(1, durationMs));
    audioPlayer = createCinematicAudioPlayer(compiled, {
      clock: sharedClock,
      play(assetId, options) {
        const sourceAsset = assets.get(assetId);
        if (!sourceAsset || !context || context.state === "closed") throw new Error("أصل الصوت غير متاح للتشغيل.");
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = sourceAsset.buffer; source.loop = options.loop; gain.gain.value = options.volume;
        source.connect(gain); gain.connect(context.destination);
        const offset = Math.min(sourceAsset.buffer.duration, Math.max(0, options.offsetMs / 1000));
        source.start(0, offset);
        return { source, gain };
      },
      stop(voice) { try { voice.source.stop(); } catch {} voice.source.disconnect(); voice.gain.disconnect(); },
      setVolume(voice, value) { voice.gain.gain.setTargetAtTime(value, context.currentTime, 0.015); }
    });
    sharedClock.seek(Math.min(time, durationMs));
    if (wasPlaying && keepPlaying) { audioPlayer.play(); }
  }
  function syncLayout() {
    const seq = getSequence();
    durationMs = Math.max(1, seq.scenes.reduce((sum, scene) => sum + scene.project.durationMs, 0));
    const starts = new Map(); let cursor = 0;
    for (const scene of seq.scenes) { starts.set(scene.id, { start: cursor, end: cursor + scene.project.durationMs }); cursor += scene.project.durationMs; }
    tracks = tracks.map(track => ({ ...track, clips: track.clips.flatMap(clip => {
      if (clip.scope === "scene") {
        const place = starts.get(clip.sceneId); if (!place) return [];
        const startMs = place.start + clip.sceneOffsetMs;
        const available = place.end - startMs;
        if (available < 1) return [];
        return [{ ...clip, startMs, durationMs: Math.min(clip.durationMs, available) }];
      }
      const remaining = durationMs - clip.startMs;
      return remaining < 1 ? [] : [{ ...clip, durationMs: Math.min(clip.durationMs, remaining) }];
    }) }));
    const live = new Set(tracks.flatMap(track => track.clips.map(clip => clip.asset)));
    for (const [assetId, asset] of assets) if (!live.has(assetId)) { assets.delete(assetId); onAsset({ action: "remove", id: assetId }); }
    try { stopPlayer({ keepPlaying: true }); lastError = ""; }
    catch (error) { lastError = error.message || String(error); onError(error); }
    emit();
  }
  async function decodeAndCommit(file, type, { source = "import" } = {}) {
    if (disposed) throw new Error("تم إغلاق الاستوديو.");
    if (recording && source !== "recording") throw new Error("أوقف التسجيل قبل استيراد ملف صوتي.");
    const metadata = validateAudioFile(file);
    const targetSequence = getSequence(), targetScene = getSelectedScene();
    const targetTime = currentTime(), targetScope = document.querySelector("#audioScope")?.value ?? "scene";
    const ctx = await ensureContext();
    const encoded = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(encoded.slice(0));
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 3600) throw new Error("مدة الصوت المفكوك غير صالحة.");
    if (retainedBytes() + pcmBytes(buffer) > PCM_BUDGET) throw new RangeError("تجاوزت الأصول الصوتية ميزانية PCM الحالية 32 MiB؛ حُفظت المقاطع السابقة كما هي.");
    const measured = measureSignal(buffer);
    if (!Number.isFinite(measured.rms) || measured.peak < 0.00001) throw new Error("الإشارة الصوتية صامتة أو تالفة؛ لم يُضف أي مقطع.");
    const seq = getSequence(), scene = seq.scenes.find(item => item.id === targetScene.id);
    if (!scene || !targetSequence.scenes.some(item => item.id === targetScene.id)) { buffer.close?.(); throw new Error("المشهد المستهدف حُذف أثناء فك ترميز الصوت."); }
    const sceneStart = seq.scenes.slice(0, seq.scenes.findIndex(item => item.id === scene.id)).reduce((sum, item) => sum + item.project.durationMs, 0);
    const sceneEnd = sceneStart + scene.project.durationMs;
    const startMs = Math.min(targetTime, durationMs - 1);
    const clipDuration = Math.min(Math.round(buffer.duration * 1000), durationMs - startMs, targetScope === "scene" ? sceneEnd - startMs : Infinity);
    if (clipDuration < 1) throw new Error("لا توجد مدة متاحة لإضافة الصوت في هذا الموضع.");
    serial++;
    const assetId = id("audio-asset", serial), clipId = id("audio-clip", serial), trackId = "audio-" + type;
    const fileForRegistry = new Blob([file], { type: metadata.mime });
    const clip = {
      id: clipId, asset: assetId, name: metadata.name, startMs, durationMs: clipDuration,
      sourceStartMs: 0, loop: false, ...(type === "dialogue" ? { language: "ar" } : {}),
      scope: targetScope, ...(targetScope === "scene" ? { sceneId: scene.id, sceneOffsetMs: startMs - sceneStart } : {})
    };
    const next = addAudioClip(tracks, durationMs, trackId, clip);
    const previous = tracks; tracks = next;
    try {
      const compiled = compileCinematicAudioProject({ durationMs, tracks: trackList() });
      const asset = makeAudioAssetMetadata(assetId, { name: file.name || "recording." + metadata.mime.split("/")[1], type: metadata.mime, size: fileForRegistry.size });
      assets.set(assetId, { buffer, blob: fileForRegistry, name: metadata.name, mime: metadata.mime, signal: measured, waveform: measureWaveform(buffer), durationMs: Math.round(buffer.duration * 1000) });
      onAsset({ action: "add", asset: { id: assetId, kind: "audio", name: asset.name, mimeType: metadata.mime, size: fileForRegistry.size }, blob: fileForRegistry });
      if (audioPlayer) audioPlayer.destroy();
      audioPlayer = createCinematicAudioPlayer(compiled, {
        clock: sharedClock,
        play(assetKey, options) {
          const entry = assets.get(assetKey);
          if (!entry) throw new Error("أصل الصوت غير متاح.");
          const node = ctx.createBufferSource(), gain = ctx.createGain();
          node.buffer = entry.buffer; node.loop = options.loop; gain.gain.value = options.volume;
          node.connect(gain); gain.connect(ctx.destination);
          node.start(0, Math.min(entry.buffer.duration, Math.max(0, options.offsetMs / 1000)));
          return { node, gain };
        },
        stop(voice) { try { voice.node.stop(); } catch {} voice.node.disconnect(); voice.gain.disconnect(); },
        setVolume(voice, value) { voice.gain.gain.setTargetAtTime(value, ctx.currentTime, .015); }
      });
      selection = { trackId, clipId };
      lastMime = metadata.mime; lastDurationMs = Math.round(buffer.duration * 1000); signal = measured; lastError = "";
      emit();
      return { assetId, clipId, durationMs: lastDurationMs, rms: measured.rms, peak: measured.peak, mime: metadata.mime };
    } catch (error) {
      tracks = previous; assets.delete(assetId); onAsset({ action: "remove", id: assetId }); throw error;
    }
  }
  function findClip(trackId, clipId) { return tracks.find(track => track.id === trackId)?.clips.find(clip => clip.id === clipId); }
  async function refreshMicPermission() {
    try { micState = (await navigator.permissions?.query?.({ name: "microphone" }))?.state ?? "unsupported"; }
    catch { micState = "unknown"; }
    emit();
  }
  function microphonePolicyAllowed() {
    const policy = document.permissionsPolicy ?? document.featurePolicy;
    try { return typeof policy?.allowsFeature === "function" ? policy.allowsFeature("microphone") : null; }
    catch { return null; }
  }
  async function startRecording() {
    if (recording) return stopRecording();
    if (!MediaRecorderClass || !mediaDevices?.getUserMedia) throw new Error("التسجيل المباشر غير متاح؛ يلزم متصفح يدعم MediaRecorder والميكروفون.");
    if (!globalThis.isSecureContext && globalThis.location?.protocol !== "content:") throw new Error("يلزم HTTPS أو مصدر محلي آمن للوصول إلى الميكروفون.");
    let stream;
    try {
      const permission = await navigator.permissions?.query?.({ name: "microphone" }).catch(() => null);
      micState = permission?.state ?? "prompt";
      // Invoke getUserMedia from the button action without introducing a timer/task.
      const request = mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      stream = await request;
      micState = "granted";
      await ensureContext();
      const mimeType = MIMES.find(mime => MediaRecorderClass.isTypeSupported?.(mime)) || "";
      const recorder = new MediaRecorderClass(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recording = { recorder, stream, chunks, mimeType: recorder.mimeType || mimeType, startedAt: performance.now(), stopped: false };
      onBusy(true); emit();
      recorder.addEventListener("dataavailable", event => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener("error", event => { lastError = event.error?.message || "تعذر التسجيل."; });
      recorder.start(500);
      return true;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      const report = classifyMicrophoneFailure(error, { permissionState: micState, secureContext: globalThis.isSecureContext || globalThis.location?.protocol === "content:", apiAvailable: Boolean(mediaDevices?.getUserMedia), policyAllowed: microphonePolicyAllowed() });
      micState = report.category; lastError = report.message; onError(error); emit(); throw new Error(report.message);
    }
  }
  async function stopRecording() {
    const active = recording; if (!active || active.stopped) return false;
    active.stopped = true;
    const result = new Promise(resolve => {
      active.recorder.addEventListener("stop", async () => {
        active.stream.getTracks().forEach(track => track.stop());
        recording = null; onBusy(false);
        try {
          const mime = active.mimeType || active.chunks[0]?.type || "audio/webm";
          const blob = new Blob(active.chunks, { type: mime });
          if (!blob.size || blob.size > LIMIT_BYTES) throw new RangeError("التسجيل فارغ أو تجاوز الحد الآمن 20 MiB.");
          const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : "webm";
          const file = new File([blob], "recording." + ext, { type: mime });
          const added = await decodeAndCommit(file, "dialogue", { source: "recording" });
          resolve(added);
        } catch (error) { lastError = error.message || String(error); emit(); resolve(false); }
      }, { once: true });
    });
    try { active.recorder.stop(); } catch { active.stream.getTracks().forEach(track => track.stop()); recording = null; onBusy(false); return false; }
    return result;
  }
  function getState() {
    const clip = selection ? findClip(selection.trackId, selection.clipId) : null;
    const asset = clip ? assets.get(clip.asset) : null;
    return Object.freeze({
      revision, tracks: trackList(), selected: selection ? { ...selection } : null, selectedClip: clip ? { ...clip } : null,
      micPolicyAllowed: microphonePolicyAllowed(),
      mutedTracks: [...muted],
      recording: Boolean(recording), micState, secureContext: Boolean(globalThis.isSecureContext), audioContextState: context?.state ?? "not-created",
      format: asset?.mime ?? lastMime, durationMs: asset?.durationMs ?? lastDurationMs,
      rms: asset?.signal?.rms ?? signal.rms, peak: asset?.signal?.peak ?? signal.peak, waveform: asset?.waveform ?? [],
      pcmBytes: retainedBytes(), playerState: audioPlayer?.state ?? "paused",
      activeVoices: audioPlayer?.activeVoiceCount ?? 0, error: lastError
    });
  }
  function setVolume(trackId, value) {
    tracks = setAudioTrackVolume(tracks, durationMs, trackId, value);
    muted.delete(trackId);
    audioPlayer?.setTrackVolume(trackId, value);
    emit();
  }
  function toggleMute(trackId) {
    if (muted.has(trackId)) muted.delete(trackId); else muted.add(trackId);
    const level = tracks.find(track => track.id === trackId)?.volume ?? 1;
    audioPlayer?.setTrackVolume(trackId, muted.has(trackId) ? 0 : level);
    emit();
  }
  function move(trackId, clipId, startMs) {
    const clip = findClip(trackId, clipId); if (!clip) return;
    const patch = { startMs };
    if (clip.scope === "scene") {
      const seq = getSequence(), scene = seq.scenes.find(item => item.id === clip.sceneId);
      if (!scene) throw new Error("المشهد المرتبط بالمقطع لم يعد موجودًا.");
      const start = seq.scenes.slice(0, seq.scenes.indexOf(scene)).reduce((sum, item) => sum + item.project.durationMs, 0);
      patch.sceneOffsetMs = startMs - start;
      if (startMs < start || startMs + clip.durationMs > start + scene.project.durationMs) throw new RangeError("المقطع المرتبط بالمشهد يجب أن يبقى داخل مدته.");
    }
    tracks = editAudioClip(tracks, durationMs, trackId, clipId, patch); stopPlayer({ keepPlaying: true }); emit();
  }
  function trim(trackId, clipId, sourceStartMs, clipDurationMs) {
    const clip = findClip(trackId, clipId); if (!clip) return;
    if (!Number.isSafeInteger(sourceStartMs) || sourceStartMs < 0 || !Number.isSafeInteger(clipDurationMs) || clipDurationMs < 1) throw new RangeError("قيم القص غير صالحة.");
    const asset = assets.get(clip.asset);
    if (!asset || sourceStartMs + clipDurationMs > asset.durationMs) throw new RangeError("القص يتجاوز مدة الصوت المفكوك.");
    tracks = editAudioClip(tracks, durationMs, trackId, clipId, { sourceStartMs, durationMs: clipDurationMs }); stopPlayer({ keepPlaying: true }); emit();
  }
  function removeSelected() {
    if (!selection) return false;
    tracks = deleteAudioClip(tracks, durationMs, selection.trackId, selection.clipId); selection = null;
    const live = new Set(tracks.flatMap(track => track.clips.map(clip => clip.asset)));
    for (const [assetId, asset] of assets) if (!live.has(assetId)) { assets.delete(assetId); onAsset({ action: "remove", id: assetId }); }
    stopPlayer({ keepPlaying: true }); emit(); return true;
  }
  function play() { if (!audioPlayer) return; audioPlayer.play(); }
  function pause() { try { audioPlayer?.pause(); } catch (error) { lastError = error.message || String(error); } }
  function seek(ms) { try { audioPlayer?.seek(ms); } catch (error) { lastError = error.message || String(error); } }
  function tick() { try { audioPlayer?.tick(); } catch (error) { lastError = error.message || String(error); onError(error); } }
  function select(value) { selection = value; emit(); }
  function dispose() {
    if (disposed) return; disposed = true;
    if (recording && !recording.stopped) { try { recording.recorder.stop(); } catch {} recording.stream.getTracks().forEach(track => track.stop()); }
    try { audioPlayer?.destroy(); } catch {}
    for (const assetId of assets.keys()) onAsset({ action: "remove", id: assetId });
    assets.clear(); context?.close?.().catch?.(() => {});
  }
  return Object.freeze({ decodeAndCommit, dispose, getState, isMuted: trackId => muted.has(trackId), move, pause, play, refreshMicPermission, removeSelected, seek, select, setVolume, startRecording, stopRecording, syncLayout, tick, toggleMute, trim });
}
