import { createStudioV2Engine } from "./engine-adapter.js";
import { DEMO_CHARACTER_ART } from "./demo-character-art.js";

(() => {
  "use strict";
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const canvas = one("#previewCanvas"), studio = one("#studio"), sheet = one("#toolSheet"), toast = one("#toast");
  const imageInput = one("#imageInput"), seek = one("#timelineSeek"), sceneList = one("#sceneList");
  const commit = document.documentElement.dataset.commit || "source";
  const commitChip = one("#commitIndicator");
  const sectionNames = { photos: "الصور", motion: "الحركة", characters: "الشخصيات", effects: "المؤثرات", more: "المزيد" };
  let engine, activeSection = "", seekGuard = false, toastTimer = 0, sceneRef = null, selectedScene = "", demoIndex = -1, characterIndex = -1;

  commitChip.textContent = "Commit " + commit.slice(0, 7);
  commitChip.title = "Commit " + commit;
  function notify(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2600); }
  function setSection(name) {
    if (activeSection === name && !sheet.hidden) { activeSection = ""; sheet.hidden = true; }
    else { activeSection = name; one("#sheetTitle").textContent = sectionNames[name]; sheet.hidden = false; all(".panel-body").forEach(panel => { panel.hidden = panel.dataset.panel !== name; }); }
    all("[data-section]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.section === activeSection)));
  }
  function syncCharacters(force = false) {
    const state = engine.getTextState();
    const demoChanged = state.demoIndex !== demoIndex;
    if (force || demoChanged) {
      demoIndex = state.demoIndex;
      all("[data-demo]").forEach(button => button.classList.toggle("active", Number(button.dataset.demo) === demoIndex));
    }
    const selector = one("#characterSelect");
    if (force || demoChanged || selector.options.length !== state.characters.length) {
      selector.replaceChildren(...state.characters.map((character, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = `${character.name} · ${character.id}`; return option; }));
    }
    const dialogueSelect = one("#dialogueLineSelect");
    if (force || demoChanged || dialogueSelect.options.length !== state.turns.length || state.turns.some((turn, index) => dialogueSelect.options[index]?.dataset.speakerId !== turn.speakerId)) {
      dialogueSelect.replaceChildren(...state.turns.map((turn, index) => { const option = document.createElement("option"); option.value = String(index); option.dataset.speakerId = turn.speakerId; option.textContent = `${turn.speaker} · ${index + 1}`; return option; }));
    }
    dialogueSelect.value = String(state.selectedDialogueIndex);
    if (force || state.selectedCharacterIndex !== characterIndex) {
      characterIndex = state.selectedCharacterIndex;
      selector.value = String(characterIndex);
      const turn = state.turns[state.selectedDialogueIndex];
      if (document.activeElement !== one("#dialogueText")) one("#dialogueText").value = turn.text;
      one("#expressionSelect").value = turn.expression;
      one("#characterX").value = String(Math.round((state.characters[characterIndex]?.x ?? .5) * 100));
      one("#characterScale").value = String(Math.round((state.characters[characterIndex]?.scale ?? .6) * 100));
    }
    one("#dialogueSpeed").value = String(state.speed);
    one("#dialogueSpeedValue").textContent = Number(state.speed).toFixed(1).replace(/\.0$/u, "") + "×";
    one("#characterXValue").textContent = `${one("#characterX").value}٪`;
    one("#characterScaleValue").textContent = `${one("#characterScale").value}٪`;
    one("#characterAssetStatus").textContent = state.importedLayerCount ? `${state.importedLayerCount} طبقة مستوردة` : "أصول أنيمي أصلية · بلا صوت";
    one("#characterStatus").textContent = `${state.title} · ${state.language === "tn" ? "تونسي" : "فصحى"} · ${state.characters.length} شخصيات ثابتة · ${state.turns.length} أدوار حوار`;
  }
  function renderSceneCards(state) {
    sceneList.replaceChildren();
    for (const scene of state.scenes) {
      const card = document.createElement("button"); card.type = "button"; card.className = "scene-card" + (scene.id === state.selectedSceneId ? " selected" : ""); card.dataset.sceneId = scene.id;
      card.setAttribute("aria-label", `المشهد ${scene.index + 1}${scene.id === state.selectedSceneId ? " المحدد" : ""}`);
      const thumb = document.createElement("span"); thumb.className = "scene-thumb thumb-one";
      if (scene.thumbnailUrl) { const image = document.createElement("img"); image.src = scene.thumbnailUrl; image.alt = ""; thumb.append(image); }
      else { const mark = document.createElement("span"); mark.className = "thumb-play"; mark.textContent = "Q"; thumb.append(mark); }
      const number = document.createElement("span"); number.className = "scene-number"; number.textContent = String(scene.index + 1).padStart(2, "0"); card.append(thumb, number);
      card.addEventListener("click", () => engine.selectScene(scene.id)); sceneList.append(card);
    }
  }
  function updateState(state) {
    if (!state) return;
    document.documentElement.dataset.prototypeReady = "true"; document.documentElement.dataset.engineReady = "true";
    document.documentElement.dataset.artReady = String(state.demoArtReady);
    canvas.hidden = false; one("#emptyState").hidden = true; one("#replaceImageButton").hidden = !state.hasImage;
    studio.dataset.playing = String(state.playing); one("#playIcon").hidden = state.playing; one("#pauseIcon").hidden = !state.playing;
    one("#playButton").setAttribute("aria-label", state.playing ? "إيقاف مؤقت" : "تشغيل المعاينة");
    one("#previewLabel").textContent = state.activeSpeaker ? `${state.imageName || state.activeSpeaker} · ${state.activeSpeaker}` : (state.imageName || "مشهد حوار نصي");
    one("#resolutionChip").textContent = state.aspectRatio; one("#aspectRatio").value = state.aspectRatio; one("#fitMode").value = state.fitMode;
    one("#currentTime").textContent = state.formattedTime; one("#totalTime").textContent = state.formattedTotal;
    seekGuard = true; seek.max = String(state.totalDurationMs); seek.value = String(state.timeMs); seekGuard = false;
    one("#sceneCount").textContent = `مشهد ${state.selectedIndex + 1} من ${state.sceneCount}`;
    one("#sceneDuration").value = String(Math.round(state.sceneDurationMs / 1000)); one("#sceneDurationValue").textContent = `${Math.round(state.sceneDurationMs / 1000)} ث`;
    one("#cameraPreset").value = state.motion.preset; one("#motionSpeed").value = String(state.motion.speed);
    one("#motionSpeedValue").textContent = Number(state.motion.speed).toFixed(1).replace(/\.0$/u, "") + "×";
    one("#motionStrength").value = String(state.motion.strength); one("#motionStrengthValue").textContent = `${state.motion.strength}٪`;
    canvas.dataset.motionPreset = state.motion.preset; one("#deleteImageButton").disabled = !state.hasImage;
    one("#demoReady").textContent = "جاهز"; one("#engineReady").textContent = "متصل دون صوت"; one("#imageAssetCount").textContent = String(state.imageAssetCount);
    if (sceneRef !== state.scenes || selectedScene !== state.selectedSceneId) { renderSceneCards(state); sceneRef = state.scenes; selectedScene = state.selectedSceneId; }
    one("#sceneMenu").querySelector('[data-scene-action="delete"]').disabled = !state.canDelete;
    one("#sceneMenu").querySelector('[data-scene-action="move-right"]').disabled = !state.canMoveRight;
    one("#sceneMenu").querySelector('[data-scene-action="move-left"]').disabled = !state.canMoveLeft;
    if (engine) syncCharacters();
  }
  function openImagePicker() { imageInput.click(); }
  function fail(error) { notify(error?.message || "تعذر تنفيذ العملية."); }

  try {
    engine = createStudioV2Engine({ canvas, demoAssets: DEMO_CHARACTER_ART, onState: updateState, onError(error) { document.documentElement.dataset.engineError = error?.message || String(error); one("#engineReady").textContent = "تعذر العرض"; } });
    canvas.dataset.ready = "true";
  } catch (error) {
    document.documentElement.dataset.prototypeReady = "false"; document.documentElement.dataset.engineReady = "false";
    document.documentElement.dataset.engineError = error?.message || String(error); one("#demoReady").textContent = "تعذر التهيئة"; fail(error);
  }
  if (engine) syncCharacters(true);
  if (engine && new URLSearchParams(location.search).has("testVisual")) {
    window.__QARTON_TEST_API = Object.freeze({ state: () => engine.getTextState(), seek: value => engine.seek(value), setDialogue: (value, expression) => engine.setDialogue(value, expression), loadDemo: index => engine.loadTextDemo(index), setTextScene: value => engine.setTextScene(value), setDialogueReveal: value => engine.setDialogueReveal(value), visemes: index => engine.getDialogueVisemes(index) });
  }
  all("[data-section]").forEach(button => button.addEventListener("click", () => setSection(button.dataset.section)));
  one("#closeSheetButton").addEventListener("click", () => setSection(activeSection));
  one("#chooseImageButton").addEventListener("click", openImagePicker); one("#panelChooseImage").addEventListener("click", openImagePicker); one("#replaceImageButton").addEventListener("click", openImagePicker);
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0]; if (!file || !engine) { imageInput.value = ""; return; }
    try { const result = await engine.addImage(file); notify(`أُضيفت الصورة إلى المشهد: ${result.name}`); }
    catch (error) { if (error?.name !== "AbortError") notify(error?.message || "تعذر استيراد الصورة؛ بقيت الصورة الحالية كما هي."); }
    finally { imageInput.value = ""; }
  });
  one("#deleteImageButton").addEventListener("click", () => { if (engine?.deleteImage()) notify("حُذفت صورة هذا المشهد."); });
  one("#playButton").addEventListener("click", () => { try { engine.getState().playing ? engine.pause() : engine.play(); } catch (error) { fail(error); } });
  one("#stopButton").addEventListener("click", () => engine?.stop()); seek.addEventListener("input", event => { if (!seekGuard) try { engine?.seek(Number(event.target.value)); } catch (error) { fail(error); } });
  one("#fullscreenButton").addEventListener("click", async () => { try { if (!document.fullscreenElement) await one("#previewStage").requestFullscreen(); else await document.exitFullscreen(); } catch { notify("ملء الشاشة غير متاح في هذا المتصفح."); } });
  one("#addSceneButton").addEventListener("click", () => { try { engine.addScene(); notify("أُضيف مشهد مستقل."); } catch (error) { fail(error); } });
  one("#sceneMenuToggle").addEventListener("click", () => { const menu = one("#sceneMenu"); menu.hidden = !menu.hidden; one("#sceneMenuToggle").setAttribute("aria-expanded", String(!menu.hidden)); });
  one("#sceneMenu").addEventListener("click", event => {
    const action = event.target.closest("[data-scene-action]")?.dataset.sceneAction; if (!action || !engine) return;
    try { if (action === "duplicate") engine.duplicateScene(); else if (action === "delete") engine.deleteScene(); else engine.moveScene(action === "move-right" ? "right" : "left"); one("#sceneMenu").hidden = true; notify("تحدّث ترتيب المشاهد."); } catch (error) { fail(error); }
  });
  one("#aspectRatio").addEventListener("change", event => { try { engine?.setAspectRatio(event.target.value); } catch (error) { fail(error); } });
  one("#fitMode").addEventListener("change", event => { try { engine?.setFit(event.target.value); } catch (error) { fail(error); } });
  one("#cameraPreset").addEventListener("change", event => { try { engine?.setMotionPreset(event.target.value); } catch (error) { fail(error); } });
  one("#sceneDuration").addEventListener("change", event => { try { engine?.setDuration(Number(event.target.value)); } catch (error) { fail(error); } });
  one("#motionSpeed").addEventListener("input", event => { one("#motionSpeedValue").textContent = Number(event.target.value).toFixed(1).replace(/\.0$/u, "") + "×"; try { engine?.setMotionSpeed(Number(event.target.value)); } catch (error) { fail(error); } });
  one("#motionStrength").addEventListener("input", event => { one("#motionStrengthValue").textContent = event.target.value + "٪"; try { engine?.setMotionStrength(Number(event.target.value)); } catch (error) { fail(error); } });
  all("[data-demo]").forEach(button => button.addEventListener("click", () => { try { engine.loadTextDemo(Number(button.dataset.demo)); syncCharacters(true); } catch (error) { fail(error); } }));
  one("#characterSelect").addEventListener("change", event => { try { const character = engine.getTextState().characters[Number(event.target.value)]; engine.assignDialogueSpeaker(character.id); syncCharacters(true); } catch (error) { fail(error); } });
  one("#dialogueLineSelect").addEventListener("change", event => { try { engine.selectDialogue(Number(event.target.value)); syncCharacters(true); } catch (error) { fail(error); } });
  one("#importCharacterButton").addEventListener("click", () => one("#characterImageInput").click());
  one("#characterImageInput").addEventListener("change", async event => {
    try { const result = await engine.importCharacterAssets(event.target.files, engine.getTextState().characters[characterIndex]?.id); notify(result.mode === "portrait" ? "استوردنا صورة الشخصية وحافظنا على هويتها." : `استوردنا ${result.layerCount} طبقات للشخصية.`); syncCharacters(true); }
    catch (error) { fail(error); } finally { event.target.value = ""; }
  });
  function updateDialogue() { try { engine.setDialogue(one("#dialogueText").value, one("#expressionSelect").value); } catch (error) { fail(error); } }
  one("#dialogueText").addEventListener("input", updateDialogue); one("#expressionSelect").addEventListener("change", updateDialogue);
  one("#dialogueSpeed").addEventListener("input", event => { one("#dialogueSpeedValue").textContent = Number(event.target.value).toFixed(1).replace(/\.0$/u, "") + "×"; try { engine.setDialogueSpeed(Number(event.target.value)); syncCharacters(); } catch (error) { fail(error); } });
  one("#characterX").addEventListener("input", event => { one("#characterXValue").textContent = event.target.value + "٪"; try { engine.setCharacterPlacement(engine.getTextState().characters[characterIndex].id, { x: Number(event.target.value) / 100 }); } catch (error) { fail(error); } });
  one("#characterScale").addEventListener("input", event => { one("#characterScaleValue").textContent = event.target.value + "٪"; try { engine.setCharacterPlacement(engine.getTextState().characters[characterIndex].id, { scale: Number(event.target.value) / 100 }); } catch (error) { fail(error); } });
  one("#showAllTextButton").addEventListener("click", event => { const show = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(show)); event.currentTarget.textContent = show ? "متابعة حركة الكتابة" : "إظهار النص كاملًا"; try { engine.setDialogueReveal(show); } catch (error) { fail(error); } });
  all("[data-effect]").forEach(button => button.addEventListener("click", () => { all("[data-effect]").forEach(item => item.classList.toggle("active", item === button)); studio.dataset.effect = button.dataset.effect; }));
  one("#effectAmount").addEventListener("input", event => { one("#effectAmountValue").textContent = event.target.value + "٪"; canvas.style.opacity = String(.65 + Number(event.target.value) / 100 * .35); });
  one("#undoButton").addEventListener("click", () => notify("التراجع غير متاح في هذه المرحلة."));
  one("#saveButton").addEventListener("click", () => notify("حفظ المشروع غير مفعّل في هذا النموذج."));
  one("#exportButton").addEventListener("click", () => notify("تصدير الفيديو غير مفعّل في هذا النموذج."));
  window.addEventListener("pagehide", () => engine?.dispose());
  window.addEventListener("error", event => { document.documentElement.dataset.jsError = event.message; one("#demoReady").textContent = "خطأ JavaScript"; });
  document.documentElement.dataset.prototypeReady = engine ? "true" : "false";
})();
