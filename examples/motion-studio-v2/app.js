import { createStudioV2Engine } from "./engine-adapter.js";

(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const studio = $("#studio");
  const canvas = $("#previewCanvas");
  const sheet = $("#toolSheet");
  const title = $("#sheetTitle");
  const toast = $("#toast");
  const imageInput = $("#imageInput");
  const emptyState = $("#emptyState");
  const replaceButton = $("#replaceImageButton");
  const menu = $("#sceneMenu");
  const menuToggle = $("#sceneMenuToggle");
  const seek = $("#timelineSeek");
  const commitChip = $("#commitIndicator");
  const commitId = document.documentElement.dataset.commit || "source";
  const sectionNames = { photos: "الصور", motion: "الحركة", audio: "الصوت", effects: "المؤثرات", more: "المزيد" };
  let activeSection = "";
  let toastTimer = 0;
  let engine;
  let updatingSeek = false;

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
      $$('[data-section]').forEach(button => button.setAttribute("aria-pressed", "false"));
      return;
    }
    activeSection = name;
    title.textContent = sectionNames[name];
    sheet.hidden = false;
    $$(".panel-body").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    $$('[data-section]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.section === name)));
  }
  function updateState(state) {
    if (!state) return;
    document.documentElement.dataset.prototypeReady = "true";
    document.documentElement.dataset.engineReady = "true";
    canvas.hidden = !state.hasImage;
    emptyState.hidden = state.hasImage;
    replaceButton.hidden = !state.hasImage;
    studio.dataset.playing = String(state.playing);
    $("#playIcon").hidden = state.playing;
    $("#pauseIcon").hidden = !state.playing;
    $("#playButton").setAttribute("aria-label", state.playing ? "إيقاف مؤقت" : "تشغيل المعاينة");
    $("#previewLabel").textContent = state.hasImage ? state.imageName : "معاينة المحرك";
    $("#currentTime").textContent = state.formattedTime;
    $("#totalTime").textContent = state.formattedTotal;
    updatingSeek = true;
    seek.max = String(state.totalDurationMs);
    seek.value = String(state.timeMs);
    updatingSeek = false;
    $("#sceneCount").textContent = `مشهد ${state.selectedIndex + 1} من ${state.sceneCount}`;
    $("#sceneDuration").value = String(Math.round(state.sceneDurationMs / 1000));
    $("#sceneDurationValue").textContent = `${Math.round(state.sceneDurationMs / 1000)} ث`;
    $("#cameraPreset").value = state.motion.preset;
    $("#motionSpeed").value = String(state.motion.speed);
    $("#motionSpeedValue").textContent = `${Number(state.motion.speed).toFixed(1).replace(/\.0$/u, "")}×`;
    $("#motionStrength").value = String(state.motion.strength);
    $("#motionStrengthValue").textContent = `${state.motion.strength}٪`;
    $("#deleteImageButton").disabled = !state.hasImage;
    $("#demoReady").textContent = "جاهز";
    $("#engineReady").textContent = "متصل";
    $("#imageAssetCount").textContent = String(state.imageAssetCount);
    renderSceneCards(state);
    updateSceneActions(state);
  }
  function renderSceneCards(state) {
    const list = $("#sceneList");
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
    const selected = $(".scene-card.selected", list);
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function updateSceneActions(state) {
    const disabled = {
      duplicate: false,
      delete: !state.canDelete,
      "move-right": !state.canMoveRight,
      "move-left": !state.canMoveLeft
    };
    $$('[data-scene-action]').forEach(button => { button.disabled = disabled[button.dataset.sceneAction]; });
  }
  function openImagePicker() { imageInput.click(); }

  try {
    engine = createStudioV2Engine({ canvas, onState: updateState, onError: error => {
      document.documentElement.dataset.engineError = error?.message || String(error);
      $("#engineReady").textContent = "تعذر العرض";
    } });
    canvas.dataset.ready = "true";
  } catch (error) {
    document.documentElement.dataset.prototypeReady = "false";
    document.documentElement.dataset.engineReady = "false";
    document.documentElement.dataset.engineError = error?.message || String(error);
    console.error("QARTON Motion Studio engine initialization failed", error);
    $("#demoReady").textContent = "تعذر التهيئة";
    $("#engineReady").textContent = "غير متصل";
    showToast(error?.message || "تعذر تشغيل المحرك.");
  }

  $$('[data-section]').forEach(button => button.addEventListener("click", () => setSection(button.dataset.section)));
  $("#closeSheetButton").addEventListener("click", () => setSection(activeSection));
  $("#chooseImageButton").addEventListener("click", openImagePicker);
  $("#panelChooseImage").addEventListener("click", openImagePicker);
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
  $("#deleteImageButton").addEventListener("click", () => {
    if (engine?.deleteImage()) showToast("حُذفت صورة هذا المشهد.");
  });
  $("#playButton").addEventListener("click", () => engine?.togglePlayback());
  $("#stopButton").addEventListener("click", () => engine?.stop());
  seek.addEventListener("input", event => { if (!updatingSeek) engine?.seek(Number(event.target.value)); });
  $("#fullscreenButton").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await $("#previewStage").requestFullscreen();
      else await document.exitFullscreen();
    } catch { showToast("ملء الشاشة غير متاح في هذا المتصفح."); }
  });
  $("#addSceneButton").addEventListener("click", () => {
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
  $("#cameraPreset").addEventListener("change", event => {
    try { engine?.setMotionPreset(event.target.value); }
    catch (error) { showToast(error.message || "تعذر تغيير الحركة."); }
  });
  $("#sceneDuration").addEventListener("change", event => {
    try { engine?.setDuration(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير المدة."); }
  });
  $("#motionSpeed").addEventListener("input", event => {
    $("#motionSpeedValue").textContent = `${Number(event.target.value).toFixed(1).replace(/\.0$/u, "")}×`;
    try { engine?.setMotionSpeed(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير السرعة."); }
  });
  $("#motionStrength").addEventListener("input", event => {
    $("#motionStrengthValue").textContent = `${event.target.value}٪`;
    try { engine?.setMotionStrength(Number(event.target.value)); }
    catch (error) { showToast(error.message || "تعذر تغيير القوة."); }
  });
  $$('[data-effect]').forEach(button => button.addEventListener("click", () => {
    $$('[data-effect]').forEach(item => item.classList.toggle("active", item === button));
    studio.dataset.effect = button.dataset.effect;
  }));
  $("#effectAmount").addEventListener("input", event => {
    $("#effectAmountValue").textContent = event.target.value + "٪";
    canvas.style.opacity = String(.65 + Number(event.target.value) / 100 * .35);
  });
  $("#chooseAudioButton").addEventListener("click", () => $("#audioInput").click());
  $("#audioInput").addEventListener("change", () => {
    const file = $("#audioInput").files?.[0];
    if (file) {
      const label = document.createElement("span");
      label.textContent = file.name + " · معاينة اسم فقط";
      const wave = document.createElement("span");
      wave.className = "audio-wave";
      wave.setAttribute("aria-hidden", "true");
      wave.textContent = "▁ ▃ ▅ ▂ ▆";
      $("#audioSelection").replaceChildren(wave, label);
      showToast("ربط الصوت بالمحرك مؤجل لهذه المرحلة.");
    }
    $("#audioInput").value = "";
  });
  $("#demoRecordButton").addEventListener("click", () => showToast("التسجيل غير مفعّل في هذه المرحلة."));
  $("#undoButton").addEventListener("click", () => showToast("التراجع غير متاح في هذه المرحلة."));
  $("#saveButton").addEventListener("click", () => showToast("الحفظ غير متاح في هذه المرحلة."));
  $("#exportButton").addEventListener("click", () => showToast("التصدير غير مفعّل في هذه المرحلة."));
  window.addEventListener("error", event => {
    document.documentElement.dataset.jsError = event.message || "JavaScript error";
    $("#demoReady").textContent = "خطأ JavaScript";
  });
  window.addEventListener("unhandledrejection", event => {
    document.documentElement.dataset.jsError = event.reason?.message || String(event.reason || "Unhandled rejection");
    $("#demoReady").textContent = "خطأ JavaScript";
  });
  window.addEventListener("pagehide", () => engine?.dispose());
  document.documentElement.dataset.prototypeReady = engine ? "true" : "false";
})();
