import { addCharacterKeyframe, deleteCharacterKeyframe, moveCharacterKeyframe, updateCharacterKeyframe } from "./studio-character-track.js";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function createCharacterTimeline({ lane, markers, playhead, selection, message, addButton, deleteButton,
  fields, getTrack, getDuration, getTime, getAnimation, isBusy, seek, commit, formatTime }) {
  let selected = null, drag = null, pointer = null, busy = false;
  const timeAt = x => {
    const rect = lane.getBoundingClientRect();
    return rect.width > 0 ? Math.round(clamp((x - rect.left) / rect.width, 0, 1) * getDuration()) : 0;
  };
  function render() {
    const duration = getDuration(), track = getTrack();
    if (!track.keyframes.some(key => key.atMs === selected)) selected = null;
    const wasMarkerFocused = markers.contains(document.activeElement);
    const focusedAtMs = wasMarkerFocused ? Number(document.activeElement.dataset.keyTime) : null;
    const current = clamp(getTime(), 0, duration);
    playhead.style.left = `${duration ? current / duration * 100 : 0}%`;
    lane.setAttribute("aria-label", `مسار الشخصية. المؤشر ${formatTime(current)} من ${formatTime(duration)}. اسحب المفتاح أو استخدم الأسهم.`);
    markers.replaceChildren();
    for (const key of track.keyframes) {
      const marker = document.createElement("button");
      marker.type = "button"; marker.className = "character-keyframe-marker";
      marker.dataset.keyTime = String(key.atMs);
      marker.style.setProperty("--key-position", `${key.atMs / duration * 100}%`);
      marker.setAttribute("aria-label", `مفتاح شخصية عند ${formatTime(key.atMs)}`);
      marker.setAttribute("aria-pressed", String(key.atMs === selected)); marker.disabled = busy;
      marker.addEventListener("pointerdown", event => beginDrag(event, key.atMs));
      marker.addEventListener("click", () => select(key.atMs, true));
      markers.append(marker);
    }
    const focusAtMs = track.keyframes.some(key => key.atMs === focusedAtMs) ? focusedAtMs
      : track.keyframes.some(key => key.atMs === selected) ? selected : null;
    if (wasMarkerFocused && focusAtMs !== null) {
      markers.querySelector(`[data-key-time="${focusAtMs}"]`)?.focus({ preventScroll: true });
    }
    const key = track.keyframes.find(item => item.atMs === selected);
    selection.textContent = key ? `المحدد · ${formatTime(key.atMs)}` : "لا يوجد مفتاح محدد";
    addButton.disabled = busy; deleteButton.disabled = busy || !key;
    for (const [field, input] of Object.entries(fields)) {
      input.disabled = busy || !key;
      input.value = key ? String(key.values[field] ?? getAnimation().sample(key.atMs)[field]) : "";
    }
  }
  function select(time, shouldSeek = false) {
    selected = time; render();
    if (shouldSeek) seek(time);
  }
  function commitTrack(next, nextSelected) {
    if (busy || isBusy()) throw new Error("أوقف التصدير قبل تعديل مسار الشخصية.");
    commit(next); selected = nextSelected; render();
  }
  function add() {
    if (busy || isBusy()) return;
    try {
      const atMs = clamp(getTime(), 0, getDuration());
      const pose = getAnimation().sample(atMs);
      const values = Object.fromEntries(Object.keys(fields).map(field => [field, pose[field]]));
      commitTrack(addCharacterKeyframe(getTrack(), { atMs, values }, getDuration()), atMs);
      message.textContent = `أُضيف مفتاح شخصية عند ${formatTime(atMs)}.`;
    } catch (error) { message.textContent = error.message; }
  }
  function remove() {
    if (selected === null || busy || isBusy()) return;
    const at = selected;
    try {
      const next = deleteCharacterKeyframe(getTrack(), at, getDuration());
      const nearest = next.keyframes.reduce((best, key) => !best || Math.abs(key.atMs - at) < Math.abs(best.atMs - at) ? key : best, null);
      commitTrack(next, nearest?.atMs ?? null); message.textContent = "حُذف مفتاح الشخصية.";
    } catch (error) { message.textContent = error.message; }
  }
  function edit(field) {
    if (selected === null || busy || isBusy()) return;
    const input = fields[field];
    const value = input.tagName === "SELECT" ? input.value : Number(input.value);
    try { commitTrack(updateCharacterKeyframe(getTrack(), selected, { [field]: value }, getDuration()), selected); }
    catch (error) { message.textContent = error.message; render(); }
  }
  function beginDrag(event, atMs) {
    if (busy || isBusy() || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); select(atMs, true);
    drag = { pointerId: event.pointerId, from: atMs, source: getTrack(), last: atMs };
    lane.dataset.dragging = "true";
    try { lane.setPointerCapture(event.pointerId); } catch {}
  }
  function end(event, aborted = false) {
    if (drag?.pointerId === event.pointerId) {
      drag = null; delete lane.dataset.dragging; render();
      if (aborted) message.textContent = "أُلغي السحب؛ بقي آخر توقيت صالح.";
    }
    if (pointer === event.pointerId) { pointer = null; delete lane.dataset.scrubbing; }
  }
  lane.addEventListener("pointerdown", event => {
    if (busy || isBusy() || !event.isPrimary || event.button !== 0 ||
        event.target.closest(".keyframe-marker, .character-keyframe-marker")) return;
    event.preventDefault(); pointer = event.pointerId; lane.dataset.scrubbing = "true";
    try { lane.setPointerCapture(event.pointerId); } catch {}
    seek(timeAt(event.clientX));
  });
  lane.addEventListener("pointermove", event => {
    if (drag?.pointerId === event.pointerId) {
      if (busy || isBusy()) return end(event, true);
      const to = timeAt(event.clientX); if (to === drag.last) return;
      try { commitTrack(moveCharacterKeyframe(drag.source, drag.from, to, getDuration()), to); drag.last = to; }
      catch (error) { message.textContent = error.message; }
    } else if (pointer === event.pointerId && !busy && !isBusy()) seek(timeAt(event.clientX));
  });
  lane.addEventListener("pointerup", event => end(event));
  lane.addEventListener("pointercancel", event => end(event, true));
  lane.addEventListener("lostpointercapture", event => end(event, true));
  lane.addEventListener("keydown", event => {
    if (busy || isBusy()) return;
    const step = Math.max(1, Math.round(getDuration() / 100));
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); seek(event.key === "Home" ? 0 : event.key === "End" ? getDuration() : clamp(getTime() + (event.key === "ArrowLeft" ? -step : step), 0, getDuration()));
    }
  });
  addButton.addEventListener("click", add); deleteButton.addEventListener("click", remove);
  for (const input of Object.values(fields)) input.addEventListener("change", () => edit(input.dataset.channel));
  function setBusy(value) {
    busy = Boolean(value); lane.style.pointerEvents = busy ? "none" : ""; lane.setAttribute("aria-disabled", String(busy));
    if (busy) {
      const capturedPointerId = drag?.pointerId ?? pointer;
      drag = null;
      pointer = null;
      delete lane.dataset.dragging;
      delete lane.dataset.scrubbing;
      try {
        if (capturedPointerId !== null && capturedPointerId !== undefined && lane.hasPointerCapture(capturedPointerId)) {
          lane.releasePointerCapture(capturedPointerId);
        }
      } catch { /* The browser may already have released a cancelled pointer. */ }
    }
    render();
  }
  return Object.freeze({ render, setBusy, getSelectedTime: () => selected, clearSelection() { selected = null; render(); } });
}
