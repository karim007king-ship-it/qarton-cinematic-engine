const LABELS = Object.freeze({ dialogue: "حوار", music: "موسيقى", sfx: "مؤثرات" });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Touch-first audio track view; clip edits are committed by the host model. */
export function createStudioAudioTimeline({
  root, ruler, getTracks, getDuration, getCurrentTime, isBusy, onSelect, onMove, onVolume, onMute, isMuted = () => false, onDragEnd,
  documentRef = document, formatTime = (ms) => `${(ms / 1000).toFixed(2)}s`
}) {
  let selected = null;
  let drag = null;
  let locked = Boolean(isBusy());
  root.addEventListener("pointermove", movePointer);
  root.addEventListener("pointerup", finishPointer);
  root.addEventListener("pointercancel", (event) => finishPointer(event, true));
  root.addEventListener("lostpointercapture", (event) => finishPointer(event, true));

  function render({ focusClipId = null } = {}) {
    const focusedClipId = focusClipId ?? (root.contains(documentRef.activeElement)
      ? documentRef.activeElement.closest?.(".audio-clip")?.dataset.clipId ?? null
      : null);
    root.replaceChildren();
    const duration = getDuration();
    if (ruler) {
      ruler.replaceChildren();
      for (let index = 0; index <= 4; index++) {
        const label = documentRef.createElement("span"); label.textContent = formatTime(Math.round(duration * index / 4)); ruler.append(label);
      }
    }
    for (const track of getTracks()) {
      const row = documentRef.createElement("section");
      row.className = "audio-track-row";
      row.dataset.trackId = track.id;
      const heading = documentRef.createElement("div");
      heading.className = "audio-track-heading";
      const title = documentRef.createElement("strong");
      title.textContent = LABELS[track.type] ?? track.type;
      const volumeLabel = documentRef.createElement("label");
      volumeLabel.textContent = "المسار";
      const volume = documentRef.createElement("input");
      volume.type = "range"; volume.min = "0"; volume.max = "1"; volume.step = "0.01";
      volume.value = String(track.volume); volume.setAttribute("aria-label", `مستوى مسار ${title.textContent}`);
      volume.disabled = locked;
      volume.addEventListener("input", () => onVolume(track.id, Number(volume.value)));
      volumeLabel.append(volume);
      const mute = documentRef.createElement("button");
      mute.type = "button"; mute.className = "audio-mute"; mute.textContent = isMuted(track.id) ? "مكتوم" : "صوت";
      mute.setAttribute("aria-label", isMuted(track.id) ? `إلغاء كتم ${title.textContent}` : `كتم ${title.textContent}`);
      mute.setAttribute("aria-pressed", String(isMuted(track.id))); mute.disabled = locked;
      mute.addEventListener("click", () => onMute?.(track.id));
      heading.append(title, volumeLabel, mute); row.append(heading);
      const lane = documentRef.createElement("div");
      lane.className = "audio-track-lane";
      lane.dataset.trackId = track.id;
      lane.setAttribute("role", "group");
      lane.setAttribute("aria-label", `مسار ${title.textContent}`);
      const playhead = documentRef.createElement("span"); playhead.className = "audio-playhead"; playhead.setAttribute("aria-hidden", "true");
      playhead.style.left = `${getCurrentTime() / duration * 100}%`; lane.append(playhead);
      for (const clip of track.clips) {
        const button = documentRef.createElement("button");
        button.type = "button"; button.className = "audio-clip";
        button.dataset.clipId = clip.id; button.dataset.trackId = track.id;
        button.style.setProperty("--clip-left", `${clip.startMs / duration * 100}%`);
        button.style.setProperty("--clip-width", `${clip.durationMs / duration * 100}%`);
        button.textContent = clip.name || (track.type === "dialogue" ? "حوار" : track.type === "music" ? "موسيقى" : "مؤثر صوتي");
        button.setAttribute("aria-label", `${button.textContent}، يبدأ ${formatTime(clip.startMs)}، المدة ${formatTime(clip.durationMs)}`);
        button.setAttribute("aria-pressed", String(selected?.clipId === clip.id)); button.disabled = locked;
        button.addEventListener("pointerdown", (event) => {
          if (locked || !event.isPrimary || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          selected = { trackId: track.id, clipId: clip.id };
          onSelect(selected); drag = { pointerId: event.pointerId, trackId: track.id, clipId: clip.id, originX: event.clientX, originStart: clip.startMs, lastStart: clip.startMs };
          root.dataset.dragging = "true";
          const box = lane.getBoundingClientRect();
          drag.width = box.width;
          try { root.setPointerCapture(event.pointerId); } catch { /* Browser automation may synthesize a pointer without capture ownership. */ }
          render({ focusClipId: clip.id });
        });
        button.addEventListener("click", () => { selected = { trackId: track.id, clipId: clip.id }; onSelect(selected); render(); });
        lane.append(button);
      }
      row.append(lane); root.append(row);
    }
    if (focusedClipId) {
      const focusedClip = [...root.querySelectorAll(".audio-clip")]
        .find((button) => button.dataset.clipId === focusedClipId);
      focusedClip?.focus({ preventScroll: true });
    }
  }

  function movePointer(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (locked || isBusy()) { finishPointer(event, true); return; }
    const width = drag.width;
    const delta = width > 0 ? Math.round((event.clientX - drag.originX) / width * getDuration()) : 0;
    const requested = clamp(drag.originStart + delta, 0, getDuration() - 1);
    if (requested === drag.lastStart) return;
    try { onMove(drag.trackId, drag.clipId, requested); drag.lastStart = requested; render(); }
    catch { /* Invalid position preserves the last committed clip position. */ }
  }

  function finishPointer(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { pointerId } = drag; drag = null; delete root.dataset.dragging;
    try { if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); } catch { /* Already released by the platform. */ }
    onDragEnd?.({ cancelled }); render();
  }

  function setBusy(value) {
    locked = Boolean(value);
    if (locked && drag) {
      const { pointerId } = drag; drag = null; delete root.dataset.dragging;
      try { if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); } catch { /* Pointer may be cancelled already. */ }
      onDragEnd?.({ cancelled: true });
    }
    render();
  }

  function renderPlayhead() {
    const position = `${clamp(getCurrentTime() / getDuration() * 100, 0, 100)}%`;
    for (const head of root.querySelectorAll(".audio-playhead")) head.style.left = position;
  }

  return Object.freeze({ render, renderPlayhead, setBusy, getSelection: () => selected,
    select(value) { selected = value; render(); }, clearSelection() { selected = null; render(); },
    isDragging: () => drag !== null });
}

