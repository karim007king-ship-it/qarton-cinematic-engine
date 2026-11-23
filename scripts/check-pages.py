"""Exercise the staged Pages site in desktop and touch Chromium contexts."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from os import environ
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


def exercise(context, url):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: errors.append(f"{response.status} {response.url}")
            if response.status >= 400 else None)
    page.goto(url)
    page.get_by_role("link", name="افتح تجربة المحرك").click()
    page.wait_for_selector(".qarton-character img")
    for control, scene in [("scene-two", "dusk"), ("scene-one", "dawn")]:
        page.locator(f"#{control}").click()
        page.get_by_text(f"Scene {scene} active", exact=False).wait_for()

    page.locator("#audio").click()
    page.get_by_text("Audio cues started", exact=False).wait_for()
    page.wait_for_function("""() => {
        const characters = [...document.querySelectorAll('.qarton-character')];
        const stage = document.querySelector('#stage').getBoundingClientRect();
        return characters.length === 2 && characters.every(character => {
            const rect = character.getBoundingClientRect();
            return character.dataset.state === 'idle'
                && ['determined', 'alert'].includes(character.dataset.expression)
                && rect.left >= stage.left && rect.right <= stage.right
                && rect.top >= stage.top && rect.bottom <= stage.bottom
                && character.firstChild.naturalWidth > 0;
        });
    }""")
    page.locator("#destroy").click()
    page.get_by_text("Destroyed: animation loop", exact=False).wait_for()
    assert page.locator(".qarton-character, .qarton-scene").count() == 0
    page.goto(url)
    page.get_by_role("link", name="جرّب مشهد المرصد").click()
    for attempt in range(2):
        if attempt:
            page.locator("#play").click()
        page.get_by_text("المشهد جاهز", exact=True).wait_for()
        page.wait_for_selector('[data-expression="greeting"][data-state="idle"]')
        assert page.locator(".qarton-layer img").count() == 2
        assert page.locator("#stage img").evaluate_all(
            "(images) => images.every(image => image.complete && image.naturalWidth > 0)")
        assert page.locator(".camera").evaluate("(el) => el.style.transform.includes('scale(')")
        assert page.locator('[data-layer-id="ridge"]').evaluate("(el) => !!el.style.transform")
        assert page.locator(".qarton-character").evaluate("""el => {
            const r = el.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
            return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom;
        }""")
    page.locator("#stop").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert page.locator("#stage img").count() == 0
    page.goto(url)
    page.get_by_role("link", name="مختبر حركة الشخصيات").click()
    actor = page.locator(".qarton-character")
    seek = page.locator("#seek")
    def sample(ms, filename, label):
        seek.evaluate("""(slider, value) => {
            slider.value = value;
            slider.dispatchEvent(new Event('input', {bubbles: true}));
        }""", ms)
        page.wait_for_function("""file => {
            const img = document.querySelector('.qarton-character img');
            return img?.src.endsWith('/' + file) && img.complete && img.naturalWidth > 0;
        }""", arg=filename)
        assert page.locator("#status").inner_text() == label

    page.wait_for_function("!document.querySelector('#seek').disabled")
    sample(1250, "walk-1.svg", "مشي")
    sample(1900, "walk-1-blink.svg", "مشي")
    sample(3400, "gesture-1.svg", "تحيّة")
    pose = page.locator("#camera").get_attribute("style")
    sample(1250, "walk-1.svg", "مشي")
    assert page.locator("#camera").get_attribute("style") != pose
    page.locator("#toggle").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 1350")
    page.locator("#toggle").click()
    page.get_by_role("button", name="تشغيل", exact=True).wait_for()
    paused = seek.input_value()
    page.wait_for_timeout(120)
    assert seek.input_value() == paused
    page.locator("#switch").click()
    page.wait_for_selector('#stage[data-scene="evening"] .qarton-character')
    assert actor.count() == 1 and seek.input_value() == "0"
    page.locator("#close").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert actor.count() == 0
    page.emulate_media(reduced_motion="reduce")
    page.reload()
    page.wait_for_function("!document.querySelector('#seek').disabled")
    sample(1900, "walk-0.svg", "مشي")
    assert not page.evaluate("""performance.getEntriesByType('resource')
        .some(entry => entry.name.includes('-blink.svg'))""")
    page.emulate_media(reduced_motion="no-preference")
    page.add_init_script("""window.labTones = 0;
        window.labContexts = [];
        window.AudioContext = class extends AudioContext {
            constructor(...args) { super(...args); window.labContexts.push(this); }
        };
        const start = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function(...args) {
            window.labTones++;
            return start.apply(this, args);
        };""")
    page.goto(url)
    page.get_by_role("link", name="إشارة من المرصد").click()
    page.wait_for_function("!document.querySelector('#play').disabled")
    def move_to(ms):
        page.locator("#seek").evaluate("""(el, t) => {
            el.value = t; el.dispatchEvent(new Event('input', {bubbles:true}));
        }""", ms)
        page.wait_for_function("t => +document.querySelector('.camera').dataset.time === t", arg=ms)

    move_to(1900)
    assert page.locator(".cast img").get_attribute("src").endswith("walk-1-blink.svg")
    assert page.locator(".qarton-layer img").count() == 2
    camera = page.locator(".camera").evaluate("e => e.style.transform")
    ridge = page.locator('[data-layer-id="ridge"]').evaluate("e => e.style.transform")
    move_to(800)
    assert page.locator(".camera").evaluate("e => e.style.transform") != camera
    assert page.locator('[data-layer-id="ridge"]').evaluate("e => e.style.transform") != ridge
    assert page.evaluate("labTones") == 0
    page.locator("#play").click()
    page.wait_for_function("labTones === 1")
    page.locator("#pause").click()
    page.get_by_role("button", name="استئناف").wait_for()
    frozen = page.locator(".camera").get_attribute("data-time")
    page.wait_for_timeout(150)
    assert page.locator(".camera").get_attribute("data-time") == frozen
    move_to(3400)
    assert "تحيّة" in page.locator("#status").inner_text()
    assert page.evaluate("labTones") == 1
    page.locator("#replay").click()
    page.wait_for_function("+document.querySelector('.camera').dataset.time < 500")
    page.locator("#switch").click()
    page.get_by_text("ضوء القمر · وقوف", exact=True).wait_for()
    assert page.locator(".camera").count() == 1
    assert page.locator(".camera").get_attribute("data-time") == "0"
    assert page.locator(".cast img").count() == 1
    page.wait_for_function("labContexts.length === 1 && labContexts[0].state === 'closed'")
    page.locator("#play").click()
    page.wait_for_function("labContexts.length === 2 && labContexts[1].state === 'running'")
    page.locator("#close").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert page.locator("#stage img").count() == 0
    assert page.evaluate("labContexts.every(context => context.state === 'closed')")
    page.emulate_media(reduced_motion="reduce")
    page.reload()
    page.wait_for_function("!document.querySelector('#play').disabled")
    camera = page.locator(".camera").evaluate("e => e.style.transform")
    move_to(1900)
    assert page.locator(".camera").evaluate("e => e.style.transform") == camera
    assert page.locator(".cast img").get_attribute("src").endswith("walk-0.svg")

    page.add_init_script("""(() => {
        const nativeCreateImageBitmap = window.createImageBitmap.bind(window);
        window.createImageBitmap = async (source, ...options) => {
            if (source?.name === 'preview-test-slow.png')
                await new Promise(resolve => setTimeout(resolve, 700));
            return nativeCreateImageBitmap(source, ...options);
        };
    })();""")
    page.goto(url + "examples/motion-studio-lab/")
    image_input = page.locator("#imageInput")
    image_input.set_input_files({
        "name": "preview-test-slow.png", "mimeType": "image/png",
        "buffer": (site / "examples/motion-studio-lab/preview-test.png").read_bytes()
    })
    image_input.set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert "preview-test.png" in page.locator("#imageName").inner_text()
    page.wait_for_timeout(760)
    assert "preview-test.png" in page.locator("#imageName").inner_text()
    preview = page.locator("#stage")
    studio_seek = page.locator("#seek")
    def set_studio_time(ms):
        studio_seek.evaluate("""(el, value) => {
            el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", ms)
    set_studio_time(6000)
    at_middle = preview.evaluate("el => el.toDataURL()")
    set_studio_time(0)
    set_studio_time(6000)
    assert preview.evaluate("el => el.toDataURL()") == at_middle
    page.locator("#playPauseButton").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 6200")
    page.locator("#playPauseButton").click()
    paused_value = studio_seek.input_value()
    page.wait_for_timeout(140)
    assert studio_seek.input_value() == paused_value
    page.locator("#replayButton").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 0")
    page.wait_for_function("Number(document.querySelector('#seek').value) < 1000")
    with page.expect_download() as download_info:
        page.locator("#saveProjectButton").click()
    project_download = download_info.value
    project_path = Path("/tmp/qarton-motion-studio-check.json")
    project_download.save_as(project_path)
    project_json = project_path.read_text()
    assert "qarton-motion-studio-project" in project_json
    assert "preview-test.png" in project_json
    assert "<svg" not in project_json
    project_data = json.loads(project_json)
    project_data["project"]["layers"][0]["assetId"] = "imported-portrait-42"
    project_path.write_text(json.dumps(project_data))
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(project_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    assert "أعد اختيار الصورة" in page.locator("#imageName").inner_text()
    page.locator("#imageInput").set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    with page.expect_download() as rebound_download_info:
        page.locator("#saveProjectButton").click()
    rebound_path = Path("/tmp/qarton-motion-studio-rebound.json")
    rebound_download_info.value.save_as(rebound_path)
    rebound_data = json.loads(rebound_path.read_text())
    assert rebound_data["project"]["layers"][0]["assetId"] == "imported-portrait-42"

    image_input.set_input_files({
        "name": "preview-test-slow.png", "mimeType": "image/png",
        "buffer": (site / "examples/motion-studio-lab/preview-test.png").read_bytes()
    })
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(project_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    relink_label = page.locator("#imageName").inner_text()
    relink_frame = preview.evaluate("el => el.toDataURL()")
    page.wait_for_timeout(760)
    assert page.locator("#imageName").inner_text() == relink_label
    assert preview.evaluate("el => el.toDataURL()") == relink_frame
    assert not errors, errors


if __name__ == "__main__":
    site = Path("_site").resolve()
    assert (site / "index.html").is_file()
    handler = partial(SimpleHTTPRequestHandler, directory=site.parent)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as pw:
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/{site.name}/"
        executable = environ.get("CHROMIUM_EXECUTABLE_PATH")
        browser = pw.chromium.launch(executable_path=executable) if executable else pw.chromium.launch(channel="chrome")
        for device in [None, "Pixel 7"]:
            with browser.new_context(**(pw.devices[device] if device else {})) as context:
                exercise(context, url)
                print(f"{device or 'Desktop'} passed", flush=True)
        browser.close()
        server.shutdown()
