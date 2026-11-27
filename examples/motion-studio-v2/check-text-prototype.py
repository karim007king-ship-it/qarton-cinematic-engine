from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "dist/motion-studio-v2-l14c2-android-preview/index.html"
OUT = HTML.parent
SHOTS = OUT / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)
if not HTML.exists():
    raise SystemExit("Build the standalone L14-C2 HTML before running this check")


def set_range(page, selector, value):
    page.locator(selector).evaluate("(el, value) => { el.value=String(value); el.dispatchEvent(new Event('input', {bubbles:true})); }", value)


def visual_regression(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(HTML.as_uri() + "?testVisual=1", wait_until="load")
    page.wait_for_function("document.documentElement.dataset.artReady === 'true'")
    page.wait_for_function("window.__QARTON_TEST_API?.state().artReady === true")
    canvas = page.locator("#previewCanvas")
    page.evaluate("window.__QARTON_TEST_API.seek(1200)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"layla", "youssef"} and len(ids) == len(set(ids)), ids
    page.locator('[data-section="characters"]').click()
    page.locator("#previewCanvas").screenshot(path=str(SHOTS / "family-two-character.png"))
    portrait = ROOT / "examples/motion-studio-v2/assets/characters/layla.webp"
    page.locator("#characterImageInput").set_input_files(str(portrait))
    page.wait_for_function("window.__QARTON_TEST_API.state().importedPortraitCount === 1")
    with tempfile.TemporaryDirectory(prefix="qarton-layer-fixture-") as folder:
        body = Path(folder) / "layla__body.webp"
        head = Path(folder) / "layla__head.webp"
        shutil.copyfile(portrait, body)
        shutil.copyfile(portrait, head)
        page.locator("#characterImageInput").set_input_files([str(body), str(head)])
        page.wait_for_function("window.__QARTON_TEST_API.state().importedLayerCount === 2")
        assert page.locator("#previewCanvas").evaluate("el => el.dataset.renderedCharacterIds.split(',').length === 2")
    page.locator("#characterImageInput").set_input_files(str(portrait))
    page.wait_for_function("window.__QARTON_TEST_API.state().importedPortraitCount === 1")

    page.evaluate("window.__QARTON_TEST_API.loadDemo(1)")
    page.wait_for_function("document.querySelectorAll('#characterSelect option').length === 3")
    assert page.locator("#dialogueLineSelect option").count() == 4
    page.evaluate("window.__QARTON_TEST_API.seek(800)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"layla", "youssef", "salim"} and len(ids) == len(set(ids)), ids
    page.locator("#previewCanvas").screenshot(path=str(SHOTS / "confrontation-three-character.png"))

    page.evaluate("window.__QARTON_TEST_API.loadDemo(2)")
    page.wait_for_function("document.querySelectorAll('#characterSelect option').length === 2")
    page.evaluate("window.__QARTON_TEST_API.seek(1300)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"nour", "youssef"} and len(ids) == len(set(ids)), ids
    page.locator("#previewCanvas").screenshot(path=str(SHOTS / "emotional-two-character.png"))
    reports = []
    sprite_keys = ["layla", "youssef", "nour", "salim"]
    for count in (4, 8):
        characters = [{"id": f"visual-{index + 1}", "name": f"شخصية {index + 1}", "spriteKey": sprite_keys[index % 4], "x": (index + 1) / (count + 1), "y": .76, "scale": .35 if count == 4 else .22, "z": index} for index in range(count)]
        dialogue = [{"id": f"role-{index + 1}", "speakerId": character["id"], "text": "نحكيوا مع بعضنا ونلقاو الطريق.", "expression": "thinking" if index % 2 else "determined"} for index, character in enumerate(characters)]
        page.evaluate("definition => window.__QARTON_TEST_API.setTextScene(definition)", {"id": f"crowd-{count}", "title": f"مشهد {count} شخصيات", "language": "tn", "theme": "ruins", "characters": characters, "dialogue": dialogue})
        page.evaluate("window.__QARTON_TEST_API.seek(1400)")
        ids = canvas.get_attribute("data-rendered-character-ids").split(",")
        assert len(ids) == count and len(ids) == len(set(ids)), ids
        if count == 8:
            page.locator("#previewCanvas").screenshot(path=str(SHOTS / "eight-character-scene.png"))
        reports.append({"characters": count, "uniqueCharacterIds": True})
    page.evaluate("window.__QARTON_TEST_API.setTextScene({id:'mouth-poses',title:'أوضاع الفم',language:'tn',theme:'family',characters:[{id:'layla',name:'ليلى',spriteKey:'layla',x:.31,y:.82,scale:.72,z:0}],dialogue:[{id:'visemes',speakerId:'layla',expression:'neutral',text:'بْ بُو يِ ف س عَ'}]})")
    timeline = page.evaluate("window.__QARTON_TEST_API.visemes(0)")
    pose_reports = []
    pose_hashes = set()
    for viseme in ("closed", "round", "wide", "teeth", "open"):
        event = next(item for item in timeline["events"] if item["viseme"] == viseme)
        timestamp = timeline["startMs"] + event["offsetMs"] + max(1, event["durationMs"] // 2)
        page.evaluate("time => window.__QARTON_TEST_API.seek(time)", timestamp)
        assert canvas.get_attribute("data-active-viseme") == viseme, {"wanted": viseme, "got": canvas.get_attribute("data-active-viseme")}
        page.locator("#previewCanvas").screenshot(path=str(SHOTS / f"mouth-{viseme}.png"))
        region = page.evaluate("() => { const c=document.querySelector('#previewCanvas'); const d=c.getContext('2d').getImageData(220,460,80,80).data; let h=2166136261; for(let i=0;i<d.length;i+=4){h=Math.imul(h^d[i],16777619);h=Math.imul(h^d[i+1],16777619);h=Math.imul(h^d[i+2],16777619);} return String(h>>>0); }")
        pose_hashes.add(region)
        pose_reports.append({"viseme": viseme, "capture": f"mouth-{viseme}.png"})
    assert len(pose_hashes) >= 4, "Viseme ROI did not produce visibly distinct render samples"
    return {"scenes": 3, "uniqueCharacterIds": True, "renderCounts": reports, "mouthPoseCaptures": pose_reports, "visuallyDistinctMouthRegions": len(pose_hashes), "screenshots": ["family-two-character.png", "confrontation-three-character.png", "emotional-two-character.png", "eight-character-scene.png"]}


def exercise(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(HTML.as_uri() + "?testVisual=1", wait_until="load")
    page.wait_for_function("document.documentElement.dataset.prototypeReady === 'true'")
    page.wait_for_function("document.documentElement.dataset.artReady === 'true'")
    assert page.locator("#commitIndicator").inner_text().startswith("Commit ")
    assert page.locator("#previewCanvas").is_visible()
    assert page.locator("#characterSelect option").count() == 2
    assert page.locator("#dialogueLineSelect option").count() == 4
    assert page.locator("#textEngineStatus").evaluate("el => el.textContent") == "جاهز دون صوت"
    assert page.locator("#audioInput, #demoRecordButton, #micReady").count() == 0
    page.locator("[data-section='characters']").click()
    assert "طبقات" in page.locator("#characterAssetStatus").inner_text() or "أصول" in page.locator("#characterAssetStatus").inner_text()
    page.locator("#dialogueLineSelect").select_option("1")
    assert page.locator("#characterSelect").input_value() == "1"
    page.locator("#characterSelect").select_option("0")
    assert "ليلى" in page.locator("#dialogueLineSelect option:checked").inner_text()
    page.locator("#dialogueText").fill("مَبْسُوطٌ، فِي قرطاج؟\nنعم! هذا مشهد طويل " * 8)
    page.locator("#expressionSelect").select_option("determined")
    set_range(page, "#dialogueSpeed", 1.6)
    page.locator("#showAllTextButton").click()
    assert page.locator("#showAllTextButton").get_attribute("aria-pressed") == "true"
    page.locator("#characterScale").evaluate("el => { el.value='53'; el.dispatchEvent(new Event('input',{bubbles:true})); }")
    page.locator("#closeSheetButton").click()
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "true"
    page.wait_for_timeout(220)
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "false"
    page.locator("#timelineSeek").evaluate("el => { el.value='1600'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    assert page.locator("#currentTime").inner_text() != "00:00"
    state = page.evaluate("window.__QARTON_TEST_API.state()")
    assert state["turns"][1]["text"].startswith("مَبْسُوط")
    page.locator("#stopButton").click()
    assert page.locator("#currentTime").inner_text() == "00:00"
    page.locator("#playButton").click()
    page.wait_for_timeout(100)
    page.locator("#stopButton").click()
    states = page.evaluate("({audioContexts:window.__audioContextConstructed,getUserMediaCalls:window.__getUserMediaCalls,viseme:document.querySelector('#previewCanvas').dataset.activeViseme})")
    assert states["audioContexts"] == 0, states
    assert states["getUserMediaCalls"] == 0, states
    assert page.locator("#previewCanvas").evaluate("e => e.width > 0 && e.height > 0")
    return {"width": width, "height": height, "state": states}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or None, args=["--allow-file-access-from-files"])
    context = browser.new_context(viewport={"width": 390, "height": 844})
    context.add_init_script("""
      window.__audioContextConstructed=0; window.__getUserMediaCalls=0;
      for (const key of ['AudioContext','webkitAudioContext']) if (window[key]) {
        const Original=window[key]; window[key]=new Proxy(Original,{construct(target,args){window.__audioContextConstructed++;return Reflect.construct(target,args)}});
      }
      if (navigator.mediaDevices?.getUserMedia) { const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=(...args)=>{window.__getUserMediaCalls++;return original(...args)}; }
    """)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    visuals = visual_regression(page)
    reports = [exercise(page, width, 844) for width in (320, 360, 390, 412, 480)]
    landscape = exercise(page, 844, 390)
    assert not errors, errors
    (OUT / "text-animation-check-results.json").write_text(json.dumps({"responsive": reports, "landscape": landscape, "visualScenes": visuals, "pageErrors": errors}, ensure_ascii=False, indent=2))
    print("L14-C2 text-animation and visual-scene checks passed at 320, 360, 390, 412, 480px and landscape; unique character IDs, silent playback and PNG/WebP layering UI verified.")
    browser.close()
