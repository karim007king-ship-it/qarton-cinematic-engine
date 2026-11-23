import {
  addCameraKeyframe, deleteCameraKeyframe, moveCameraKeyframe, updateCameraKeyframe
} from "../../packages/motion-studio/keyframes.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Convert a pointer's horizontal position to an absolute project timestamp. */
export function timelineTimeAtClientX(clientX, rect, durationMs) {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect?.left) || !Number.isFinite(rect?.width) ||
      !Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new TypeError("Timeline pointer position, bounds, and duration must be valid");
  }
  if (rect.width <= 0) return 0;
  return Math.round(clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs);
}

/**
 * Own Timeline DOM and pointer state. Project access, preview sampling, playback,
 * and compilation stay with the host editor through this explicit callback contract.
 */
export function createStudioTimeline({
  lane, ruler, playhead, markers, selectionLabel, message, addButton, deleteButton,
  fields, documentRef = document, getProject, getCompiled, getCurrentTime, isBusy,
  formatTime, samplePose, seek, syncPlaybackSeek, commitProject
}) {
  const required = { lane, ruler, playhead, markers, selectionLabel, message, addButton, deleteButton,
    fields, getProject, getCompiled, getCurrentTime, isBusy, formatTime, samplePose, seek, commitProject };
  for (const [name, value] of Object.entries(required)) {
    if (value === null || value === undefined) throw new TypeError(`Timeline requires ${name}`);
  }

  let selectedAtMs = null;
  let drag = null;
  let scrubPointerId = null;
  let busy = Boolean(isBusy());

  function timeAt(clientX) {
    const project = getProject();
    return timelineTimeAtClientX(clientX, lane.getBoundingClientRect(), project.durationMs);
  }

  function renderPlayhead() {
    const project = getProject();
    const currentMs = clamp(getCurrentTime(), 0, project.durationMs);
    playhead.style.left = `${project.durationMs ? currentMs / project.durationMs * 100 : 0}%`;
    lane.setAttribute("aria-label", `Timeline الكاميرا. المؤشر عند ${formatTime(currentMs)} من ${formatTime(project.durationMs)}. المس التدريج للانتقال، واسحب المفتاح لتغيير توقيته.`);
  }

  function renderRuler() {
    const durationMs = getProject().durationMs;
    ruler.replaceChildren();
    for (let index = 0; index <= 4; index++) {
      const label = documentRef.createElement("span");
      label.textContent = formatTime(Math.round(durationMs * index / 4));
      ruler.append(label);
    }
  }

  function renderEditor() {
    const frame = getProject().camera?.find(({ atMs }) => atMs === selectedAtMs) ?? null;
    if (!frame) selectedAtMs = null;
    selectionLabel.textContent = frame ? `المحدد · ${formatTime(frame.atMs)}` : "لا يوجد مفتاح محدد";
    addButton.disabled = busy;
    deleteButton.disabled = busy || !frame;
    for (const [field, input] of Object.entries(fields)) {
      input.disabled = busy || !frame;
      input.value = frame ? String(frame.value[field]) : "";
    }
  }

  function renderMarkers({ focusTime: preferredFocusTime = undefined } = {}) {
    const project = getProject();
    const frames = project.camera ?? [];
    if (selectedAtMs !== null && !frames.some(({ atMs }) => atMs === selectedAtMs)) selectedAtMs = null;
    const activeTime = markers.contains(documentRef.activeElement)
      ? Number(documentRef.activeElement.dataset.keyTime)
      : null;
    markers.replaceChildren();
    for (const frame of frames) {
      const marker = documentRef.createElement("button");
      marker.type = "button";
      marker.className = "keyframe-marker";
      marker.style.setProperty("--key-position", `${project.durationMs ? frame.atMs / project.durationMs * 100 : 0}%`);
      marker.dataset.keyTime = String(frame.atMs);
      marker.setAttribute("aria-label", `Keyframe عند ${formatTime(frame.atMs)}`);
      marker.setAttribute("aria-pressed", String(frame.atMs === selectedAtMs));
      marker.disabled = busy;
      marker.title = `${formatTime(frame.atMs)} · X ${frame.value.x} · Y ${frame.value.y} · Zoom ${frame.value.zoom} · Rotation ${frame.value.rotation}`;
      marker.addEventListener("pointerdown", (event) => beginKeyframeDrag(event, frame.atMs));
      marker.addEventListener("click", () => select(frame.atMs, { seekToKey: true }));
      markers.append(marker);
    }
    renderEditor();
    const focusTime = frames.some(({ atMs }) => atMs === preferredFocusTime) ? preferredFocusTime
      : frames.some(({ atMs }) => atMs === activeTime) ? activeTime : selectedAtMs;
    if (focusTime !== null) {
      markers.querySelector(`[data-key-time="${focusTime}"]`)?.focus({ preventScroll: true });
    }
  }

  function render() {
    renderRuler();
    renderMarkers();
    renderPlayhead();
  }

  function select(atMs, { seekToKey = false } = {}) {
    selectedAtMs = atMs;
    message.textContent = "عدّل القيم أو اسحب المفتاح أفقيًا. التوقيت المكرر غير مسموح.";
    renderMarkers({ focusTime: atMs });
    if (seekToKey) {
      seek(atMs);
      syncPlaybackSeek?.(atMs);
    }
  }

  function apply(nextProject, nextSelection = selectedAtMs) {
    if (busy || isBusy()) throw new Error("أوقف تسجيل الفيديو قبل تعديل Timeline.");
    commitProject(nextProject);
    selectedAtMs = nextSelection;
    render();
  }

  function addAtPlayhead() {
    if (busy || isBusy()) return;
    try {
      const atMs = getCurrentTime();
      const next = addCameraKeyframe(getProject(), { atMs, value: samplePose(getCompiled(), atMs) });
      apply(next, atMs);
      message.textContent = `أُضيف مفتاح عند ${formatTime(atMs)}.`;
    } catch (error) {
      message.textContent = error?.message || String(error);
    }
  }

  function deleteSelected() {
    if (busy || isBusy() || selectedAtMs === null) return;
    try {
      const removedAt = selectedAtMs;
      const remaining = (getProject().camera ?? []).filter(({ atMs }) => atMs !== removedAt);
      const nearest = remaining.reduce((best, frame) => !best ||
        Math.abs(frame.atMs - removedAt) < Math.abs(best.atMs - removedAt) ? frame : best, null);
      apply(deleteCameraKeyframe(getProject(), removedAt), nearest?.atMs ?? null);
      message.textContent = remaining.length
        ? `حُذف المفتاح عند ${formatTime(removedAt)} وبقيت المفاتيح الأخرى.`
        : "حُذف آخر مفتاح؛ الحركة الآن بوضعية الهوية.";
    } catch (error) {
      message.textContent = error?.message || String(error);
    }
  }

  function editSelected(field) {
    if (busy || isBusy() || selectedAtMs === null) return;
    try {
      const value = Number(fields[field].value);
      apply(updateCameraKeyframe(getProject(), selectedAtMs, { [field]: value }), selectedAtMs);
      message.textContent = `تم تحديث ${field} للمفتاح عند ${formatTime(selectedAtMs)}.`;
    } catch (error) {
      message.textContent = error?.message || String(error);
      renderEditor();
    }
  }

  function beginKeyframeDrag(event, atMs) {
    if (busy || isBusy() || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    select(atMs, { seekToKey: true });
    drag = { pointerId: event.pointerId, fromMs: atMs, lastCommittedMs: atMs, sourceProject: getProject() };
    lane.dataset.dragging = "true";
    try { lane.setPointerCapture(event.pointerId); } catch { /* Synthetic browser test pointers have no capture owner. */ }
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (busy || isBusy()) {
      finishPointer(event, true);
      return;
    }
    const toMs = timeAt(event.clientX);
    if (toMs === drag.lastCommittedMs) return;
    try {
      const next = moveCameraKeyframe(drag.sourceProject, drag.fromMs, toMs);
      apply(next, toMs);
      drag.lastCommittedMs = toMs;
      message.textContent = `المفتاح الآن عند ${formatTime(toMs)}.`;
    } catch (error) {
      message.textContent = error?.message || String(error);
    }
  }

  function finishPointer(event, aborted = false) {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      delete lane.dataset.dragging;
      renderMarkers();
      if (aborted) message.textContent = "انتهى السحب؛ بقي آخر توقيت صالح.";
    }
    if (scrubPointerId === event.pointerId) scrubPointerId = null;
  }

  lane.addEventListener("pointerdown", (event) => {
    if (busy || isBusy() || !event.isPrimary || event.button !== 0 || event.target.closest(".keyframe-marker")) return;
    event.preventDefault();
    scrubPointerId = event.pointerId;
    try { lane.setPointerCapture(event.pointerId); } catch { /* Synthetic browser test pointers have no capture owner. */ }
    seek(timeAt(event.clientX));
    syncPlaybackSeek?.(getCurrentTime());
  });
  lane.addEventListener("pointermove", (event) => {
    if (drag) moveDrag(event);
    else if (!busy && !isBusy() && scrubPointerId === event.pointerId) {
      seek(timeAt(event.clientX));
      syncPlaybackSeek?.(getCurrentTime());
    }
  });
  lane.addEventListener("pointerup", (event) => finishPointer(event));
  lane.addEventListener("pointercancel", (event) => finishPointer(event, true));
  lane.addEventListener("lostpointercapture", (event) => finishPointer(event, true));
  lane.addEventListener("keydown", (event) => {
    if (busy || isBusy()) return;
    const project = getProject();
    const step = Math.max(1, Math.round(project.durationMs / 100));
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      seek(event.key === "Home" ? 0 : event.key === "End" ? project.durationMs : getCurrentTime() + delta);
      syncPlaybackSeek?.(getCurrentTime());
    }
  });
  addButton.addEventListener("click", addAtPlayhead);
  deleteButton.addEventListener("click", deleteSelected);
  for (const field of Object.keys(fields)) fields[field].addEventListener("change", () => editSelected(field));

  function setBusy(value) {
    busy = Boolean(value);
    lane.style.pointerEvents = busy ? "none" : "";
    lane.setAttribute("aria-disabled", String(busy));
    if (busy) {
      drag = null;
      scrubPointerId = null;
      delete lane.dataset.dragging;
    }
    renderMarkers();
  }

  return Object.freeze({
    render,
    renderPlayhead,
    renderMarkers,
    setBusy,
    getSelectedTime: () => selectedAtMs,
    isDragging: () => drag !== null,
    clearSelection() { selectedAtMs = null; renderMarkers(); },
    selectTime(atMs) { selectedAtMs = atMs; renderMarkers(); }
  });
}
