import {
  OUTPUT_SIZE,
  RECORDING_DURATIONS_MS,
  extensionForMime,
  supportedCandidates
} from './export-lab-core.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const imageInput = $('imageInput');
const formatInput = $('format');
const status = $('status');
const errors = $('errors');
const playback = $('playback');
const saveButton = $('saveButton');
const downloadLink = $('downloadLink');
const recorderSupport = $('recorderSupport');
const actualMime = $('actualMime');
const fileSize = $('fileSize');
const duration = $('duration');
let image = null;
let imageUrl = null;
let videoUrl = null;
let recording = false;
let rafId = 0;
let lastBlob = null;
let lastMime = '';

const errorText = (error) => `${error?.name || 'Error'}: ${error?.message || String(error)}`;
function reportError(error) {
  errors.textContent = errorText(error);
  status.textContent = 'تعذّر إكمال العملية. راجع رسالة الخطأ والتشخيص.';
}
function clearError() { errors.textContent = 'لا توجد'; }

function drawFrame(timeMs = 0) {
  const { width, height } = OUTPUT_SIZE;
  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const zoom = 1.035 + Math.sin(timeMs / 4200 * Math.PI) * 0.045;
    const drawWidth = image.naturalWidth * scale * zoom;
    const drawHeight = image.naturalHeight * scale * zoom;
    const panX = Math.sin(timeMs / 4200 * Math.PI * 2) * 14;
    const panY = Math.cos(timeMs / 4200 * Math.PI * 2) * 20;
    ctx.drawImage(image, (width - drawWidth) / 2 + panX, (height - drawHeight) / 2 + panY, drawWidth, drawHeight);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#191b26');
    gradient.addColorStop(1, '#443329');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f5e7bc';
    ctx.font = 'bold 38px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('اختر صورة من الهاتف', width / 2, height / 2);
  }
  const pulse = (Math.sin(timeMs / 115) + 1) / 2;
  const x = width * (0.22 + 0.56 * ((timeMs % 3600) / 3600));
  const y = height * 0.78 + Math.sin(timeMs / 330) * 13;
  ctx.beginPath();
  ctx.arc(x, y, 18 + pulse * 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(248, 208, 112, 0.25)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd778';
  ctx.fill();
}

function animatePreview() {
  const start = performance.now();
  const frame = (now) => {
    drawFrame(now - start);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

function setReady(ready) {
  $('record3').disabled = !ready || recording;
  $('record10').disabled = !ready || recording;
  $('probeButton').disabled = recording;
  formatInput.disabled = recording;
}

function clearPreviousVideo() {
  playback.pause();
  playback.removeAttribute('src');
  playback.load();
  downloadLink.hidden = true;
  downloadLink.removeAttribute('href');
  saveButton.disabled = true;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  lastBlob = null;
  lastMime = '';
  actualMime.textContent = '—';
  fileSize.textContent = '—';
  duration.textContent = '—';
}

imageInput.addEventListener('change', async () => {
  clearError();
  clearPreviousVideo();
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  const file = imageInput.files?.[0];
  image = null;
  setReady(false);
  if (!file) { status.textContent = 'اختر صورة لبدء التجربة.'; drawFrame(); return; }
  if (!file.type.startsWith('image/')) { reportError(new Error('الملف المختار ليس صورة.')); return; }
  imageUrl = URL.createObjectURL(file);
  const candidate = new Image();
  candidate.onload = () => {
    image = candidate;
    setReady(typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function');
    status.textContent = `تم تحميل الصورة: ${file.name} (${candidate.naturalWidth}×${candidate.naturalHeight}).`;
    drawFrame();
  };
  candidate.onerror = () => reportError(new Error('تعذر فك ترميز الصورة. جرّب صورة JPEG أو PNG.'));
  candidate.src = imageUrl;
});

function makeAudioGraph() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API غير مدعوم في هذا المتصفح.');
  const audio = new AudioContextClass();
  const mediaDestination = audio.createMediaStreamDestination();
  const gain = audio.createGain();
  gain.gain.value = 0.22;
  gain.connect(audio.destination);
  gain.connect(mediaDestination);
  return { audio, mediaDestination, gain };
}

function scheduleTestPulses(audio, gain, durationMs) {
  const startAt = audio.currentTime + 0.08;
  const totalSeconds = durationMs / 1000;
  for (let at = 0.35; at < totalSeconds; at += 1) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const start = startAt + at;
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + 0.012);
    envelope.gain.setValueAtTime(1, start + 0.065);
    envelope.gain.linearRampToValueAtTime(0, start + 0.105);
    oscillator.connect(envelope);
    envelope.connect(gain);
    oscillator.start(start);
    oscillator.stop(start + 0.11);
  }
}

async function collectChunks(stream, mimeType, durationMs) {
  return new Promise((resolve, reject) => {
    let recorder;
    const chunks = [];
    try { recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
    catch (error) { reject(error); return; }
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', (event) => reject(event.error || new Error('MediaRecorder emitted an error.')), { once: true });
    recorder.addEventListener('stop', () => resolve({ recorder, chunks }), { once: true });
    try {
      recorder.start(250);
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, durationMs);
    } catch (error) { reject(error); }
  });
}

async function probeOneFormat(format) {
  const output = $(format === 'webm' ? 'webmResult' : 'mp4Result');
  const candidates = supportedCandidates(MediaRecorder, format);
  if (!candidates.length) {
    output.textContent = 'غير مدعوم حسب isTypeSupported.';
    return { format, supported: false, tried: null, bytes: 0, error: null };
  }
  let lastError = null;
  for (const mime of candidates) {
    let stream;
    let audioGraph;
    try {
      drawFrame(0);
      stream = canvas.captureStream(OUTPUT_SIZE.fps);
      audioGraph = makeAudioGraph();
      stream.addTrack(audioGraph.mediaDestination.stream.getAudioTracks()[0]);
      await audioGraph.audio.resume();
      scheduleTestPulses(audioGraph.audio, audioGraph.gain, 350);
      const { recorder, chunks } = await collectChunks(stream, mime, 350);
      const blob = new Blob(chunks, { type: recorder.mimeType || mime });
      if (!blob.size) throw new Error('MediaRecorder انطلق لكن الملف الناتج فارغ.');
      output.textContent = `نجح التسجيل القصير: ${recorder.mimeType || mime} — ${blob.size} بايت`;
      return { format, supported: true, tried: mime, actual: recorder.mimeType || mime, bytes: blob.size, error: null };
    } catch (error) { lastError = error; }
    finally {
      stream?.getTracks().forEach((track) => track.stop());
      await audioGraph?.audio.close().catch(() => {});
    }
  }
  output.textContent = `أعلن المتصفح دعم MIME لكن التسجيل الفعلي فشل: ${errorText(lastError)}`;
  return { format, supported: false, tried: candidates.join(', '), bytes: 0, error: errorText(lastError) };
}

$('probeButton').addEventListener('click', async () => {
  clearError();
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    recorderSupport.textContent = 'MediaRecorder أو Canvas captureStream غير متاح.';
    reportError(new Error('هذه البيئة لا توفر MediaRecorder مع Canvas captureStream.'));
    return;
  }
  recorderSupport.textContent = `متاح؛ isTypeSupported: WebM ${supportedCandidates(MediaRecorder, 'webm').length ? 'نعم' : 'لا'}، MP4 ${supportedCandidates(MediaRecorder, 'mp4').length ? 'نعم' : 'لا'}.`;
  $('probeButton').disabled = true;
  status.textContent = 'يجري تسجيل عينة قصيرة لاختبار الترميز الفعلي…';
  try {
    const results = [];
    results.push(await probeOneFormat('webm'));
    results.push(await probeOneFormat('mp4'));
    status.textContent = 'اكتمل فحص الصيغ. افحص النتيجة على الهاتف ثم سجل 3 و10 ثوانٍ.';
    window.lastFormatProbe = results;
  } catch (error) { reportError(error); }
  finally { $('probeButton').disabled = false; }
});

async function record(durationMs) {
  if (!image || recording) return;
  clearError();
  clearPreviousVideo();
  recording = true;
  setReady(true);
  status.textContent = `جارٍ تسجيل ${durationMs / 1000} ثوانٍ… اترك الصفحة ظاهرة حتى ينتهي التسجيل.`;
  const candidates = supportedCandidates(MediaRecorder, formatInput.value);
  if (!candidates.length) {
    recording = false;
    setReady(true);
    throw new Error(`لا يوجد MIME معلن مدعوم لصيغة ${formatInput.value.toUpperCase()}.`);
  }
  let stream;
  let audioGraph;
  try {
    audioGraph = makeAudioGraph();
    await audioGraph.audio.resume();
    stream = canvas.captureStream(OUTPUT_SIZE.fps);
    stream.addTrack(audioGraph.mediaDestination.stream.getAudioTracks()[0]);
    const previewStart = performance.now();
    cancelAnimationFrame(rafId);
    const frame = (now) => {
      drawFrame(now - previewStart);
      rafId = requestAnimationFrame(frame);
    };
    drawFrame(0);
    rafId = requestAnimationFrame(frame);
    scheduleTestPulses(audioGraph.audio, audioGraph.gain, durationMs);
    const start = performance.now();
    const { recorder, chunks } = await collectChunks(stream, candidates[0], durationMs);
    const measured = Math.round(performance.now() - start);
    const mime = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || candidates[0];
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error('التسجيل اكتمل لكن الملف فارغ.');
    videoUrl = URL.createObjectURL(blob);
    lastBlob = blob;
    lastMime = mime;
    actualMime.textContent = mime;
    fileSize.textContent = `${blob.size.toLocaleString()} بايت`;
    duration.textContent = `${(measured / 1000).toFixed(2)} ثانية (المطلوب ${(durationMs / 1000).toFixed(0)} ث)`;
    playback.src = videoUrl;
    playback.hidden = false;
    saveButton.disabled = false;
    downloadLink.href = videoUrl;
    downloadLink.download = `qarton-export-test-${durationMs / 1000}s.${extensionForMime(mime)}`;
    downloadLink.textContent = `تنزيل ${extensionForMime(mime).toUpperCase()}`;
    downloadLink.hidden = false;
    status.textContent = 'اكتمل التسجيل. شغّل الفيديو وتحقق من الصورة والنبضات الصوتية ثم احفظه.';
  } finally {
    recording = false;
    cancelAnimationFrame(rafId);
    drawFrame(0);
    stream?.getTracks().forEach((track) => track.stop());
    await audioGraph?.audio.close().catch(() => {});
    setReady(Boolean(image));
  }
}

$('record3').addEventListener('click', () => record(RECORDING_DURATIONS_MS.short).catch(reportError));
$('record10').addEventListener('click', () => record(RECORDING_DURATIONS_MS.extended).catch(reportError));
saveButton.addEventListener('click', () => {
  if (!lastBlob || !videoUrl) return;
  downloadLink.click();
  status.textContent = 'أُرسل طلب التنزيل إلى المتصفح. افحص مجلد Downloads وافتح الملف للتحقق.';
});
playback.addEventListener('error', () => reportError(new Error('تعذر تشغيل الملف الناتج في عنصر الفيديو.')));
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(rafId);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  if (videoUrl) URL.revokeObjectURL(videoUrl);
});

recorderSupport.textContent = typeof MediaRecorder === 'undefined'
  ? 'غير متاح'
  : `متاح؛ Canvas captureStream: ${typeof canvas.captureStream === 'function' ? 'نعم' : 'لا'}`;
drawFrame();
animatePreview();
