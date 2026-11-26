(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const studio = $("#studio"), sheet = $("#toolSheet"), title = $("#sheetTitle"), toast = $("#toast"), imageInput = $("#imageInput"), image = $("#previewImage"), emptyState = $("#emptyState"), replaceButton = $("#replaceImageButton");
  let activeSection = "", selectedImageUrl = "", toastTimer = 0, timer = 0, elapsed = 0;
  const commitChip = $("#commitIndicator");
  const commitId = document.documentElement.dataset.commit || "source";
  if (commitChip) { commitChip.textContent = "Commit " + commitId.slice(0, 7); commitChip.title = "Commit " + commitId; }
  const sectionNames = { photos:"الصور", motion:"الحركة", audio:"الصوت", effects:"المؤثرات", more:"المزيد" };
  function showToast(message) {
    toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  function setSection(name, toggle = true) {
    if (toggle && activeSection === name && !sheet.hidden) {
      activeSection = ""; sheet.hidden = true;
      $$("[data-section]").forEach(button => button.setAttribute("aria-pressed", "false"));
      return;
    }
    activeSection = name; title.textContent = sectionNames[name]; sheet.hidden = false;
    $$(".panel-body").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    $$("[data-section]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.section === name)));
  }
  function openImagePicker() { imageInput.click(); }
  function setPlaying(playing) {
    studio.dataset.playing = String(playing); $("#playIcon").hidden = playing; $("#pauseIcon").hidden = !playing;
    $("#playButton").setAttribute("aria-label", playing ? "إيقاف مؤقت" : "تشغيل المعاينة");
    if (playing) {
      clearInterval(timer); timer = setInterval(() => {
        elapsed = (elapsed + 1) % 9;
        $("#currentTime").textContent = "00:" + String(elapsed).padStart(2, "0");
        $("#progressBar").style.width = Math.min(100, elapsed / 8 * 100) + "%";
      }, 1000);
    } else clearInterval(timer);
  }
  $$("[data-section]").forEach(button => button.addEventListener("click", () => setSection(button.dataset.section)));
  $("#closeSheetButton").addEventListener("click", () => setSection(activeSection));
  $("#chooseImageButton").addEventListener("click", openImagePicker);
  $("#panelChooseImage").addEventListener("click", openImagePicker);
  replaceButton.addEventListener("click", openImagePicker);
  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0]; if (!file) return;
    if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
    selectedImageUrl = URL.createObjectURL(file); image.src = selectedImageUrl; image.hidden = false; emptyState.hidden = true; replaceButton.hidden = false;
    $("#previewLabel").textContent = file.name || "معاينة الصورة";
    $$(".scene-card.selected .scene-thumb").forEach(thumb => {
      const thumbImage = document.createElement("img"); thumbImage.src = selectedImageUrl; thumbImage.alt = ""; thumb.replaceChildren(thumbImage);
    });
    showToast("عُرضت الصورة في نموذج المعاينة فقط."); imageInput.value = "";
  });
  $("#fitImageButton").addEventListener("click", () => {
    image.style.objectFit = image.style.objectFit === "contain" ? "cover" : "contain";
    showToast(image.style.objectFit === "contain" ? "الصورة كاملة داخل الإطار." : "الصورة تملأ الإطار.");
  });
  $("#playButton").addEventListener("click", () => setPlaying(studio.dataset.playing !== "true"));
  $("#stopButton").addEventListener("click", () => { setPlaying(false); elapsed = 0; $("#currentTime").textContent = "00:00"; $("#progressBar").style.width = "0%"; });
  $("#fullscreenButton").addEventListener("click", async () => {
    try { if (!document.fullscreenElement) await $("#previewStage").requestFullscreen(); else await document.exitFullscreen(); }
    catch { showToast("ملء الشاشة غير متاح في هذا المتصفح."); }
  });
  $("#addSceneButton").addEventListener("click", () => {
    const count = $$(".scene-card").length + 1, card = document.createElement("button");
    card.type = "button"; card.className = "scene-card"; card.dataset.scene = String(count); card.setAttribute("aria-label", "المشهد " + count);
    const thumb = document.createElement("span"); thumb.className = "scene-thumb thumb-one";
    const play = document.createElement("span"); play.className = "thumb-play"; play.setAttribute("aria-hidden", "true"); play.textContent = "▶"; thumb.append(play);
    const number = document.createElement("span"); number.className = "scene-number"; number.textContent = String(count).padStart(2, "0");
    card.append(thumb, number); $("#sceneList").append(card);
    $$(".scene-card").forEach(item => item.classList.toggle("selected", item === card));
    $("#sceneCount").textContent = "مشهد " + count + " من " + count;
    card.addEventListener("click", () => {
      $$(".scene-card").forEach(item => item.classList.toggle("selected", item === card));
      $("#sceneCount").textContent = "المشهد " + Number(card.dataset.scene) + " من " + $$(".scene-card").length;
    });
    $("#sceneList").scrollLeft = $("#sceneList").scrollWidth; showToast("أُضيف مشهد شكلي للنموذج.");
  });
  $$("[data-motion-preset]").forEach(button => button.addEventListener("click", () => {
    $$("[data-motion-preset]").forEach(item => item.classList.toggle("active", item === button));
    studio.dataset.motion = button.dataset.motionPreset;
  }));
  $("#motionSpeed").addEventListener("input", event => { $("#motionSpeedValue").textContent = ["هادئة","متوسطة","سريعة"][Number(event.target.value)-1]; });
  $$("[data-effect]").forEach(button => button.addEventListener("click", () => {
    $$("[data-effect]").forEach(item => item.classList.toggle("active", item === button)); studio.dataset.effect = button.dataset.effect;
  }));
  $("#effectAmount").addEventListener("input", event => {
    $("#effectAmountValue").textContent = event.target.value + "٪"; image.style.opacity = String(.65 + Number(event.target.value)/100*.35);
  });
  $("#chooseAudioButton").addEventListener("click", () => $("#audioInput").click());
  $("#audioInput").addEventListener("change", () => {
    const file = $("#audioInput").files && $("#audioInput").files[0];
    if (file) {
      const label = document.createElement("span"); label.textContent = file.name + " · معاينة اسم فقط";
      const wave = document.createElement("span"); wave.className = "audio-wave"; wave.setAttribute("aria-hidden","true"); wave.textContent = "▁ ▃ ▅ ▂ ▆";
      $("#audioSelection").replaceChildren(wave,label); showToast("لم يُضف الصوت إلى Timeline في هذا النموذج.");
    }
    $("#audioInput").value = "";
  });
  $("#demoRecordButton").addEventListener("click", () => showToast("التسجيل الحقيقي غير مفعّل في النموذج."));
  $("#undoButton").addEventListener("click", () => showToast("التراجع غير مربوط؛ هذه واجهة تجريبية."));
  $("#saveButton").addEventListener("click", () => showToast("الحفظ غير مربوط بنظام المشاريع."));
  $("#exportButton").addEventListener("click", () => showToast("التصدير غير مفعّل قبل اعتماد التصميم."));
  window.addEventListener("pagehide", () => { clearInterval(timer); if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl); });
  document.documentElement.dataset.prototypeReady = "true";
})();