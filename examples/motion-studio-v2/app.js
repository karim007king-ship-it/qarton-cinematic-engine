import { createStudioV2Engine } from "./engine-adapter.js";

(() => {
  "use strict";
  const byId = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const studio = byId("#studio");
  const canvas = byId("#previewCanvas");
  const sheet = byId("#toolSheet");
  const title = byId("#sheetTitle");
  const toast = byId("#toast");
  const imageInput = byId("#imageInput");
  const emptyState = byId("#emptyState");
  const replaceButton = byId("#replaceImageButton");
  const menu = byId("#sceneMenu");
  const menuToggle = byId("#sceneMenuToggle");
  const seek = byId("#timelineSeek");
  const commitChip = byId("#commitIndicator");
  const commitId = document.documentElement.dataset.commit || "source";
  const sectionNames = { photos: "الصور", motion: "الحركة", audio: "الصوت", effects: "المؤثرات", more: "المزيد" };
  let activeSection = "";
  let toastTimer = 0;
  let engine;
  let updatingSeek = false;
  let renderedScenes = null;
  let renderedSelection = "";

  if (commitChip) {
    commitChip.textContent = "Commit " + commitId.slice(0, 7);
    commitChip.title = "Commit " + commitId;
  }
  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  function setSection(name, toggle = true) {
    if (toggle && activeSection === name && !sheet.hidden) {
      activeSection = "";
      sheet.hidden = true;
      all('[data-section]').forEach(button => button.setAttribute("aria-pressed", "false"));
      return;
    }
    activeSection = name;
    title.textContent = sectionNames[name];
    sheet.hidden = false;
    all(".panel-body").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    all('[data-section]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.section === name)));
  }
  function updateState(state) {
    if (!state) return;
    document.documentElement.dataset.prototypeReady = "true";
    document.documentElement.dataset.engineReady = "true";
    canvas.hidden = !state.hasImage;
    emptyState.hidden = state.hasImage;
    replaceButton.hidden = !state.hasImage;
    studio.dataset.playing = String(state.playing);
    byId("#playIcon").hidden = state.playing;
    byId("#pauseIcon").hidden = !state.playing;
    byId("#playButton").setAttribute("aria-label", state.playing ? "إيقاف مؤقت" : "تشغيل المعاينة");
    byId("#previewLabel").textContent = state.hasImage ? state.imageName : "معاينة المحرك";
    byId("#resolutionChip").textContent = state.aspectRatio;
    byId("#aspectRatio").value = state.aspectRatio;
    byId("#fitMode").value = state.fitMode;
    byId("#currentTime").textContent = state.formattedTime;
    byId("#totalTime").textContent = state.formattedTotal;
    updatingSeek = true;
    seek.max = String(state.totalDurationMs);
    seek.value = String(state.timeMs);
    updatingSeek = false;
    byId("#sceneCount").textContent = `مشهد ${state.selectedIndex + 1} من ${state.sceneCount}`;
    byId("#sceneDuration").value = String(Math.round(state.sceneDurationMs / 1000));
    byId("#sceneDurationValue").textContent = `${Math.round(state.sceneDurationMs / 1000)} ث`;
    byId("#cameraPreset").value = state.motion.preset;
    byId("#motionSpeed").value = String(state.motion.speed);
    byId("#motionSpeedValue").textContent = `${Number(state.motion.speed).toFixed(1).replace(/\.0$/u, "")}×`;
    byId("#motionStrength").value = String(state.motion.strength);
    byId("#motionStrengthValue").textContent = `${state.motion.strength}٪`;
    canvas.dataset.motionPreset = state.motion.preset;
    byId("#deleteImageButton").disabled = !state.hasImage;
    byId("#demoReady").textContent = "جاهز";
    byId("#engineReady").textContent = "متصل";
    byId("#imageAssetCount").textContent = String(state.imageAssetCount);
    if (renderedScenes !== state.scenes) { renderSceneCards(state); renderedScenes = state.scenes; renderedSelection = state.selectedSceneId; }
    else if (renderedSelection !== state.selectedSceneId) {
      all(".scene-card", byId("#sceneList")).forEach(card => { const selected = card.dataset.sceneId === state.selectedSceneId; card.classList.toggle("selected", selected); card.setAttribute("aria-current", String(selected)); });
      renderedSelection = state.selectedSceneId;
      byId(".scene-card.selected", byId("#sceneList"))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    updateSceneActions(state);
  }
  function renderSceneCards(state) {
    const list = byId("#sceneList");
    list.replaceChildren();
    for (const scene of state.scenes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "scene-card" + (scene.id === state.selectedSceneId ? " selected" : "");
      card.dataset.sceneId = scene.id;
      card.setAttribute("aria-label", `المشهد ${scene.index + 1}${scene.id === state.selectedSceneId ? " المحدد" : ""}`);
      card.setAttribute("aria-current", scene.id === state.selectedSceneId ? "true" : "false");
      const thumb = document.createElement("span");
      thumb.className = "scene-thumb thumb-one";
      if (scene.thumbnailUrl) {
        const img = document.createElement("img");
        img.src = scene.thumbnailUrl;
        img.alt = "";
        thumb.append(img);
      } else {
        const mark = document.createElement("span");
        mark.className = "thumb-play";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "Q";
        thumb.append(mark);
      }
      const number = document.createElement("span");
      number.className = "scene-number";
      number.textContent = String(scene.index + 1).padStart(2, "0");
      card.append(thumb, number);
      card.addEventListener("click", () => engine.selectScene(scene.id));
      list.append(card);
    }
    const selected = byId(".scene-card.selected", list);
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function updateSceneActions(state) {
    const disabled = {
      duplicate: false,
      delete: !state.canDelete,
      "move-right": !state.canMoveRight,
      "move-left": !state.canMoveLeft
    };
    all('[data-scene-action]').forEach(button => { button.disabled = disabled[button.dataset.sceneAction]; });
  }
  function openImagePicker() { imageInput.click(); }

  try {
    engine = createStudioV2Engine({ canvas, onState: updateState, onError: error => {
      document.documentElement.dataset.engineError = error?.message || String(error);
      byId("#engineReady").textContent = "تعذر العرض";
    } });
    canvas.dataset.ready = "true";
  } catch (error) {
    document.documentElement.dataset.prototypeReady = "false";
    document.documentElement.dataset.engineReady = "false";
    document.documentElement.dataset.engineError = error?.message || String(error);
    console.error("QARTON Motion Studio engine initialization failed", error);
    byId("#demoReady").textContent = "تعذر التهيئة";
    byId("#engineReady").textContent = "غير متصل";
    showToast(error?.message || "تعذر تشغيل المحرك.");
  }

  all('[data-section]').forEach(button => button.addEventListener("click", () => setSection(button.dataset.section)));
  byId("#closeSheetButton").addEventListener("click", () => setSection(activeSection));
  byId("#chooseImageButton").addEventListener("click", openImagePicker);
  byId("#panelChooseImage").addEventListener("click", openImagePicker);
  replaceButton.addEventListener("click", openImagePicker);
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    if (!file || !engine) { imageInput.value = ""; return; }
    try {
      const result = await engine.addImage(file);
      showToast(`أُضيفت الصورة إلى المشهد: ${result.name}`);
    } catch (error) {
      if (error?.name !== "AbortError") showToast(error?.message || "تعذر استيراد الصورة؛ بقيت الصورة الحالية كما هي.");
    } finally {
      imageInput.value = "";
    }
  });
  byId("#deleteImageButton").addEventListener("click", () => {
    if (engine?.deleteImage()) showToast("حُذفت صورة هذا المشهد.");
  });
  byId("#playButton").addEventListener("click", () => engine?.togglePlayback());
  byId("#stopButton").addEventListener("click", () => engine?.stop());
  seek.addEventListener("input", event => { if (!updatingSeek) engine?.seek(Number(event.target.value)); });
  byId("#fullscreenButton").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await byId("#previewStage").requestFullscreen();
      else await document.exitFullscreen();
    } catch { showToast("ملء الشاشة غير متاح في هذا المتصفح."); }
  });
  byId("#addSceneButton").addEventListener("click", () => {
    try { engine.addScene(); showToast("أُضيف مشهد مستقل."); }
    catch (error) { showToast(error.message || "تعذرت إضافة المشهد."); }
  });
  menuToggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu.addEventListener("click", event => {
    const action = event.target.closest("[data-scene-action]")?.dataset.sceneAction;
    if (!action || !engine) return;
    try {
      if (action === "duplicate") engine.duplicateScene();
      else if (action === "delete") engine.deleteScene();
      else if (action === "move-right") engine.moveScene("right");
      else if (action === "move-left") engine.moveScene("left");
      menu.hidden = true;
      menuToggle.setAttribute("aria-expanded", "false");
      showToast(action === "duplicate" ? "نُسخ المشهد." : action === "delete" ? "حُذف المشهد." : "تغيّر ترتيب المشاهد.");
    } catch (error) { showToast(error.message || "تعذر تنفيذ العملية."); }
  });
  document.addEventListener("click", event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== menuToggle) {
      menu.hidden = true;
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
  byId("#aspectRatio").addEventListener("change", event => { try { engine?.setAspectRatio(event.target.value); } catch (error) { showToast(error.message); } });
  byId("#fitMode").addEventListener("change", event => { try { engine?.setFit(event.target.value); } catch (error) { showToast(error.message); } });
  byId("#cameraPreset").addEventListener("change", event => {
    try { engine?.setMotionPreset(event.target.value); }
    catch (error) { showToast(error.message || "تعذر تغيير الحركة."); }
  });
  byId("#sceneDuration").addEventListener("change", event => {
    try { engine?.setDuration(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير المدة."); }
  });
  byId("#motionSpeed").addEventListener("input", event => {
    byId("#motionSpeedValue").textContent = `${Number(event.target.value).toFixed(1).replace(/\.0$/u, "")}×`;
    try { engine?.setMotionSpeed(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير السرعة."); }
  });
  byId("#motionStrength").addEventListener("input", event => {
    byId("#motionStrengthValue").textContent = `${event.target.value}٪`;
    try { engine?.setMotionStrength(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير القوة."); }
  });
  all('[data-effect]').forEach(button => button.addEventListener("click", () => {
    all('[data-effect]').forEach(item => item.classList.toggle("active", item === button));
    studio.dataset.effect = button.dataset.effect;
  }));
  byId("#effectAmount").addEventListener("input", event => {
    byId("#effectAmountValue").textContent = event.target.value + "٪";
    canvas.style.opacity = String(.65 + Number(event.target.value) / 100 * .35);
  });
  byId("#chooseAudioButton").addEventListener("click", () => byId("#audioInput").click());
  byId("#audioInput").addEventListener("change", () => {
    const file = byId("#audioInput").files?.[0];
    if (file) {
      const label = document.createElement("span");
      label.textContent = file.name + " · معاينة اسم فقط";
      const wave = document.createElement("span");
      wave.className = "audio-wave";
      wave.setAttribute("aria-hidden", "true");
      wave.textContent = "▁ ▃ ▅ ▂ ▆";
      byId("#audioSelection").replaceChildren(wave, label);
      showToast("ربط الصوت بالمحرك مؤجل لهذه المرحلة.");
    }
    byId("#audioInput").value = "";
  });
  byId("#demoRecordButton").addEventListener("click", () => showToast("التسجيل غير مفعّل في هذه المرحلة."));
  byId("#undoButton").addEventListener("click", () => showToast("التراجع غير متاح في هذه المرحلة."));
  byId("#saveButton").addEventListener("click", () => showToast("الحفظ غير متاح في هذه المرحلة."));
  byId("#exportButton").addEventListener("click", () => showToast("التصدير غير مفعّل في هذه المرحلة."));
  window.addEventListener("error", event => {
    document.documentElement.dataset.jsError = event.message || "JavaScript error";
    byId("#demoReady").textContent = "خطأ JavaScript";
  });
  window.addEventListener("unhandledrejection", event => {
    document.documentElement.dataset.jsError = event.reason?.message || String(event.reason || "Unhandled rejection");
    byId("#demoReady").textContent = "خطأ JavaScript";
  });
  window.addEventListener("pagehide", () => engine?.dispose());
  document.documentElement.dataset.prototypeReady = engine ? "true" : "false";
})();
