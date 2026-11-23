"""Run the standalone artifact from file:// in Chromium and exercise one export."""
from pathlib import Path
from os import environ
import shutil
import tempfile

from playwright.sync_api import sync_playwright


root = Path(__file__).resolve().parents[1]
preview_slug = environ.get("MOTION_STUDIO_PREVIEW_SLUG", "motion-studio-l5-android-preview")
preview = root / "dist" / preview_slug / "index.html"
sample = root / "examples/motion-studio-lab/preview-test.png"
assert preview.is_file() and sample.is_file()
html = preview.read_text()
assert "importmap" not in html and "type=\"module\"" not in html
assert "<style>" in html and "</style>" in html

with tempfile.TemporaryDirectory(prefix="qarton-motion-preview-") as tmp:
    other_image = Path(tmp) / "alternate-photo.png"
    shutil.copyfile(sample, other_image)
    with sync_playwright() as pw:
        executable = environ.get("CHROMIUM_EXECUTABLE_PATH")
        browser = pw.chromium.launch(executable_path=executable) if executable else pw.chromium.launch(channel="chrome")
        page = browser.new_page(accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(preview.as_uri())
        page.wait_for_function("document.querySelector('#stage')?.width === 720")
        support = page.evaluate("""() => ({
          secure: isSecureContext,
          recorder: typeof MediaRecorder === 'function',
          capture: typeof document.querySelector('#stage').captureStream === 'function',
          audio: typeof (window.AudioContext || window.webkitAudioContext) === 'function',
          mp4: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].some(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }),
          webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].some(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } })
        })""")
        assert support["secure"], f"file:// was not a secure context: {support}"
        assert support["recorder"] and support["capture"] and support["audio"], support
        assert support["webm"], f"Chrome test runner lacks the WebM encoder required for the artifact regression: {support}"

        image_input = page.locator("#imageInput")
        image_input.set_input_files(str(sample))
        page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        page.locator("#seek").evaluate("""(el, value) => {
          el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", 4000)
        page.locator("#addKeyframeButton").click()
        assert page.locator(".keyframe-marker").count() == 3
        assert page.locator(".keyframe-marker[aria-pressed=true]").get_attribute("data-key-time") == "4000"
        page.locator("#seek").evaluate("""(el, value) => {
          el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", 6000)
        before_key_edit = page.locator("#stage").evaluate("el => el.toDataURL()")
        page.locator("#keyframeZoom").fill("1.8")
        page.locator("#keyframeZoom").dispatch_event("change")
        page.wait_for_function("document.querySelector('#timelineMessage').textContent.includes('zoom')")
        assert page.locator("#stage").evaluate("el => el.toDataURL()") != before_key_edit

        lane = page.locator("#timelineLane")
        lane_box = lane.bounding_box()
        drag_x = lane_box["x"] + lane_box["width"] * 7000 / 12000
        page.locator('.keyframe-marker[data-key-time="4000"]').dispatch_event("pointerdown", {
            "pointerId": 91, "pointerType": "touch", "isPrimary": True, "button": 0,
            "clientX": lane_box["x"] + lane_box["width"] / 3, "clientY": lane_box["y"] + lane_box["height"] / 2
        })
        lane.dispatch_event("pointermove", {
            "pointerId": 91, "pointerType": "touch", "isPrimary": True, "button": 0,
            "clientX": drag_x, "clientY": lane_box["y"] + lane_box["height"] / 2
        })
        lane.dispatch_event("pointerup", {"pointerId": 91, "pointerType": "touch", "isPrimary": True, "button": 0})
        assert page.locator('.keyframe-marker[data-key-time="7000"]').count() == 1
        page.locator("#deleteKeyframeButton").click()
        assert page.locator(".keyframe-marker").count() == 2

        page.locator("#aspectPreset").select_option("landscape")
        page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        page.locator("#fitMode").select_option("fill")
        page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        assert page.locator("#stage").evaluate("el => el.width / el.height") > 1.7

        if support["webm"]:
            page.locator("#exportFormat").select_option("webm")
            page.locator("#exportDuration").select_option("3000")
            page.locator("#exportQuality").select_option("economy")
            page.locator("#exportAudioEnabled").check()
            page.locator("#exportButton").click()
            page.get_by_text("اكتمل التسجيل. شغّل المعاينة ثم احفظ الملف إذا كانت النتيجة مناسبة.", exact=True).wait_for(timeout=20000)
            page.locator("#exportVideo").wait_for(state="visible")
            page.wait_for_function("document.querySelector('#exportVideo').readyState >= 1", timeout=10000)
            metadata = page.locator("#exportMetadata").inner_text()
            assert "video/webm" in metadata and "MiB" in metadata, metadata
            with page.expect_download() as download_info:
                page.locator("#exportDownload").click()
            downloaded = Path(tmp) / "export.webm"
            download_info.value.save_as(downloaded)
            assert downloaded.is_file() and downloaded.stat().st_size > 0

            page.locator("#exportDuration").select_option("10000")
            page.locator("#exportButton").click()
            page.get_by_text("اكتمل التسجيل. شغّل المعاينة ثم احفظ الملف إذا كانت النتيجة مناسبة.", exact=True).wait_for(timeout=30000)
            assert "10." in page.locator("#exportMetadata").inner_text()

            if support["mp4"]:
                page.locator("#exportFormat").select_option("mp4")
                page.locator("#exportDuration").select_option("3000")
                page.locator("#exportAudioEnabled").uncheck()
                page.locator("#exportButton").click()
                page.wait_for_function("document.querySelector('#exportVideo').hidden === false || document.querySelector('#tryWebmButton').hidden === false", timeout=15000)
                if page.locator("#tryWebmButton").is_visible():
                    page.locator("#tryWebmButton").click()
                    assert page.locator("#exportFormat").input_value() == "webm"
                    page.locator("#exportButton").click()
                    page.get_by_text("اكتمل التسجيل. شغّل المعاينة ثم احفظ الملف إذا كانت النتيجة مناسبة.", exact=True).wait_for(timeout=20000)

            page.locator("#exportDuration").select_option("10000")
            page.locator("#exportAudioEnabled").uncheck()
            page.locator("#exportButton").click()
            page.locator("#cancelExportButton").click()
            page.get_by_text("أُلغي التسجيل ونُظّفت موارده.", exact=True).wait_for(timeout=5000)
            page.locator("#exportDuration").select_option("3000")
            page.locator("#exportButton").click()
            page.get_by_text("اكتمل التسجيل. شغّل المعاينة ثم احفظ الملف إذا كانت النتيجة مناسبة.", exact=True).wait_for(timeout=20000)
            image_input.set_input_files(str(other_image))
            page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
            assert page.locator("#exportVideo").is_hidden()
            assert "alternate-photo.png" in page.locator("#imageName").inner_text()
        assert not errors, errors
        browser.close()
