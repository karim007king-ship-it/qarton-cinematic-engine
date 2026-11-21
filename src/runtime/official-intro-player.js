/**
 * Optional, host-owned QARTON intro. Never blocks gameplay if media is missing.
 * Pass the actual official MP4 URL from the host; this module ships no media.
 */
export function createOfficialIntroPlayer({
  mount, src, onComplete = () => {}, timeoutMs = 10000,
  documentRef = globalThis.document, setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (!mount || typeof mount.appendChild !== 'function') throw new TypeError('mount is required');
  if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('document is required');
  let done = false, timer = null, started = false;
  const shell = documentRef.createElement('div');
  shell.className = 'qarton-intro';
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'QARTON introduction');
  const video = documentRef.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('preload', 'auto');
  video.setAttribute('aria-label', 'QARTON official intro');
  video.playsInline = true;
  video.controls = false;
  const skip = documentRef.createElement('button');
  skip.type = 'button';
  skip.className = 'qarton-intro-skip';
  skip.textContent = 'تخطّي المقدمة';
  shell.appendChild(video);
  shell.appendChild(skip);
  function finish(reason) {
    if (done) return;
    done = true;
    if (timer !== null) clearTimer(timer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    shell.remove();
    onComplete(reason);
  }
  skip.addEventListener('click', () => finish('skipped'));
  video.addEventListener('ended', () => finish('ended'));
  video.addEventListener('error', () => finish('error'));
  async function start() {
    if (started || done) return;
    started = true;
    if (!src || typeof src !== 'string') return finish('missing');
    mount.appendChild(shell);
    timer = setTimer(() => finish('timeout'), timeoutMs);
    video.src = src;
    try {
      await video.play();
    } catch {
      // Mobile browsers may require a gesture; skip remains available.
      if (!done) {
        const playButton = documentRef.createElement('button');
        playButton.type = 'button';
        playButton.textContent = 'تشغيل المقدمة';
        playButton.className = 'qarton-intro-play';
        playButton.addEventListener('click', () => {
          if (!done) video.play().catch(() => finish('play-error'));
        });
        shell.appendChild(playButton);
      }
    }
  }
  return { start, skip: () => finish('skipped'), destroy: () => finish('destroyed'), get finished() { return done; } };
}
