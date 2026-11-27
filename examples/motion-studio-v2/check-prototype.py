from pathlib import Path
from struct import pack
from zlib import crc32, compress
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "dist/motion-studio-v2-l14b-android-preview/index.html"
SCREENSHOTS = ROOT / "dist/motion-studio-v2-l14b-android-preview/screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

def png(width, height, rgba):
    def chunk(kind, data):
        return pack(">I", len(data)) + kind + data + pack(">I", crc32(kind + data) & 0xffffffff)
    row = bytes([0]) + bytes(rgba) * width
    raw = row * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">2I5B", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", compress(raw)) + chunk(b"IEND", b"")

assert HTML.exists(), f"missing standalone preview: {HTML}"
source = HTML.read_text(encoding="utf-8")
assert '<style>' in source and 'createStudioV2Engine' in source and 'createSceneClock' in source
assert 'data-commit="' in source and 'type="module"' not in source
assert './app.css' not in source and './app.js' not in source
assert 'href="http' not in source and 'src="http' not in source
console_errors = []
external_requests = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.route("https://**/*", lambda route: (external_requests.append(route.request.url), route.abort()))
    page.route("http://**/*", lambda route: (external_requests.append(route.request.url), route.abort()))
    page.goto(HTML.as_uri(), wait_until="load")
    page.wait_for_timeout(500)
    boot = page.evaluate("""() => ({
      root: {...document.documentElement.dataset},
      scripts: [...document.scripts].map(script => ({type:script.type, src:script.src, chars:script.textContent.length, start:script.textContent.slice(0,100)})),
      tail: document.body.innerHTML.slice(-180)
    })""")
    assert page.evaluate("document.documentElement.dataset.engineReady") == "true", json.dumps({**boot, "browserErrors": console_errors}, ensure_ascii=False)
    assert page.locator("#demoReady").inner_text() == "جاهز"
    assert page.locator("#engineReady").inner_text() == "متصل"
    assert page.locator("#previewCanvas").get_attribute("data-ready") == "true"
    assert page.locator("#previewCanvas").get_attribute("data-rendered-scene")
    assert page.locator("#commitIndicator").inner_text().startswith("Commit ")

    def choose_file(locator, name, body, mime="image/png"):
        locator.set_input_files({"name": name, "mimeType": mime, "buffer": body})

    img_a = png(32, 32, (210, 30, 20, 255))
    img_b = png(32, 32, (20, 30, 210, 255))
    choose_file(page.locator("#imageInput"), "first.png", img_a)
    page.wait_for_function("document.querySelector('#previewCanvas').hidden === false")
    assert page.locator("#previewLabel").inner_text() == "first.png"
    assert page.locator("#imageAssetCount").inner_text() == "1"

    def set_range(selector, value):
        page.locator(selector).evaluate("(el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }", value)

    # Replace is transactional: image and asset counts update only after valid decode.
    choose_file(page.locator("#imageInput"), "replacement.png", img_b)
    page.wait_for_function("document.querySelector('#previewLabel').textContent === 'replacement.png'")
    assert page.locator("#imageAssetCount").inner_text() == "1"
    choose_file(page.locator("#imageInput"), "broken.png", b"not an image")
    page.wait_for_function("document.querySelector('#toast').textContent.includes('تعذر فك ترميز')")
    assert page.locator("#previewLabel").inner_text() == "replacement.png"
    assert page.locator("#imageAssetCount").inner_text() == "1", "failed import left an orphan image asset"
    # A picker cancellation produces no selected file and must preserve the current image.
    page.locator("#imageInput").evaluate("input => { input.value = ''; input.dispatchEvent(new Event('change', {bubbles:true})); }")
    assert page.locator("#previewLabel").inner_text() == "replacement.png"

    # A slow decode must remain attached to the scene captured at import start.
    page.evaluate("""() => { const decode = createImageBitmap.bind(window); window.__nativeCreateImageBitmap = decode; let release; window.__decodeStarted = false; window.__releaseDecode = () => release?.(); window.createImageBitmap = async (...args) => { if (!window.__decodeStarted) { window.__decodeStarted = true; await new Promise(resolve => { release = resolve; }); } return decode(...args); }; }""")
    page.locator("#addSceneButton").click()
    assert page.locator(".scene-card").count() == 2
    assert page.locator("#previewCanvas").is_hidden(), "Add scene must create an empty scene"
    choose_file(page.locator("#imageInput"), "race-switch.png", img_b)
    page.wait_for_function("window.__decodeStarted === true")
    page.locator(".scene-card").first.click()
    page.evaluate("window.__releaseDecode()")
    page.wait_for_timeout(250)
    page.locator(".scene-card").first.click()
    assert page.locator("#previewLabel").inner_text() == "replacement.png", "switching scenes changed the original target image"
    page.locator(".scene-card").nth(1).click()
    assert page.locator("#previewCanvas").is_visible() and page.locator("#previewLabel").inner_text() == "race-switch.png", "image import followed selection instead of captured target scene"
    # Deleting the captured scene during decode aborts import and leaves no orphan.
    page.evaluate("window.__decodeStarted = false")
    choose_file(page.locator("#imageInput"), "race-delete.png", img_b)
    page.wait_for_function("window.__decodeStarted === true")
    page.locator("#sceneMenuToggle").click()
    page.locator('[data-scene-action="delete"]').click()
    page.evaluate("window.__releaseDecode()")
    page.wait_for_timeout(250)
    assert page.locator("#imageAssetCount").inner_text() == "1", "deleted-scene import left an orphan asset"
    page.evaluate("() => { window.createImageBitmap = window.__nativeCreateImageBitmap; }")

    # Exercise image removal and verified recovery from the empty state.
    page.locator(".scene-card").first.click()
    page.locator('[data-section="photos"]').click()
    page.locator("#deleteImageButton").click()
    page.wait_for_function("document.querySelector('#previewCanvas').hidden === true")
    assert page.locator("#imageAssetCount").inner_text() == "0"
    choose_file(page.locator("#imageInput"), "scene-image.png", img_a)
    page.wait_for_function("document.querySelector('#previewCanvas').hidden === false")
    page.locator("#closeSheetButton").click()

    # Scene operations use the sequence API: add, duplicate, reorder, delete, select.
    page.locator("#addSceneButton").click()
    assert page.locator(".scene-card").count() == 2
    page.locator("#sceneMenuToggle").click()
    page.locator('[data-scene-action="duplicate"]').click()
    assert page.locator(".scene-card").count() == 3
    ids_before = page.locator(".scene-card").evaluate_all("cards => cards.map(card => card.dataset.sceneId)")
    page.locator("#sceneMenuToggle").click()
    page.locator('[data-scene-action="move-right"]').click()
    ids_after = page.locator(".scene-card").evaluate_all("cards => cards.map(card => card.dataset.sceneId)")
    assert ids_before != ids_after
    page.locator("#sceneMenuToggle").click()
    page.locator('[data-scene-action="delete"]').click()
    assert page.locator(".scene-card").count() == 2
    page.locator(".scene-card").first.click()
    assert page.locator("#previewCanvas").get_attribute("data-rendered-scene") == page.locator(".scene-card.selected").get_attribute("data-scene-id")

    # Aspect ratios and Fit/Fill change the engine canvas backing store, not only CSS.
    page.locator('[data-section="more"]').click()
    page.locator(".more-panel .disclosure summary").first.click()
    ratios = {"9:16":720/1280, "16:9":1280/720, "1:1":1, "4:5":864/1080, "4:3":960/720, "3:4":720/960}
    for ratio, expected in ratios.items():
        page.locator("#aspectRatio").select_option(ratio)
        actual = page.locator("#previewCanvas").evaluate("c => c.width / c.height")
        assert abs(actual - expected) < .002, f"incorrect backing ratio for {ratio}: {actual}"
    assert page.locator("#resolutionChip").inner_text() == "3:4"
    page.locator("#aspectRatio").select_option("16:9")
    page.locator("#fitMode").select_option("fit")
    assert page.locator("#previewCanvas").get_attribute("data-rendered-scene")
    page.locator("#aspectRatio").select_option("original")
    page.locator("#fitMode").select_option("fill")
    page.locator("#closeSheetButton").click()

    # Duration, camera directions and the core camera track all affect the rendered preview.
    page.locator('[data-section="motion"]').click()
    set_range("#sceneDuration", 10)
    assert page.locator("#totalTime").inner_text() == "00:13"
    poses = {}
    for preset in ["zoom-in", "zoom-out", "right", "left", "up", "down", "static"]:
        page.locator("#cameraPreset").select_option(preset)
        page.wait_for_function("preset => document.querySelector('#previewCanvas').dataset.motionPreset === preset", arg=preset)
        set_range("#timelineSeek", 4000)
        page.wait_for_timeout(80)
        poses[preset] = page.locator("#previewCanvas").get_attribute("data-camera-pose")
    assert poses["zoom-in"] != poses["static"], f"zoom-in camera pose did not change: {poses}"
    assert poses["zoom-out"] != poses["static"], f"zoom-out camera pose did not change: {poses}"
    assert poses["right"] != poses["left"], f"horizontal camera poses did not differ: {poses}"
    assert poses["up"] != poses["down"], f"vertical camera poses did not differ: {poses}"
    set_range("#motionSpeed", 1.5)
    set_range("#motionStrength", 75)
    assert page.locator("#motionSpeedValue").inner_text() == "1.5×"
    assert page.locator("#motionStrengthValue").inner_text() == "75٪"
    page.locator("#closeSheetButton").click()

    # Unified transport: seek, play, pause, stop, replay.
    set_range("#timelineSeek", 2500)
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "true"
    page.wait_for_timeout(1100)
    after_play = int(page.locator("#timelineSeek").input_value())
    assert after_play > 2500
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "false"
    paused_at = int(page.locator("#timelineSeek").input_value())
    page.wait_for_timeout(250)
    assert int(page.locator("#timelineSeek").input_value()) == paused_at
    page.locator("#stopButton").click()
    assert page.locator("#timelineSeek").input_value() == "0"
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "true"
    page.locator("#stopButton").click()

    # Playback must preserve scene-card nodes between frames; also exercise 50 scenes.
    page.evaluate("window.__sceneCard = document.querySelector('.scene-card')")
    page.locator("#playButton").click()
    page.wait_for_timeout(300)
    assert page.evaluate("window.__sceneCard === document.querySelector('.scene-card') && window.__sceneCard.isConnected"), "scene thumbnail DOM rebuilt during playback"
    page.locator("#stopButton").click()
    while page.locator(".scene-card").count() < 50:
        page.locator("#addSceneButton").click()
    assert page.locator(".scene-card").count() == 50

    # Portrait sizes requested for phone and compact landscape.
    for width in [320, 360, 390, 412, 480]:
        page.set_viewport_size({"width": width, "height": 844})
        page.wait_for_timeout(30)
        dims = page.evaluate("({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight})")
        assert dims["w"] <= width + 1, f"horizontal overflow at {width}: {dims}"
        assert dims["h"] <= 845, f"vertical overflow at {width}: {dims}"
        for button in page.locator("button:visible").all():
            box = button.bounding_box()
            assert box and box["width"] >= 44 and box["height"] >= 44, f"small touch target at {width}: {box}"
    for width, height in [(640, 360), (800, 400)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(50)
        dims = page.evaluate("({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})")
        assert dims["w"] <= width + 1 and dims["h"] <= height + 1, f"landscape overflow: {dims}"
        assert page.locator("#previewStage").is_visible()
        for button in page.locator("button:visible").all():
            box = button.bounding_box()
            assert box and box["width"] >= 44 and box["height"] >= 44, f"small landscape target at {width}: {box}"
    page.screenshot(path=str(SCREENSHOTS / "l14b-integrated-preview.png"), full_page=True)
    assert not external_requests, f"offline test made network requests: {external_requests}"
    assert not console_errors, f"browser errors: {console_errors}"
    browser.close()
print(json.dumps({"ok": True, "portraitWidths": [320,360,390,412,480], "landscape": ["640x360", "800x400"], "offline": True, "imageImportReplaceCancelCorruptDelete": True, "sceneSequence": True, "cameraPresets": 7, "aspectRatios": ["Original","9:16","16:9","1:1","4:5","4:3","3:4"], "raceImportSwitchDelete": True, "thumbnailStableDuringPlayback": True, "sceneCounts": [10,20,50], "transport": True}, ensure_ascii=False))
