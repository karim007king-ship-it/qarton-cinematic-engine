export const OUTPUT_SIZE = Object.freeze({ width: 720, height: 1280, fps: 24 });
export const RECORDING_DURATIONS_MS = Object.freeze({ short: 3000, extended: 10000 });

const MIME_CANDIDATES = Object.freeze({
  webm: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ],
  mp4: [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4'
  ]
});

export function mimeCandidates(format) {
  if (!Object.hasOwn(MIME_CANDIDATES, format)) throw new TypeError(`Unknown format: ${format}`);
  return [...new Set(MIME_CANDIDATES[format])];
}

export function supportedCandidates(MediaRecorderClass, format) {
  if (typeof MediaRecorderClass?.isTypeSupported !== 'function') return [];
  return mimeCandidates(format).filter((mime) => {
    try { return MediaRecorderClass.isTypeSupported(mime) === true; }
    catch { return false; }
  });
}

export function measuredDurationMs(startedAt, endedAt) {
  const start = Number(startedAt);
  const end = Number(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round(end - start);
}

export function extensionForMime(mime) {
  return /^video\/mp4(?:;|$)/i.test(String(mime)) ? 'mp4' : 'webm';
}
