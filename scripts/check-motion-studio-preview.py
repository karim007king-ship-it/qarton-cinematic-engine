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
        page.evaluate("""() => {
          window.lastAudioPointerId = null;
          document.querySelector('#audioTracks').addEventListener('pointerdown', event => {
            window.lastAudioPointerId = event.pointerId;
          }, {capture: true});
        }""")
        audio_clip_box = audio_clip.bounding_box()
        original_clip = audio_clip.element_handle()
        start_x = audio_clip_box["x"] + audio_clip_box["width"] / 2
        start_y = audio_clip_box["y"] + audio_clip_box["height"] / 2
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.wait_for_function("""() => {
          const root = document.querySelector('#audioTracks');
          return root.dataset.dragging === 'true' &&
            root.hasPointerCapture(window.lastAudioPointerId);
        }""")
        page.mouse.move(start_x + audio_box["width"] * 0.07, start_y, steps=4)
        assert original_clip.evaluate("el => !el.isConnected"), "drag redraw replaces the clip node while the stable root retains pointer capture"
        page.wait_for_function("""() => {
          const root = document.querySelector('#audioTracks');
          const clip = root.querySelector('.audio-clip');
          return root.hasPointerCapture(window.lastAudioPointerId) &&
            clip?.getAttribute('aria-pressed') === 'true' && document.activeElement === clip;
        }""", timeout=3000)
        page.mouse.up()
        assert "00:01.34" in page.locator(".audio-clip").get_attribute("aria-label"), "real Chromium drag moves the clip after clip-node replacement"

        # Exercise pointercancel in the real browser document after a trusted pointerdown.
        clip_box = page.locator(".audio-clip").bounding_box()
        page.mouse.move(clip_box["x"] + clip_box["width"] / 2, clip_box["y"] + clip_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#audioTracks').dataset.dragging === 'true'")
        page.evaluate("""() => {
          const root = document.querySelector('#audioTracks');
          root.dispatchEvent(new PointerEvent('pointercancel', {
            bubbles: true, pointerId: window.lastAudioPointerId, pointerType: 'mouse', isPrimary: true
          }));
        }""")
        assert not page.locator("#audioTracks").get_attribute("data-dragging")
        assert "أُلغي السحب" in page.locator("#audioTimelineMessage").inner_text()
        page.mouse.up()

        # A real releasePointerCapture emits lostpointercapture and terminates the drag.
        clip_box = page.locator(".audio-clip").bounding_box()
        page.mouse.move(clip_box["x"] + clip_box["width"] / 2, clip_box["y"] + clip_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#audioTracks').hasPointerCapture(window.lastAudioPointerId)")
        page.evaluate("""() => document.querySelector('#audioTracks').releasePointerCapture(window.lastAudioPointerId)""")
        page.mouse.move(clip_box["x"] + clip_box["width"] / 2 + 1, clip_box["y"] + clip_box["height"] / 2)
        page.wait_for_function("!document.querySelector('#audioTracks').dataset.dragging")
        assert "أُلغي السحب" in page.locator("#audioTimelineMessage").inner_text()
        page.mouse.up()

        # Locking export during a drag releases capture and rejects trailing movement.
        clip_box = page.locator(".audio-clip").bounding_box()
        audio_lane = page.locator("#audioTracks .audio-track-lane[data-track-id='audio-dialogue']")
        audio_box = audio_lane.bounding_box()
        drag_start = page.locator(".audio-clip").get_attribute("aria-label")
        page.mouse.move(clip_box["x"] + clip_box["width"] / 2, clip_box["y"] + clip_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#audioTracks').dataset.dragging === 'true'")
        page.locator("#exportButton").evaluate("el => el.click()")
        page.wait_for_function("document.querySelector('#exportButton').disabled")
        assert not page.locator("#audioTracks").get_attribute("data-dragging")
        assert page.locator(".audio-clip").is_disabled()
        page.mouse.move(audio_box["x"] + audio_box["width"] * 0.8, audio_box["y"] + audio_box["height"] / 2)
        assert page.locator(".audio-clip").get_attribute("aria-label") == drag_start, "export lock ignores trailing pointer motion"
        page.mouse.up()
        page.locator("#cancelExportButton").click()
        page.get_by_text("أُلغي التسجيل ونُظّفت موارده.", exact=True).wait_for(timeout=10000)
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
        page.evaluate("""() => {
          window.lastCameraPointerId = null;
          document.querySelector('#timelineLane').addEventListener('pointerdown', event => {
            window.lastCameraPointerId = event.pointerId;
          }, {capture: true});
        }""")
        key_box = page.locator('.keyframe-marker[data-key-time="4000"]').bounding_box()
        page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#timelineLane').hasPointerCapture(window.lastCameraPointerId)")
        page.mouse.move(drag_x, lane_box["y"] + lane_box["height"] / 2, steps=8)
        page.mouse.up()
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
            key_box = page.locator(f'.keyframe-marker[data-key-time="{source_ms}"]').bounding_box()
            page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
            page.mouse.down()
            page.wait_for_function("document.querySelector('#timelineLane').hasPointerCapture(window.lastCameraPointerId)")
            if source_ms != target_ms:
                target_x = box["x"] + box["width"] * target_ms / 12000
                page.mouse.move(target_x, box["y"] + box["height"] / 2, steps=6)
                if repeat:
                    page.mouse.move(target_x, box["y"] + box["height"] / 2)
            if end_event:
                if end_event == "pointerup":
                    page.mouse.up()
                elif end_event == "pointercancel":
                    page.evaluate("""() => document.querySelector('#timelineLane').dispatchEvent(new PointerEvent('pointercancel', {
                      bubbles: true, pointerId: window.lastCameraPointerId, pointerType: 'mouse', isPrimary: true
                    }))""")
                    page.mouse.up()
                elif end_event == "lostpointercapture":
                    page.evaluate("""() => document.querySelector('#timelineLane').releasePointerCapture(window.lastCameraPointerId)""")
                    page.mouse.move(box["x"] + box["width"] * target_ms / 12000 + 1,
                                    box["y"] + box["height"] / 2)
                    page.wait_for_function("!document.querySelector('#timelineLane').hasPointerCapture(window.lastCameraPointerId)")
                    page.mouse.up()

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
        page.locator("#exportButton").evaluate("el => el.click()")
        page.wait_for_function("document.querySelector('#exportButton').disabled")
        assert not page.locator("#timelineLane").get_attribute("data-dragging"), "export lock cancels the active drag state"
        page.mouse.move(lane.bounding_box()["x"] + lane.bounding_box()["width"] * 9000 / 12000,
                        lane.bounding_box()["y"] + 20)
        assert page.locator('.keyframe-marker[data-key-time="8000"]').count() == 1, "export lock rejects trailing pointer moves"
        page.mouse.up()
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
