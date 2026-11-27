from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "dist/motion-studio-v2-l14c2-android-preview/index.html"
OUT = HTML.parent
(OUT / "screenshots").mkdir(parents=True, exist_ok=True)
if not HTML.exists():
    raise SystemExit("Build the standalone L14-C2 HTML before running this check")


def exercise(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(HTML.as_uri(), wait_until="load")
    page.wait_for_function("document.documentElement.dataset.prototypeReady === 'true'")
    assert page.locator("#commitIndicator").inner_text().startswith("Commit ")
    assert page.locator("#previewCanvas").is_visible()
    assert page.locator("#characterSelect option").count() == 3
    assert page.locator("#textEngineStatus").evaluate("el => el.textContent") == "جاهز دون صوت"
    assert page.locator("#audioInput, #demoRecordButton, #micReady").count() == 0
    page.locator('[data-section="characters"]').click()
    page.locator('[data-demo="1"]').click()
    assert "فصحى" in page.locator("#characterStatus").inner_text()
    assert page.locator("#dialogueText").input_value().startswith("وصلتني رسالة")
    page.locator("#characterSelect").select_option("1")
    page.locator("#dialogueText").fill("يا صاحبي، لن نترك الحقيقة!")
    page.locator("#expressionSelect").select_option("determined")
    page.locator("#dialogueSpeed").evaluate("el => { el.value='1.6'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "true"
    page.wait_for_timeout(380)
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "false"
    page.locator("#timelineSeek").evaluate("el => { el.value='1600'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    assert page.locator("#currentTime").inner_text() != "00:00"
    page.locator("#stopButton").click()
    assert page.locator("#currentTime").inner_text() == "00:00"
    states = page.evaluate("({audioContexts:window.__audioContextConstructed,getUserMediaCalls:window.__getUserMediaCalls,viseme:document.querySelector('#previewCanvas').dataset.activeViseme})")
    assert states["audioContexts"] == 0, states
    assert states["getUserMediaCalls"] == 0, states
    assert page.locator("#previewCanvas").evaluate("e => e.width > 0 && e.height > 0")
    return {"width": width, "height": height, "characters": 3, "state": states}


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
    reports = [exercise(page, width, 844) for width in (320, 360, 390, 412, 480)]
    landscape = exercise(page, 844, 390)
    assert not errors, errors
    (OUT / "text-animation-check-results.json").write_text(json.dumps({"responsive": reports, "landscape": landscape, "pageErrors": errors}, ensure_ascii=False, indent=2))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(HTML.as_uri(), wait_until="load")
    page.screenshot(path=str(OUT / "screenshots/text-character-studio.png"), full_page=True)
    print("L14-C2 text-animation checks passed at 320, 360, 390, 412, 480px and landscape; no AudioContext or microphone capture was created.")
    browser.close()
