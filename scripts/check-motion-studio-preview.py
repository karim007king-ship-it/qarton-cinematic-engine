"""Run the standalone artifact from file:// in Chromium and exercise one export."""
from pathlib import Path
from os import environ
import shutil
import tempfile
import math
import struct
import wave

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
    audio_sample = Path(tmp) / "dialogue.wav"
    with wave.open(str(audio_sample), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"".join(struct.pack("<h", int(900 * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050 * 2)))
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
        page.locator("#audioInput").set_input_files(str(audio_sample))
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
        page.locator("#audioTrackType").select_option("dialogue")
        page.locator("#addAudioClip").click()
        assert page.locator(".audio-clip").count() == 1
        page.locator("#audioClipStart").fill("500")
        page.locator("#audioClipStart").dispatch_event("change")
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 800)
        page.locator("#visemeType").select_option("wide")
        page.locator("#phonemeLabel").fill("مَ")
        page.locator("#addViseme").click()
        assert page.locator(".viseme-marker").count() == 1
        assert "dialogue.wav" in page.locator("#audioSelection").inner_text()
        page.locator("#audioMasterVolume").evaluate("el => { el.value = '0.7'; el.dispatchEvent(new Event('input', {bubbles: true})); }")
        audio_lane = page.locator("#audioTracks .audio-track-lane[data-track-id='audio-dialogue']")
        audio_box = audio_lane.bounding_box()
        audio_clip = page.locator(".audio-clip")
        audio_clip.dispatch_event("pointerdown", {"pointerId": 170, "pointerType": "touch", "isPrimary": True, "button": 0,
            "clientX": audio_box["x"] + audio_box["width"] * 0.05, "clientY": audio_box["y"] + audio_box["height"] / 2})
        audio_lane.dispatch_event("pointermove", {"pointerId": 170, "pointerType": "touch", "isPrimary": True, "button": 0,
            "clientX": audio_box["x"] + audio_box["width"] * 0.12, "clientY": audio_box["y"] + audio_box["height"] / 2})
        audio_lane.dispatch_event("pointercancel", {"pointerId": 170, "pointerType": "touch", "isPrimary": True, "button": 0})
        assert "00:01.34" in page.locator(".audio-clip").get_attribute("aria-label"), "cancelled audio drag keeps its last valid timing"
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 0)
        page.locator("#playPauseButton").click()
        page.wait_for_function("Number(document.querySelector('#seek').value) > 100", timeout=3000)
        page.locator("#playPauseButton").click()
        assert page.locator("#playPauseButton").inner_text() == "متابعة"
        with page.expect_download() as project_download:
            page.locator("#saveProjectButton").click()
        project_path = Path(tmp) / "audio-project.json"
        project_download.value.save_as(project_path)
        saved_project = __import__("json").loads(project_path.read_text())
        assert saved_project["audioTracks"][0]["clips"][0]["asset"] == saved_project["audioAssets"][0]["id"]
        assert "data:audio" not in project_path.read_text()
        page.locator("#projectInput").set_input_files(str(project_path))
        page.wait_for_function("document.querySelector('#status').textContent.includes('فُتح المشروع')")
        assert page.locator(".audio-clip").count() == 1
        page.locator("#audioInput").set_input_files(str(audio_sample))
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
        assert not page.locator("#addAudioClip").is_disabled(), "relinked local audio keeps the saved asset id"
        image_input.set_input_files(str(sample))
        page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 0)
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

        page.locator("#seek").evaluate("""(el, value) => {
          el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", 4000)
        page.locator("#addKeyframeButton").click()
        lane = page.locator("#timelineLane")
        def drag_key(source_ms, target_ms, pointer_id, end_event=None, repeat=False):
            box = lane.bounding_box()
            page.locator(f'.keyframe-marker[data-key-time="{source_ms}"]').dispatch_event("pointerdown", {
                "pointerId": pointer_id, "pointerType": "touch", "isPrimary": True, "button": 0,
                "clientX": box["x"] + box["width"] * source_ms / 12000,
                "clientY": box["y"] + box["height"] / 2
            })
            if source_ms != target_ms:
                move_event = {
                    "pointerId": pointer_id, "pointerType": "touch", "isPrimary": True, "button": 0,
                    "clientX": box["x"] + box["width"] * target_ms / 12000,
                    "clientY": box["y"] + box["height"] / 2
                }
                lane.dispatch_event("pointermove", move_event)
                if repeat:
                    lane.dispatch_event("pointermove", move_event)
            if end_event:
                lane.dispatch_event(end_event, {"pointerId": pointer_id, "pointerType": "touch", "isPrimary": True, "button": 0})

        drag_key(4000, 5000, 92, "pointercancel")
        assert page.locator('.keyframe-marker[data-key-time="5000"]').count() == 1
        assert not page.locator("#timelineLane").get_attribute("data-dragging")
        lane.dispatch_event("pointermove", {"pointerId": 92, "pointerType": "touch", "isPrimary": True, "button": 0, "clientX": lane.bounding_box()["x"] + lane.bounding_box()["width"] * 9000 / 12000, "clientY": lane.bounding_box()["y"] + 20})
        assert page.locator('.keyframe-marker[data-key-time="5000"]').count() == 1, "pointercancel leaves no stale drag"

        drag_key(5000, 6000, 93, "lostpointercapture")
        assert page.locator('.keyframe-marker[data-key-time="6000"]').count() == 1
        assert not page.locator("#timelineLane").get_attribute("data-dragging")
        drag_key(6000, 12000, 94, "pointerup")
        assert page.locator('.keyframe-marker[data-key-time="6000"]').count() == 1, "colliding target leaves source key intact"
        drag_key(6000, 7000, 95, "pointerup", repeat=True)
        assert [int(value) for value in page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")] == [0, 7000, 12000]
        assert page.locator('.keyframe-marker[data-key-time="7000"]').evaluate("el => document.activeElement === el"), "selection focus survives marker rerender"

        page.locator("#exportDuration").select_option("3000")
        page.locator("#exportQuality").select_option("economy")
        drag_key(7000, 8000, 96)
        assert page.locator("#timelineLane").get_attribute("data-dragging") == "true"
        page.locator("#exportButton").click()
        page.wait_for_function("document.querySelector('#exportButton').disabled")
        assert not page.locator("#timelineLane").get_attribute("data-dragging"), "export lock cancels the active drag state"
        lane.dispatch_event("pointermove", {"pointerId": 96, "pointerType": "touch", "isPrimary": True, "button": 0, "clientX": lane.bounding_box()["x"] + lane.bounding_box()["width"] * 9000 / 12000, "clientY": lane.bounding_box()["y"] + 20})
        assert page.locator('.keyframe-marker[data-key-time="8000"]').count() == 1, "export lock rejects trailing pointer moves"
        page.locator("#cancelExportButton").click()
        page.get_by_text("أُلغي التسجيل ونُظّفت موارده.", exact=True).wait_for(timeout=10000)

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
