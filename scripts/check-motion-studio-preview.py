"""Run the standalone artifact from file:// in Chromium and exercise one export."""
from pathlib import Path
from os import environ
import shutil
import subprocess
import tempfile
import math
import re
import struct
import wave
import zlib

from playwright.sync_api import sync_playwright


def measure_media_timeline(entries, timestamp_fields, duration_fields):
    """Measure a stream timeline from frame/packet timestamps, with final-unit fallback."""
    samples = []
    for entry in entries:
        timestamp = None
        for field in timestamp_fields:
            try:
                candidate = float(entry[field])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(candidate):
                timestamp = candidate
                break
        if timestamp is None:
            continue
        duration = None
        for field in duration_fields:
            try:
                candidate = float(entry[field])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(candidate) and candidate > 0:
                duration = candidate
                break
        samples.append((timestamp, duration))

    assert samples, f"ffprobe returned no usable timestamps for {timestamp_fields}"
    timestamps = sorted({timestamp for timestamp, _ in samples})
    intervals = [right - left for left, right in zip(timestamps, timestamps[1:]) if right > left]
    if intervals:
        ordered = sorted(intervals)
        middle = len(ordered) // 2
        final_unit = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    else:
        final_unit = None

    start = timestamps[0]
    end_candidates = [timestamp + duration for timestamp, duration in samples if duration is not None]
    end = max(end_candidates, default=timestamps[-1])
    if final_unit is not None:
        end = max(end, timestamps[-1] + final_unit)
    assert end > start, f"ffprobe timestamps do not establish a positive timeline for {timestamp_fields}"
    return {"start": start, "end": end, "duration": end - start}


def write_solid_png(path, rgb, width=256, height=256):
    """Create a small lossless color card so sequence cuts can be checked in encoded frames."""
    def chunk(kind, data):
        payload = kind + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xffffffff)
    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


# Regression coverage for streams without container or packet-duration metadata.
assert abs(measure_media_timeline(
    [{"best_effort_timestamp_time": value} for value in ("0", "1", "2")],
    ("best_effort_timestamp_time",), ("pkt_duration_time", "duration_time")
)["duration"] - 3.0) < 1e-9
assert abs(measure_media_timeline(
    [{"pts_time": str(value / 2), "duration_time": "0.5"} for value in range(6)],
    ("pts_time", "dts_time"), ("duration_time",)
)["duration"] - 3.0) < 1e-9


root = Path(__file__).resolve().parents[1]
preview_slug = environ.get("MOTION_STUDIO_PREVIEW_SLUG", "motion-studio-l5-android-preview")
preview = root / "dist" / preview_slug / "index.html"
sample = root / "examples/motion-studio-lab/preview-test.png"
screenshot_dir = root / "artifacts/motion-studio-l11f2"
screenshot_dir.mkdir(parents=True, exist_ok=True)
assert preview.is_file() and sample.is_file()
html = preview.read_text()
assert not re.search(r"<script\b[^>]*\btype=[\"']importmap[\"']", html, re.IGNORECASE)
assert not re.search(r"<script\b[^>]*\btype=[\"']module[\"']", html, re.IGNORECASE)
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
    sync_audio_sample = Path(tmp) / "av-sync.wav"
    sync_marks = [0.25, 1.0, 2.0]
    with wave.open(str(sync_audio_sample), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48000)
        samples = []
        for index in range(48000 * 3):
            at = index / 48000
            pulse = next((start for start in sync_marks if start <= at < start + 0.08), None)
            if pulse is None:
                sample_value = 0
            else:
                edge = min(at - pulse, pulse + 0.08 - at)
                envelope = min(1.0, max(0.0, edge / 0.004))
                sample_value = int(10000 * envelope * math.sin(2 * math.pi * 440 * at))
            samples.append(struct.pack("<h", sample_value))
        wav.writeframes(b"".join(samples))
    sequence_cards = [Path(tmp) / f"sequence-{name}.png" for name in ("red", "green", "blue")]
    for path, color in zip(sequence_cards, ((240, 20, 20), (20, 230, 20), (20, 30, 240))):
        write_solid_png(path, color)
    sequence_audio = [Path(tmp) / f"sequence-{name}.wav" for name in ("red", "green", "blue")]
    for path, duration, frequency in zip(sequence_audio, (3, 4, 3), (440, 660, 880)):
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(48000)
            wav.writeframes(b"".join(
                struct.pack("<h", int(10000 * math.sin(2 * math.pi * frequency * i / 48000)))
                for i in range(48000 * duration)
            ))
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
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1"), "desktop editor shell must not require page scrolling"
        page.screenshot(path=str(screenshot_dir / "motion-studio-desktop.png"))
        page.locator('nav.bottom-dock [data-editor-section="effects"]').click()
        page.locator("#visualEffectType").select_option("fade")
        page.locator("#addVisualEffect").click()
        assert page.locator(".visual-effect-clip").count() == 1
        page.locator("#visualEffectStart").fill("500")
        page.locator("#visualEffectStart").dispatch_event("change")
        page.locator("#visualEffectDuration").fill("1500")
        page.locator("#visualEffectDuration").dispatch_event("change")
        page.locator("#visualEffectEasing").select_option("linear")
        from_opacity = page.locator('#visualEffectFrom [data-effect-field="opacity"]')
        from_opacity.fill("")
        from_opacity.dispatch_event("change")
        assert from_opacity.get_attribute("aria-invalid") == "true", "empty numeric fields are rejected instead of converted to zero"
        assert from_opacity.evaluate("el => el.isConnected && document.activeElement === el"), "invalid From value keeps its input and focus"
        from_opacity.fill("0.2")
        from_opacity.dispatch_event("change")
        assert from_opacity.get_attribute("aria-invalid") is None
        assert from_opacity.evaluate("el => el.isConnected && document.activeElement === el"), "From edits retain keyboard focus without replacing the input"
        assert page.locator(".visual-effect-clip").get_attribute("aria-label").startswith("Fade، يبدأ 00:00.50")

        # Exercise trusted visual-effect drag cancellation and release in Chromium.
        effect_root = page.locator("#visualEffectsTracks")
        effect_lane = page.locator("#visualEffectsTracks .visual-effect-lane[data-effect-type='fade']")
        effect_clip = page.locator(".visual-effect-clip")
        effect_clip.scroll_into_view_if_needed()
        original_effect_label = effect_clip.get_attribute("aria-label")
        page.evaluate("""() => {
          window.lastEffectPointerId = null;
          document.querySelector('#visualEffectsTracks').addEventListener('pointerdown', event => {
            window.lastEffectPointerId = event.pointerId;
          }, {capture: true});
        }""")
        effect_box = effect_clip.bounding_box()
        lane_box = effect_lane.bounding_box()
        start_x = effect_box["x"] + effect_box["width"] / 2
        start_y = effect_box["y"] + effect_box["height"] / 2
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        drag_state = page.evaluate("""({x, y}) => {
          const root = document.querySelector('#visualEffectsTracks');
          const clip = document.querySelector('.visual-effect-clip');
          const rect = element => element?.getBoundingClientRect().toJSON() || null;
          const hit = document.elementFromPoint(x, y);
          const panel = document.querySelector('[data-tool-panel="effects"]');
          const card = document.querySelector('#effectsToolsSection');
          return {dragging: root.dataset.dragging === 'true', capture: root.hasPointerCapture(window.lastEffectPointerId),
            focused: document.activeElement?.classList.contains('visual-effect-clip'), pointerId: window.lastEffectPointerId,
            activeClass: document.activeElement?.className || '', hitClass: hit?.className || '', hitIsClip: hit === clip,
            disabled: clip?.disabled, pointerEvents: clip && getComputedStyle(clip).pointerEvents, point: {x, y},
            clip: rect(clip), stage: rect(document.querySelector('.stage-wrap')),
            panel: rect(panel), drawer: rect(document.querySelector('.tool-drawer')),
            preview: rect(document.querySelector('.studio-preview')), studio: rect(document.querySelector('.studio')),
            rootParent: root.parentElement?.id, card: rect(card), cardParent: card.parentElement?.dataset.toolPanel || card.parentElement?.className,
            panelContainsRoot: panel.contains(root)};
        }""", {"x": start_x, "y": start_y})
        assert drag_state["dragging"], f"effect clip pointerdown must begin a drag: {drag_state}"
        assert drag_state["capture"], f"effect drag must retain pointer capture: {drag_state}"
        assert drag_state["focused"], f"effect drag must preserve clip focus: {drag_state}"
        page.mouse.move(start_x + lane_box["width"] * 0.04, start_y, steps=3)
        page.keyboard.press("Escape")
        assert page.locator(".visual-effect-clip").get_attribute("aria-label") == original_effect_label, "Escape restores the committed start time"
        assert not effect_root.get_attribute("data-dragging")
        page.mouse.up()

        effect_box = page.locator(".visual-effect-clip").bounding_box()
        page.mouse.move(effect_box["x"] + effect_box["width"] / 2, effect_box["y"] + effect_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#visualEffectsTracks').dataset.dragging === 'true'")
        page.evaluate("""() => document.querySelector('#visualEffectsTracks').dispatchEvent(new PointerEvent('pointercancel', {
          bubbles: true, pointerId: window.lastEffectPointerId, pointerType: 'mouse', isPrimary: true
        }))""")
        assert page.locator(".visual-effect-clip").get_attribute("aria-label") == original_effect_label, "pointercancel restores the committed start time"
        page.mouse.up()

        effect_box = page.locator(".visual-effect-clip").bounding_box()
        page.mouse.move(effect_box["x"] + effect_box["width"] / 2, effect_box["y"] + effect_box["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#visualEffectsTracks').hasPointerCapture(window.lastEffectPointerId)")
        page.evaluate("""() => document.querySelector('#visualEffectsTracks').dispatchEvent(new PointerEvent('lostpointercapture', {
          bubbles: true, pointerId: window.lastEffectPointerId, pointerType: 'mouse', isPrimary: true
        }))""")
        assert page.locator(".visual-effect-clip").get_attribute("aria-label") == original_effect_label, "lost capture restores the committed start time"
        page.mouse.up()

        effect_box = page.locator(".visual-effect-clip").bounding_box()
        page.mouse.move(effect_box["x"] + effect_box["width"] / 2, effect_box["y"] + effect_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(effect_box["x"] + effect_box["width"] / 2 + lane_box["width"] * 0.04, effect_box["y"] + effect_box["height"] / 2, steps=4)
        page.mouse.up()
        assert page.locator(".visual-effect-clip").get_attribute("aria-label") != original_effect_label, "successful drag commits its new start time"
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 4000)
        effect_head = page.locator("#visualEffectsTracks .visual-effect-playhead").first
        assert abs(float(effect_head.evaluate("el => parseFloat(el.style.left)")) - 100 / 3) < 0.01
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 2400)
        frame_at_time = page.locator("#stage").evaluate("el => el.toDataURL()")
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 8000)
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 2400)
        assert page.locator("#stage").evaluate("el => el.toDataURL()") == frame_at_time, "same scene timestamp renders identical effects after seek"
        page.locator("#replayButton").click()
        page.wait_for_function("Number(document.querySelector('#seek').value) > 100", timeout=3000)
        page.locator("#playPauseButton").click()
        assert page.locator("#playPauseButton").inner_text() == "متابعة"
        assert page.locator(".visual-effect-clip").count() == 1, "Replay preserves the latest edited scene timeline"
        page.locator(".visual-effect-clip").click()
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        page.locator(".advanced-audio-drawer > summary").click()
        page.locator("#audioInput").set_input_files(str(audio_sample))
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
        page.locator("#audioTrackType").select_option("dialogue")
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 0)
        page.locator("#addAudioClip").click()
        assert page.locator(".audio-clip").count() == 1, page.locator("#audioTimelineMessage").inner_text()
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
        audio_clip.scroll_into_view_if_needed()
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
        try:
            page.wait_for_function("""() => {
              const root = document.querySelector('#audioTracks');
              const clip = root.querySelector('.audio-clip');
              return root.hasPointerCapture(window.lastAudioPointerId) &&
                clip?.getAttribute('aria-pressed') === 'true' && document.activeElement === clip;
            }""", timeout=3000)
        except Exception as error:
            state = page.evaluate("""() => {
              const root = document.querySelector('#audioTracks'); const clip = root.querySelector('.audio-clip');
              return { dragging: root.dataset.dragging, pointerCaptured: root.hasPointerCapture(window.lastAudioPointerId),
                selected: clip?.getAttribute('aria-pressed'), focusedTag: document.activeElement?.tagName,
                focusedId: document.activeElement?.id, focusedClass: document.activeElement?.className,
                focusedClipId: document.activeElement?.dataset?.clipId };
            }""")
            raise AssertionError(f"audio clip must retain pointer capture, selection, and focus during drag: {state}") from error
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
        page.evaluate("""() => document.querySelector('#audioTracks').dispatchEvent(new PointerEvent('lostpointercapture', {
          bubbles: true, pointerId: window.lastAudioPointerId, pointerType: 'mouse', isPrimary: true
        }))""")
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
        assert page.locator("#addVisualEffect").is_disabled() and page.locator("#deleteVisualEffect").is_disabled()
        assert page.locator("#visualEffectStart").is_disabled() and page.locator('#visualEffectFrom [data-effect-field="opacity"]').is_disabled()
        assert page.locator(".visual-effect-clip").is_disabled()
        page.mouse.move(audio_box["x"] + audio_box["width"] * 0.8, audio_box["y"] + audio_box["height"] / 2)
        assert page.locator(".audio-clip").get_attribute("aria-label") == drag_start, "export lock ignores trailing pointer motion"
        page.mouse.up()
        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        if not page.locator("#advancedProjectOptions").evaluate("el => el.open"):
            page.locator("#advancedProjectOptions > summary").click()
        if not page.locator("#legacyExportDetails").evaluate("el => el.open"):
            page.locator("#legacyExportDetails > summary").click()
        page.locator("#cancelExportButton").click()
        page.get_by_text("أُلغي التسجيل ونُظّفت موارده.", exact=True).wait_for(timeout=10000)
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        assert "00:01.34" in page.locator(".audio-clip").get_attribute("aria-label"), "cancelled audio drag keeps its last valid timing"
        page.locator("#seek").evaluate("""(el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); }""", 0)
        page.locator("#playPauseButton").click()
        page.wait_for_function("Number(document.querySelector('#seek').value) > 100", timeout=3000)
        page.locator("#playPauseButton").click()
        assert page.locator("#playPauseButton").inner_text() == "متابعة"
        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        with page.expect_download() as project_download:
            page.locator("#saveProjectButton").click()
        project_path = Path(tmp) / "audio-project.json"
        project_download.value.save_as(project_path)
        saved_project = __import__("json").loads(project_path.read_text())
        assert saved_project["audioTracks"][0]["clips"][0]["asset"] == saved_project["audioAssets"][0]["id"]
        assert saved_project["visualEffectsTrack"]["clips"][0]["type"] == "fade"
        assert "data:audio" not in project_path.read_text()
        page.locator("#projectInput").set_input_files(str(project_path))
        page.wait_for_function("document.querySelector('#status').textContent.includes('فُتح المشروع')")
        assert page.locator(".audio-clip").count() == 1
        assert page.locator(".visual-effect-clip").count() == 1, "saved visual effects survive JSON reload"
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        page.locator("#audioInput").set_input_files(str(audio_sample))
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
        assert not page.locator("#addAudioClip").is_disabled(), "relinked local audio keeps the saved asset id"
        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        page.locator('[data-editor-mode-button="professional"]').click()
        page.locator('nav.bottom-dock [data-editor-section="motion"]').click()
        page.locator("#professionalMotionControls summary").click()
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
                    page.evaluate("""() => document.querySelector('#timelineLane').dispatchEvent(new PointerEvent('lostpointercapture', {
                      bubbles: true, pointerId: window.lastCameraPointerId, pointerType: 'mouse', isPrimary: true
                    }))""")
                    page.wait_for_function("!document.querySelector('#timelineLane').dataset.dragging")
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
        collision_times = [int(value) for value in page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")]
        movable_times = [value for value in collision_times if value not in (0, 12000)]
        assert len(collision_times) == 3 and len(set(collision_times)) == 3, "collision preserves all keys without duplicate times"
        assert movable_times and 6000 < movable_times[0] < 12000, "failed final position retains the last valid drag time"
        drag_key(movable_times[0], 7000, 95, "pointerup", repeat=True)
        assert [int(value) for value in page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")] == [0, 7000, 12000]
        assert page.locator('.keyframe-marker[data-key-time="7000"]').evaluate("el => document.activeElement === el"), "selection focus survives marker rerender"

        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        if not page.locator("#advancedProjectOptions").evaluate("el => el.open"):
            page.locator("#advancedProjectOptions > summary").click()
        if not page.locator("#legacyExportDetails").evaluate("el => el.open"):
            page.locator("#legacyExportDetails > summary").click()
        page.locator("#exportDuration").select_option("3000")
        page.locator("#exportQuality").select_option("economy")
        page.locator('nav.bottom-dock [data-editor-section="motion"]').click()
        if not page.locator("#professionalMotionControls").evaluate("el => el.open"):
            page.locator("#professionalMotionControls > summary").click()
        drag_key(7000, 8000, 96)
        assert page.locator("#timelineLane").get_attribute("data-dragging") == "true"
        page.locator("#exportButton").evaluate("el => el.click()")
        page.wait_for_function("document.querySelector('#exportButton').disabled")
        assert not page.locator("#timelineLane").get_attribute("data-dragging"), "export lock cancels the active drag state"
        page.mouse.move(lane.bounding_box()["x"] + lane.bounding_box()["width"] * 9000 / 12000,
                        lane.bounding_box()["y"] + 20)
        assert page.locator('.keyframe-marker[data-key-time="8000"]').count() == 1, "export lock rejects trailing pointer moves"
        page.mouse.up()
        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        if not page.locator("#advancedProjectOptions").evaluate("el => el.open"):
            page.locator("#advancedProjectOptions > summary").click()
        if not page.locator("#legacyExportDetails").evaluate("el => el.open"):
            page.locator("#legacyExportDetails > summary").click()
        page.locator("#cancelExportButton").click()
        page.get_by_text("أُلغي التسجيل ونُظّفت موارده.", exact=True).wait_for(timeout=10000)
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        if not page.locator("#advancedProjectOptions").evaluate("el => el.open"):
            page.locator("#advancedProjectOptions > summary").click()

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

        # Measure synchronization from one actual L10 recording. Audio contains three
        # short sine bursts; zero-duration flash state clips mark the same scene times.
        if support["webm"]:
            sync_page = browser.new_page(accept_downloads=True)
            sync_page.on("pageerror", lambda error: errors.append(str(error)))
            sync_page.goto(preview.as_uri())
            sync_page.wait_for_function("document.querySelector('#stage')?.width === 720")
            sync_page.locator("#imageInput").set_input_files(str(sample))
            sync_page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
            sync_page.locator("#audioInput").set_input_files(str(sync_audio_sample))
            sync_page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
            sync_page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
            sync_page.locator(".advanced-audio-drawer > summary").click()
            sync_page.locator("#audioTrackType").select_option("dialogue")
            sync_page.locator("#seek").evaluate("""el => { el.value = '0'; el.dispatchEvent(new Event('input', {bubbles: true})); }""")
            sync_page.locator("#addAudioClip").click()
            assert sync_page.locator(".audio-clip").count() == 1
            sync_page.locator('nav.bottom-dock [data-editor-section="project"]').click()
            sync_page.locator("#advancedProjectOptions > summary").click()
            sync_page.locator(".integrated-export-card .export-options summary").click()
            sync_page.locator("#integratedFrom").fill("0")
            sync_page.locator("#integratedTo").fill("3000")
            sync_page.locator("#integratedQuality").select_option("480p")
            sync_page.locator("#integratedFormat").select_option("webm")
            sync_page.locator("#integratedAudio").select_option("mix")

            sync_page.locator('nav.bottom-dock [data-editor-section="effects"]').click()
            for mark in sync_marks:
                for at, intensity in ((mark, "1"), (mark + 0.16, "0")):
                    sync_page.locator("#seek").evaluate("""(el, ms) => { el.value = String(ms); el.dispatchEvent(new Event('input', {bubbles: true})); }""", round(at * 1000))
                    sync_page.locator("#visualEffectType").select_option("flash")
                    sync_page.locator("#addVisualEffect").click()
                    sync_page.locator("#visualEffectDuration").fill("0")
                    sync_page.locator("#visualEffectDuration").dispatch_event("change")
                    for source in ("visualEffectFrom", "visualEffectTo"):
                        field = sync_page.locator(f'#{source} [data-effect-field="intensity"]')
                        field.fill(intensity)
                        field.dispatch_event("change")

            sync_page.locator('nav.bottom-dock [data-editor-section="project"]').click()
            sync_page.locator("#integratedProbeButton").click()
            sync_page.wait_for_function("""() => document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') ||
              !document.querySelector('#integratedError').hidden""", timeout=30000)
            probe_status = sync_page.locator("#integratedStatus").inner_text()
            probe_error = sync_page.locator("#integratedError").inner_text()
            assert "تم التحقق فعليًا" in probe_status, f"exact-profile capability probe failed: {probe_status}; {probe_error}"
            assert not sync_page.locator("#integratedExportButton").is_disabled()
            sync_page.locator("#integratedExportButton").click()
            sync_page.wait_for_function("""() => document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') ||
              !document.querySelector('#integratedError').hidden""", timeout=30000)
            integrated_status = sync_page.locator("#integratedStatus").inner_text()
            integrated_error = sync_page.locator("#integratedError").inner_text()
            technical_locator = sync_page.locator("#integratedError details code")
            integrated_technical = technical_locator.text_content() if technical_locator.count() else ""
            assert "اكتمل التصدير المتكامل" in integrated_status, f"integrated export failed: {integrated_status}; {integrated_error}; technical: {integrated_technical}; page errors: {errors}"
            with sync_page.expect_download() as sync_download_info:
                sync_page.locator("#integratedDownload").click()
            sync_output = Path(tmp) / "integrated-av-sync.webm"
            sync_download_info.value.save_as(sync_output)
            assert sync_output.is_file() and sync_output.stat().st_size > 0

            probe = __import__("json").loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(sync_output)
            ], text=True, timeout=60))
            video_stream = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
            audio_stream = next(stream for stream in probe["streams"] if stream["codec_type"] == "audio")
            video_frames = __import__("json").loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
                "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
                "-of", "json", str(sync_output)
            ], text=True, timeout=60)).get("frames", [])
            audio_packets = __import__("json").loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_packets",
                "-show_entries", "packet=pts_time,dts_time,duration_time",
                "-of", "json", str(sync_output)
            ], text=True, timeout=60)).get("packets", [])
            video_timeline = measure_media_timeline(
                video_frames, ("best_effort_timestamp_time", "pts_time"), ("pkt_duration_time", "duration_time"))
            audio_timeline = measure_media_timeline(
                audio_packets, ("pts_time", "dts_time"), ("duration_time",))
            # WebM commonly omits format.duration. Require both encoded tracks and the
            # complete A/V envelope to stay within the L10-A 150 ms recording tolerance.
            target_duration_s = 3.0
            duration_tolerance_s = max(0.150, 1000 / 24 / 1000)
            av_timeline_duration = max(video_timeline["end"], audio_timeline["end"]) - min(
                video_timeline["start"], audio_timeline["start"])
            for label, measured in (("video", video_timeline["duration"]),
                                    ("audio", audio_timeline["duration"]),
                                    ("A/V envelope", av_timeline_duration)):
                assert abs(measured - target_duration_s) <= duration_tolerance_s, (
                    label, measured, target_duration_s, duration_tolerance_s,
                    video_timeline, audio_timeline)
            # The browser reports Infinity for some valid WebM files. Check actual
            # playback and use a real seek range when exposed by the media element.
            viewport_text = sync_page.locator("#viewportValue").inner_text().split("·", 1)[0]
            viewport_dimensions = [int(value) for value in re.findall(r"\d+", viewport_text)]
            assert len(viewport_dimensions) >= 2, viewport_text
            source_width, source_height = viewport_dimensions[:2]
            scale = min(1, 480 / min(source_width, source_height), 854 / max(source_width, source_height))
            expected_width = max(2, math.floor(source_width * scale / 2) * 2)
            expected_height = max(2, math.floor(source_height * scale / 2) * 2)
            integrated_video = sync_page.locator("#integratedVideo")
            sync_page.wait_for_function("document.querySelector('#integratedVideo').readyState >= 1", timeout=10000)
            media_state = integrated_video.evaluate("""video => ({
              readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight,
              seekable: Array.from({length: video.seekable.length}, (_, index) =>
                [video.seekable.start(index), video.seekable.end(index)])
            })""")
            assert media_state["readyState"] >= 1 and media_state["videoWidth"] == expected_width and \
                media_state["videoHeight"] == expected_height, media_state
            integrated_video.evaluate("""video => {
              video.muted = true;
              return Promise.race([
                video.play(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("WebM playback did not start within 5 seconds")), 5000))
              ]);
            }""")
            sync_page.wait_for_function("document.querySelector('#integratedVideo').currentTime > 0.1", timeout=5000)
            integrated_video.evaluate("video => video.pause()")
            finite_seekable = [(start, end) for start, end in media_state["seekable"]
                               if math.isfinite(start) and math.isfinite(end) and end > start]
            if finite_seekable:
                seek_start, seek_end = finite_seekable[-1]
                seek_target = max(seek_start, seek_end - 0.2)
            elif media_state["seekable"]:
                # Some Chromium WebM demuxers mark the live range end as +Infinity.
                # The tested file has a finite frame-derived duration, so seek inside
                # that measured interval instead of forwarding Infinity to currentTime.
                seek_target = max(0, video_timeline["duration"] - 0.2)
            else:
                seek_target = None
            if seek_target is not None:
                assert math.isfinite(seek_target), seek_target
                integrated_video.evaluate("(video, target) => { video.currentTime = target; }", seek_target)
                sync_page.wait_for_function(
                    "(target) => Math.abs(document.querySelector('#integratedVideo').currentTime - target) < 0.08",
                    arg=seek_target, timeout=5000)
                playback_navigation = "seeked"
            else:
                playback_navigation = "playback-only (no seekable range)"
            print(f"L10-B playback: played; navigation={playback_navigation}")
            assert video_stream["width"] == expected_width and video_stream["height"] == expected_height, (video_stream, (expected_width, expected_height))
            video_start = video_timeline["start"]
            audio_start = audio_timeline["start"]
            frame_pts = [float(value) for value in subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
                "-of", "csv=p=0", str(sync_output)
            ], text=True, timeout=60).splitlines() if value.strip()]
            luma_raw = subprocess.check_output([
                "ffmpeg", "-v", "error", "-i", str(sync_output), "-map", "0:v:0", "-vf", "scale=1:1,format=gray",
                "-vsync", "0", "-f", "rawvideo", "-"
            ], timeout=60)
            assert len(luma_raw) == len(frame_pts), (len(luma_raw), len(frame_pts))
            bright_frames = [frame_pts[index] - video_start for index, value in enumerate(luma_raw) if value >= 225]
            bright_groups = []
            for timestamp in bright_frames:
                if not bright_groups or timestamp - bright_groups[-1][-1] > 0.10:
                    bright_groups.append([timestamp])
                else:
                    bright_groups[-1].append(timestamp)
            flash_times = [sum(group) / len(group) for group in bright_groups if len(group) >= 2]
            pcm = subprocess.check_output([
                "ffmpeg", "-v", "error", "-i", str(sync_output), "-map", "0:a:0", "-ac", "1", "-ar", "48000",
                "-f", "s16le", "-"
            ], timeout=60)
            pcm_values = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
            window = 480  # 10 ms RMS windows at 48 kHz.
            loud_windows = []
            for offset in range(0, len(pcm_values) - window, window):
                rms = math.sqrt(sum(value * value for value in pcm_values[offset:offset + window]) / window)
                if rms > 1200:
                    loud_windows.append(audio_start + offset / 48000)
            audio_groups = []
            for timestamp in loud_windows:
                if not audio_groups or timestamp - audio_groups[-1][-1] > 0.10:
                    audio_groups.append([timestamp])
                else:
                    audio_groups[-1].append(timestamp)
            audio_times = [sum(group) / len(group) for group in audio_groups if len(group) >= 3]
            assert len(flash_times) == len(sync_marks), (flash_times, bright_groups)
            assert len(audio_times) == len(sync_marks), audio_times
            drifts = [round((video - audio) * 1000, 1) for video, audio in zip(flash_times, audio_times)]
            assert max(abs(value) for value in drifts) <= 100, drifts
            assert max(drifts) - min(drifts) <= 50, drifts
            print(f"L10-B output sync: markers={len(sync_marks)}, drift_ms={drifts}, streams={video_stream['codec_name']}/{audio_stream['codec_name']}")

            # Exercise the requested real-browser durations in silent and mixed
            # modes. Only formats the device can actually probe and decode count
            # as supported; advertised-but-unusable MIME types remain skipped.
            sync_page.locator("#duration").fill("60")
            sync_page.locator("#duration").dispatch_event("input")
            verified_runs = 0
            for audio_mode in ("none", "mix"):
                for export_format in ("mp4", "webm"):
                    if not support[export_format]:
                        print(f"L11-F2 export matrix: {export_format}/{audio_mode} unsupported by this Chromium build")
                        continue
                    sync_page.locator("#integratedFormat").select_option(export_format)
                    sync_page.locator("#integratedAudio").select_option(audio_mode)
                    sync_page.locator("#integratedQuality").select_option("480p")
                    sync_page.locator("#integratedProbeButton").click()
                    sync_page.wait_for_function("""() => document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') ||
                      !document.querySelector('#integratedError').hidden""", timeout=30000)
                    probe_status = sync_page.locator("#integratedStatus").inner_text()
                    if "تم التحقق فعليًا" not in probe_status:
                        print(f"L11-F2 export matrix: {export_format}/{audio_mode} not verified: {sync_page.locator('#integratedError').inner_text()}")
                        continue
                    for seconds in (3, 5, 10, 30):
                        sync_page.locator("#integratedFrom").fill("0")
                        sync_page.locator("#integratedTo").fill(str(seconds * 1000))
                        sync_page.locator("#integratedFrom").dispatch_event("change")
                        sync_page.locator("#integratedTo").dispatch_event("change")
                        sync_page.locator("#integratedExportButton").click()
                        sync_page.wait_for_function("""() => document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') ||
                          !document.querySelector('#integratedError').hidden""", timeout=seconds * 1000 + 30000)
                        status = sync_page.locator("#integratedStatus").inner_text()
                        detail = sync_page.locator("#integratedError").inner_text()
                        assert "اكتمل التصدير المتكامل" in status, (export_format, audio_mode, seconds, status, detail)
                        with sync_page.expect_download(timeout=15000) as download_info:
                            sync_page.locator("#integratedDownload").click()
                        output = Path(tmp) / f"timing-{seconds}s-{audio_mode}.{export_format}"
                        download_info.value.save_as(output)
                        probe = __import__("json").loads(subprocess.check_output([
                            "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)
                        ], text=True, timeout=60))
                        video_streams = [stream for stream in probe["streams"] if stream["codec_type"] == "video"]
                        audio_streams = [stream for stream in probe["streams"] if stream["codec_type"] == "audio"]
                        assert len(video_streams) == 1 and bool(audio_streams) == (audio_mode == "mix"), (
                            export_format, audio_mode, seconds, [(stream["codec_type"], stream["codec_name"]) for stream in probe["streams"]])
                        frames = __import__("json").loads(subprocess.check_output([
                            "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
                            "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
                            "-of", "json", str(output)
                        ], text=True, timeout=60)).get("frames", [])
                        video_timeline = measure_media_timeline(
                            frames, ("best_effort_timestamp_time", "pts_time"), ("pkt_duration_time", "duration_time"))
                        duration_tolerance_s = max(0.150, 1000 / 24 / 1000)
                        assert abs(video_timeline["duration"] - seconds) <= duration_tolerance_s, (
                            export_format, audio_mode, seconds, video_timeline, duration_tolerance_s)
                        if audio_mode == "mix":
                            packets = __import__("json").loads(subprocess.check_output([
                                "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_packets",
                                "-show_entries", "packet=pts_time,dts_time,duration_time",
                                "-of", "json", str(output)
                            ], text=True, timeout=60)).get("packets", [])
                            audio_timeline = measure_media_timeline(packets, ("pts_time", "dts_time"), ("duration_time",))
                            # The integrated recorder now carries silence after the
                            # three-second source ends, keeping its audio track live.
                            expected_audio_duration = seconds
                            if seconds > 3:
                                import array
                                tail = subprocess.check_output([
                                    "ffmpeg", "-v", "error", "-ss", "3.25", "-i", str(output),
                                    "-map", "0:a:0", "-ac", "1", "-ar", "16000",
                                    "-f", "f32le", "-"
                                ], timeout=60)
                                samples = array.array("f")
                                samples.frombytes(tail)
                                assert len(samples) >= int((seconds - 3.5) * 16000), (
                                    "missing silent audio tail", export_format, seconds, len(samples))
                                rms = (sum(value * value for value in samples) / len(samples)) ** 0.5
                                assert rms < 0.001, ("unexpected sound in silent tail", export_format, seconds, rms)
                            envelope = max(video_timeline["end"], audio_timeline["end"]) - min(
                                video_timeline["start"], audio_timeline["start"])
                            assert abs(audio_timeline["duration"] - expected_audio_duration) <= duration_tolerance_s and \
                                abs(envelope - seconds) <= duration_tolerance_s, (
                                    export_format, audio_mode, seconds, video_timeline, audio_timeline, envelope)
                        verified_runs += 1
                        audio_duration = audio_timeline["duration"] if audio_mode == "mix" else 0
                        print(f"L11-F2 real export: {export_format}/{audio_mode}/{seconds}s video={video_timeline['duration']:.3f}s audio={audio_duration:.3f}s")
            assert verified_runs >= 8, f"Expected WebM 3/5/10/30 s with and without audio; verified {verified_runs} exports"
            sync_page.close()

        # L11-E: record three actual scenes in one MediaRecorder output and decode
        # frames on both sides of each exact 3s/7s Cut boundary.
        sequence_page = browser.new_page(accept_downloads=True)
        sequence_errors = []
        sequence_page.on("pageerror", lambda error: sequence_errors.append(str(error)))
        sequence_page.goto(preview.as_uri())
        sequence_page.wait_for_function("document.querySelector('#stage')?.width === 720")
        sequence_page.locator('nav.bottom-dock [data-editor-section="scenes"]').click()
        def set_scene_card(card):
            sequence_page.locator("#imageInput").set_input_files(str(card))
            sequence_page.wait_for_function("document.querySelector('#imageName').textContent.includes('sequence-')")
        def set_scene_duration(seconds):
            sequence_page.locator("#sceneDuration").fill(str(seconds))
            sequence_page.locator("#sceneDuration").dispatch_event("change")
            assert sequence_page.locator("#sceneDuration").input_value() == str(seconds)
        def add_scene_audio(audio_file):
            sequence_page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
            if sequence_page.locator(".advanced-audio-drawer").get_attribute("open") is None:
                sequence_page.locator(".advanced-audio-drawer > summary").click()
            sequence_page.locator("#audioInput").set_input_files(str(audio_file))
            sequence_page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')")
            sequence_page.locator("#audioTrackType").select_option("music")
            sequence_page.locator("#addAudioClip").click()
            assert sequence_page.locator(".audio-clip").count() >= 1, sequence_page.locator("#audioTimelineMessage").inner_text()
            sequence_page.locator('nav.bottom-dock [data-editor-section="scenes"]').click()

        set_scene_card(sequence_cards[0])
        set_scene_duration(3)
        add_scene_audio(sequence_audio[0])
        sequence_page.locator("#addSceneButton").click()
        sequence_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 2")
        set_scene_card(sequence_cards[1])
        set_scene_duration(4)
        add_scene_audio(sequence_audio[1])
        sequence_page.locator("#addSceneButton").click()
        sequence_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 3")
        set_scene_card(sequence_cards[2])
        set_scene_duration(3)
        add_scene_audio(sequence_audio[2])
        sequence_page.wait_for_function("document.querySelector('#sequenceDuration').textContent.includes('00:10')")
        assert sequence_page.locator("#sequenceBlocks .sequence-block").count() == 3
        assert sequence_page.locator("#integratedTo").input_value() == "10000"
        sequence_page.locator('nav.bottom-dock [data-editor-section="project"]').click()
        sequence_page.locator(".integrated-export-card details.export-options > summary").click()
        sequence_page.locator("#integratedFormat").select_option("webm")
        sequence_page.locator("#integratedAudio").select_option("mix")
        sequence_page.locator("#integratedQuality").select_option("480p")
        sequence_page.locator("#integratedProbeButton").click()
        sequence_page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') || !document.querySelector('#integratedError').hidden", timeout=30000)
        assert "تم التحقق فعليًا" in sequence_page.locator("#integratedStatus").inner_text(), sequence_page.locator("#integratedError").inner_text()
        sequence_page.locator("#integratedExportButton").click()
        sequence_page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') || !document.querySelector('#integratedError').hidden", timeout=45000)
        assert "اكتمل التصدير المتكامل" in sequence_page.locator("#integratedStatus").inner_text(), sequence_page.locator("#integratedError").inner_text()
        with sequence_page.expect_download(timeout=15000) as sequence_download:
            sequence_page.locator("#integratedDownload").click()
        sequence_output = Path(tmp) / "l11e-three-scenes-10s.webm"
        sequence_download.value.save_as(sequence_output)
        sequence_probe = __import__("json").loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(sequence_output)
        ], text=True, timeout=60))
        sequence_video_streams = [stream for stream in sequence_probe["streams"] if stream["codec_type"] == "video"]
        sequence_audio_streams = [stream for stream in sequence_probe["streams"] if stream["codec_type"] == "audio"]
        assert len(sequence_video_streams) == 1, sequence_probe["streams"]
        assert len(sequence_audio_streams) == 1, sequence_probe["streams"]
        sequence_frames = __import__("json").loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
            "-of", "json", str(sequence_output)
        ], text=True, timeout=60)).get("frames", [])
        sequence_timeline = measure_media_timeline(
            sequence_frames, ("best_effort_timestamp_time", "pts_time"), ("pkt_duration_time", "duration_time"))
        duration = sequence_timeline["duration"]
        assert abs(duration - 10) <= 0.150, (duration, sequence_probe["format"])
        def decoded_center_color(seconds):
            return subprocess.check_output([
                "ffmpeg", "-v", "error", "-ss", str(seconds), "-i", str(sequence_output), "-frames:v", "1",
                "-vf", "crop=1:1:iw/2:ih/2,format=rgb24", "-f", "rawvideo", "-"
            ], timeout=60)
        for timestamp, expected in ((1, 0), (2.95, 0), (3.05, 1), (6.95, 1), (7.05, 2), (8.5, 2)):
            color = decoded_center_color(timestamp)
            assert len(color) == 3 and color[expected] > max(color[(expected + 1) % 3], color[(expected + 2) % 3]) * 2, (timestamp, list(color))
        def dominant_audio_frequency(seconds):
            raw = subprocess.check_output([
                "ffmpeg", "-v", "error", "-ss", str(seconds), "-i", str(sequence_output), "-t", "0.2",
                "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-acodec", "pcm_s16le", "-"
            ], timeout=60)
            samples = [value[0] for value in struct.iter_unpack("<h", raw)]
            assert len(samples) >= 8000, (seconds, len(samples))
            return max((440, 660, 880), key=lambda frequency: abs(sum(
                sample * math.cos(2 * math.pi * frequency * index / 48000)
                for index, sample in enumerate(samples)
            )))
        for timestamp, expected_frequency in ((2.7, 440), (3.2, 660), (6.7, 660), (7.2, 880)):
            actual_frequency = dominant_audio_frequency(timestamp)
            assert actual_frequency == expected_frequency, (timestamp, expected_frequency, actual_frequency)
        print(f"L11-E three-scene export: one WebM video/audio track each, duration={duration:.3f}s, picture and sound verified across 3s/7s Cuts")
        preview_color = sequence_page.locator("#stage").evaluate("el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data]")
        assert preview_color[2] > preview_color[0] * 2, ("editor preview was not restored after WebM export", preview_color)
        assert sequence_page.locator("#integratedError").is_hidden(), sequence_page.locator("#integratedError").inner_text()

        # Repeat the same sequence as MP4 to catch duplicated scene offsets and stale
        # preview/error state after one successful export.
        sequence_page.locator("#integratedFormat").select_option("mp4")
        sequence_page.locator("#integratedProbeButton").click()
        sequence_page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') || !document.querySelector('#integratedError').hidden", timeout=30000)
        assert "تم التحقق فعليًا" in sequence_page.locator("#integratedStatus").inner_text(), sequence_page.locator("#integratedError").inner_text()
        sequence_page.locator("#integratedExportButton").click()
        sequence_page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('جارٍ تحضير')", timeout=10000)
        sequence_page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') || !document.querySelector('#integratedError').hidden", timeout=45000)
        assert "اكتمل التصدير المتكامل" in sequence_page.locator("#integratedStatus").inner_text(), sequence_page.locator("#integratedError").inner_text()
        assert sequence_page.locator("#integratedError").is_hidden(), sequence_page.locator("#integratedError").inner_text()
        preview_color = sequence_page.locator("#stage").evaluate("el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data]")
        assert preview_color[2] > preview_color[0] * 2, ("editor preview was not restored after repeated MP4 export", preview_color)
        with sequence_page.expect_download(timeout=15000) as mp4_download:
            sequence_page.locator("#integratedDownload").click()
        mp4_output = Path(tmp) / "l11e-three-scenes-10s.mp4"
        mp4_download.value.save_as(mp4_output)
        mp4_probe = __import__("json").loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(mp4_output)
        ], text=True, timeout=60))
        mp4_video = [stream for stream in mp4_probe["streams"] if stream["codec_type"] == "video"]
        mp4_audio = [stream for stream in mp4_probe["streams"] if stream["codec_type"] == "audio"]
        assert len(mp4_video) == len(mp4_audio) == 1, mp4_probe["streams"]
        mp4_duration = float(mp4_probe["format"].get("duration") or mp4_video[0].get("duration"))
        assert abs(mp4_duration - 10) <= 0.150, (mp4_duration, mp4_probe["format"])
        print(f"L11-E repeated scene export: one MP4 video/audio track each, duration={mp4_duration:.3f}s; preview restored")
        assert not sequence_errors, sequence_errors
        sequence_page.close()
        page.locator('nav.bottom-dock [data-editor-section="effects"]').click()
        effect_lane = page.locator('#visualEffectsTracks .visual-effect-lane[data-effect-type="fade"]')
        effect_clip = page.locator(".visual-effect-clip")
        effect_lane.scroll_into_view_if_needed()
        effect_clip.scroll_into_view_if_needed()
        effect_box = effect_lane.bounding_box()
        assert effect_box["width"] > 100, f"effects lane has an unusable drag width: {effect_box}"
        effect_box_clip = effect_clip.bounding_box()
        effect_start_x = effect_box_clip["x"] + effect_box_clip["width"] / 2
        effect_start_y = effect_box_clip["y"] + effect_box_clip["height"] / 2
        initial_effect_label = effect_clip.get_attribute("aria-label")
        initial_effect_left = effect_clip.evaluate("el => getComputedStyle(el).getPropertyValue('--effect-left')")
        effect_original = effect_clip.element_handle()
        page.evaluate("""() => {
          window.lastEffectsPointerId = null; window.effectsPointerMoves = 0;
          const root = document.querySelector('#visualEffectsTracks');
          root.addEventListener('pointerdown', event => { window.lastEffectsPointerId = event.pointerId; }, {capture: true});
          root.addEventListener('pointermove', () => { window.effectsPointerMoves += 1; }, {capture: true});
        }""")
        page.mouse.move(effect_start_x, effect_start_y)
        page.evaluate("window.effectsPointerMoves = 0")
        page.mouse.down()
        page.wait_for_function("""() => {
          const root = document.querySelector('#visualEffectsTracks');
          return root.dataset.dragging === 'true' && root.hasPointerCapture(window.lastEffectsPointerId);
        }""")
        page.mouse.move(effect_start_x + effect_box["width"] * 0.15, effect_start_y, steps=5)
        page.wait_for_function("window.effectsPointerMoves > 0")
        assert effect_original.evaluate("el => el.isConnected"), "effects drag keeps the existing clip node instead of rebuilding the lane DOM"
        page.wait_for_function("""(initial) => {
          const root = document.querySelector('#visualEffectsTracks');
          const clip = root.querySelector('.visual-effect-clip');
          return root.hasPointerCapture(window.lastEffectsPointerId) &&
            clip?.getAttribute('aria-pressed') === 'true' && document.activeElement === clip &&
            getComputedStyle(clip).getPropertyValue('--effect-left') !== initial;
        }""", arg=initial_effect_left)
        page.wait_for_function("""(initial) => {
          const clip = document.querySelector('#visualEffectsTracks .visual-effect-clip');
          return clip && getComputedStyle(clip).getPropertyValue('--effect-left') !== initial;
        }""", arg=initial_effect_left)
        page.mouse.up()
        moved_effect_label = effect_clip.get_attribute("aria-label")
        assert moved_effect_label != initial_effect_label, page.locator("#visualEffectsMessage").inner_text()
        # Pointer cancellation, actual capture loss, and focus loss terminate further drags.
        effect_clip.scroll_into_view_if_needed()
        effect_box_clip = effect_clip.bounding_box()
        page.mouse.move(effect_box_clip["x"] + effect_box_clip["width"] / 2, effect_box_clip["y"] + effect_box_clip["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#visualEffectsTracks').dataset.dragging === 'true'")
        page.evaluate("""() => document.querySelector('#visualEffectsTracks').dispatchEvent(new PointerEvent('pointercancel', {
          bubbles: true, pointerId: window.lastEffectsPointerId, pointerType: 'mouse', isPrimary: true
        }))""")
        assert not page.locator("#visualEffectsTracks").get_attribute("data-dragging")
        assert "أُلغي السحب" in page.locator("#visualEffectsMessage").inner_text()
        page.mouse.up()
        effect_clip.scroll_into_view_if_needed()
        effect_box_clip = effect_clip.bounding_box()
        page.mouse.move(effect_box_clip["x"] + effect_box_clip["width"] / 2, effect_box_clip["y"] + effect_box_clip["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#visualEffectsTracks').hasPointerCapture(window.lastEffectsPointerId)")
        page.evaluate("""() => document.querySelector('#visualEffectsTracks').dispatchEvent(new PointerEvent('lostpointercapture', {
          bubbles: true, pointerId: window.lastEffectsPointerId, pointerType: 'mouse', isPrimary: true
        }))""")
        page.wait_for_function("!document.querySelector('#visualEffectsTracks').dataset.dragging")
        assert "أُلغي السحب" in page.locator("#visualEffectsMessage").inner_text()
        page.mouse.up()
        effect_clip.scroll_into_view_if_needed()
        effect_box_clip = effect_clip.bounding_box()
        page.mouse.move(effect_box_clip["x"] + effect_box_clip["width"] / 2, effect_box_clip["y"] + effect_box_clip["height"] / 2)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#visualEffectsTracks').dataset.dragging === 'true'")
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert not page.locator("#visualEffectsTracks").get_attribute("data-dragging"), "focus loss cancels an active effects drag"
        assert "أُلغي السحب" in page.locator("#visualEffectsMessage").inner_text()
        page.mouse.up()
        assert not errors, errors

        # L11-D multi-scene workbench: use a real mobile Chromium touch context.
        touch_context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                           is_mobile=True, has_touch=True, accept_downloads=True)
        touch_page = touch_context.new_page()
        touch_errors = []
        touch_page.on("pageerror", lambda error: touch_errors.append(str(error)))
        def touch_tap(locator):
            locator.evaluate("el => el.scrollIntoView({block:'center', inline:'center', behavior:'instant'})")
            box = locator.bounding_box()
            assert locator.evaluate("el => { const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return hit === el || hit?.closest('button') === el || (el.matches('summary') && hit?.closest('summary') === el); }"), "touch target must be the actual hit target after scrolling"
            touch_page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        touch_page.goto(preview.as_uri())
        touch_page.wait_for_function("document.querySelector('#stage')?.width === 720")
        touch_page.locator("#imageInput").set_input_files(str(sample))
        touch_page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        assert touch_page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1"), "mobile editor shell must fit the viewport without long-page or horizontal scrolling"
        touch_page.screenshot(path=str(screenshot_dir / "motion-studio-mobile-motion.png"))

        # Exercise the three requested phone sizes, then repeat one on a WebView-style Android UA.
        phone_sizes = [(360, 640), (390, 844), (430, 932)]
        phone_profiles = [
            ("chrome", "Mozilla/5.0 (Linux; Android 15; HONOR 400 Pro Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"),
            ("webview", "Mozilla/5.0 (Linux; Android 15; HONOR 400 Pro Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36")
        ]
        for profile, user_agent in phone_profiles:
            sizes = phone_sizes if profile == "chrome" else [phone_sizes[1]]
            for width, height in sizes:
                phone_context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1.5,
                    is_mobile=True, has_touch=True, user_agent=user_agent, accept_downloads=True)
                phone_page = phone_context.new_page()
                phone_page.on("pageerror", lambda error: touch_errors.append(str(error)))
                phone_page.goto(preview.as_uri())
                phone_page.wait_for_function("document.querySelector('#stage')?.width === 720")
                phone_page.locator("#imageInput").set_input_files(str(sample))
                phone_page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
                layout = phone_page.evaluate("""() => {
                  const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
                  const preview = rect('#studioPreview'), drawer = rect('.tool-drawer'), dock = rect('.bottom-dock');
                  const canvas = rect('#stage'), stage = rect('.stage-wrap'), transport = rect('.preview-transport-host'), heading = rect('.preview-heading');
                  const overlaps = (a,b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
                  return {preview,drawer,dock,canvas,stage,transport,heading,ratio:preview.height/(preview.height+drawer.height),
                    canvasHeightFill:canvas.height/stage.height,
                    pageOverflow:document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1,
                    pageSize:{htmlWidth:document.documentElement.scrollWidth,htmlHeight:document.documentElement.scrollHeight,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight,viewportWidth:innerWidth,viewportHeight:innerHeight,overflowElements:Array.from(document.querySelectorAll("body *")).map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id,classes:typeof el.className==="string"?el.className:"",top:r.top,bottom:r.bottom,left:r.left,right:r.right,overflowY:getComputedStyle(el).overflowY};}).filter(r=>r.bottom>innerHeight+1||r.right>innerWidth+1).slice(-12)},
                    picker:getComputedStyle(document.querySelector('#previewImagePicker')).display,
                    inputRect:(() => { const r=document.querySelector('#imageInput').getBoundingClientRect(); return {width:r.width,height:r.height}; })(),
                    canvasRatio:canvas.width/canvas.height, sourceRatio:(() => { const el=document.querySelector('#stage'); return el.width/el.height; })(), canvasTransportOverlap:overlaps(canvas,transport),
                    canvasHeadingOverlap:overlaps(canvas,heading), hasCardActions:Boolean(document.querySelector('#sceneThumbnails .scene-card-controls'))};
                }""")
                assert not layout["pageOverflow"], (profile, width, height, layout)
                assert 0.52 <= layout["ratio"] <= 0.58, (profile, width, height, layout)
                assert abs(layout["canvasRatio"] - layout["sourceRatio"]) < 0.02, (profile, width, height, layout)
                assert layout["canvasHeightFill"] >= 0.9, (profile, width, height, layout)
                assert not layout["canvasTransportOverlap"] and not layout["canvasHeadingOverlap"], (profile, width, height, layout)
                assert layout["picker"] == "none", (profile, width, height, layout)
                assert max(layout["inputRect"]["width"], layout["inputRect"]["height"]) <= 1, (profile, width, height, layout)
                assert not layout["hasCardActions"], "scene actions belong in the Scenes section"
                if profile == "chrome":
                    phone_page.screenshot(path=str(screenshot_dir / f"motion-studio-android-chrome-{width}x{height}.png"))
                if width == 360:
                    phone_page.locator('nav.bottom-dock [data-editor-section="scenes"]').click()
                    phone_page.locator("#sceneName").focus()
                    phone_page.set_viewport_size({"width": width, "height": height - 240})
                    keyboard_layout = phone_page.evaluate("""() => ({height:innerHeight,studioBottom:document.querySelector('.studio').getBoundingClientRect().bottom,
                      dockTop:document.querySelector('.bottom-dock').getBoundingClientRect().top,dockBottom:document.querySelector('.bottom-dock').getBoundingClientRect().bottom,
                      panelTop:document.querySelector('.tool-drawer').getBoundingClientRect().top,panelBottom:document.querySelector('.tool-drawer').getBoundingClientRect().bottom,
                      horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1})""")
                    assert not keyboard_layout["horizontalOverflow"] and keyboard_layout["studioBottom"] <= keyboard_layout["height"] + 1, keyboard_layout
                    assert keyboard_layout["dockBottom"] <= keyboard_layout["height"] + 1, keyboard_layout
                    assert keyboard_layout["panelBottom"] < keyboard_layout["dockTop"], keyboard_layout
                phone_context.close()
        fullscreen_button = touch_page.locator("#fullscreenPreviewButton")
        assert fullscreen_button.bounding_box()["width"] >= 44 and fullscreen_button.bounding_box()["height"] >= 44
        touch_tap(fullscreen_button)
        touch_page.wait_for_function("document.fullscreenElement?.id === 'studioPreview' || document.querySelector('#studioPreview').classList.contains('preview-fullscreen')")
        touch_tap(fullscreen_button)
        touch_page.wait_for_function("!document.fullscreenElement && !document.querySelector('#studioPreview').classList.contains('preview-fullscreen')")
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="project"]'))
        touch_tap(touch_page.locator("#advancedProjectOptions > summary"))
        touch_page.locator("#aspectPreset").select_option("portrait")
        touch_page.wait_for_function("document.querySelector('#stage').width === 720 && document.querySelector('#stage').height === 1280")
        touch_page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="scenes"]'))
        touch_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 1")
        asset_library = touch_page.locator(".asset-library")
        if not asset_library.evaluate("el => el.open"):
            touch_tap(asset_library.locator("summary"))
        touch_page.wait_for_function("document.querySelectorAll('#assetLibraryList .asset-entry').length >= 2")
        touch_page.screenshot(path=str(screenshot_dir / "motion-studio-mobile-scenes.png"))
        used_asset = touch_page.locator("#assetLibraryList .asset-entry").last
        assert used_asset.get_by_role("button", name="حذف").is_disabled(), "scene-referenced assets cannot be deleted"
        touch_tap(touch_page.locator("#addSceneButton"))
        touch_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 2")
        assert touch_page.locator("#sequenceBlocks .sequence-block").count() == 2
        fit_frame = touch_page.locator("#stage").evaluate("el => el.toDataURL()")
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="project"]'))
        touch_page.locator("#fitMode").select_option("fill")
        touch_page.wait_for_function("previous => document.querySelector('#stage').toDataURL() !== previous", arg=fit_frame)
        assert touch_page.locator("#fitMode").input_value() == "fill"
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="scenes"]'))
        touch_page.locator("#sceneName").fill("المشهد الثاني")
        touch_page.locator("#sceneName").dispatch_event("change")
        touch_page.locator("#sceneDuration").fill("4")
        touch_page.locator("#sceneDuration").dispatch_event("change")
        assert int(touch_page.locator("#sequenceSeek").get_attribute("max")) == 16000
        touch_tap(touch_page.locator("#addSceneButton"))
        touch_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 3")
        order_before = touch_page.locator("#sceneThumbnails .scene-card").evaluate_all("els => els.map(el => el.dataset.sceneId)")
        reorder_button = touch_page.locator("#moveSceneLeftButton")
        reorder_button.evaluate("el => el.scrollIntoView({block:'center', inline:'center', behavior:'instant'})")
        reorder_box = reorder_button.bounding_box()
        assert reorder_button.evaluate("el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button') === el; }"), "scene reorder button must be the actual touch hit target"
        touch_page.touchscreen.tap(reorder_box["x"] + reorder_box["width"] / 2, reorder_box["y"] + reorder_box["height"] / 2)
        order_after = touch_page.locator("#sceneThumbnails .scene-card").evaluate_all("els => els.map(el => el.dataset.sceneId)")
        assert order_after[1] == order_before[2] and order_after != order_before, (order_before, order_after)
        touch_tap(touch_page.locator("#duplicateSceneButton"))
        touch_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 4")
        touch_tap(touch_page.locator("#deleteSceneButton"))
        touch_page.wait_for_function("document.querySelectorAll('#sceneThumbnails .scene-card').length === 3")
        touch_tap(touch_page.locator("#sceneThumbnails .scene-card").first.locator(".scene-select"))
        touch_page.wait_for_function("document.querySelector('#sceneName').value === 'المشهد 1'")
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="project"]'))
        assert touch_page.locator("#fitMode").input_value() == "fit", "switching scenes restores each scene's Fit setting"
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="scenes"]'))
        touch_tap(touch_page.locator("#sceneThumbnails .scene-card").nth(2).locator(".scene-select"))
        touch_page.wait_for_function("document.querySelector('#sceneName').value === 'المشهد الثاني'")
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="project"]'))
        assert touch_page.locator("#fitMode").input_value() == "fill", "switching scenes restores each scene's Fill setting"
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="scenes"]'))

        # Exact global Cut boundary selects the next scene with local time zero.
        touch_page.locator("#sequenceSeek").evaluate("el => { el.value = '12000'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
        touch_page.wait_for_function("document.querySelector('#sceneName').value === 'المشهد 3'")
        assert touch_page.locator("#seek").input_value() == "0"
        touch_tap(touch_page.locator("#playPauseButton"))
        touch_page.wait_for_function("document.querySelector('#playPauseButton').textContent === 'إيقاف مؤقت'")
        touch_page.wait_for_timeout(200)
        touch_tap(touch_page.locator("#playPauseButton"))
        assert touch_page.locator("#playPauseButton").text_content() == "متابعة"
        touch_tap(touch_page.locator("#replayButton"))
        touch_page.wait_for_function("document.querySelector('#sceneName').value === 'المشهد 1' && Number(document.querySelector('#sequenceSeek').value) > 0")
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="motion"]'))
        touch_tap(touch_page.locator('[data-editor-mode-button="simple"]'))
        assert touch_page.locator(".studio").get_attribute("data-editor-mode") == "simple", "Simple mode is the mobile default"
        simple_times = lambda: [int(value) for value in touch_page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")]
        camera_before_quick_motion = simple_times()
        touch_page.locator("#motionFromSeconds").fill("1")
        touch_page.locator("#motionToSeconds").fill("5")
        touch_page.locator("#motionSpeed").select_option("1.5")
        for control, value in [("motionStrength", "72"), ("motionFocusX", "30"), ("motionFocusY", "68")]:
            touch_page.locator(f"#{control}").evaluate("(el, next) => { el.value = next; el.dispatchEvent(new Event('input', {bubbles:true})); }", value)
        first_preset = touch_page.locator('[data-motion-preset="zoom-in"]:not([data-automatic-motion])')
        touch_tap(first_preset)
        assert simple_times() != camera_before_quick_motion, "quick preset creates camera keyframes immediately"
        assert touch_page.locator("#undoMotionButton").is_enabled()
        touch_tap(touch_page.locator("#undoMotionButton"))
        assert simple_times() == camera_before_quick_motion, "undo restores the camera track before quick motion"
        for preset in ["zoom-in", "zoom-out", "static", "pan-horizontal", "pan-vertical", "cinematic"]:
            touch_tap(touch_page.locator(f'[data-motion-preset="{preset}"]:not([data-automatic-motion])'))
            assert "طُبّقت" in touch_page.locator("#motionPresetMessage").inner_text(), preset
        switched_times = simple_times()
        touch_tap(touch_page.locator('[data-editor-mode-button="professional"]'))
        assert touch_page.locator(".studio").get_attribute("data-editor-mode") == "professional"
        touch_tap(touch_page.locator('[data-editor-mode-button="automatic"]'))
        assert touch_page.locator("#automaticMotionPanel").is_visible()
        touch_tap(touch_page.locator('[data-editor-mode-button="simple"]'))
        assert simple_times() == switched_times, "switching editing modes preserves camera keyframes"
        touch_tap(touch_page.locator('[data-editor-mode-button="automatic"]'))
        for preset in ["zoom-in", "pan-horizontal", "cinematic"]:
            touch_tap(touch_page.locator(f'[data-motion-preset="{preset}"][data-automatic-motion="true"]'))
            assert "اقتراح" in touch_page.locator("#motionPresetMessage").inner_text(), preset
            touch_tap(touch_page.locator("#undoMotionAutomatic"))
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="audio"]'))
        assert touch_page.locator(".studio").get_attribute("data-editor-mode") == "professional"
        assert touch_page.locator("#audioToolsSection").is_visible()
        touch_page.screenshot(path=str(screenshot_dir / "motion-studio-mobile-audio.png"))
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="effects"]'))
        assert touch_page.locator("#effectsToolsSection").is_visible()
        touch_page.screenshot(path=str(screenshot_dir / "motion-studio-mobile-effects.png"))
        touch_tap(touch_page.locator('nav.bottom-dock [data-editor-section="motion"]'))
        assert touch_page.locator(".studio").get_attribute("data-editor-mode") == "professional", "section navigation preserves the user's selected editing mode"
        touch_tap(touch_page.locator('[data-editor-mode-button="simple"]'))
        assert touch_page.locator("#motionStrength").input_value() == "72"
        assert touch_page.locator("#motionFocusX").input_value() == "30"
        assert touch_page.locator("#motionFocusY").input_value() == "68"
        assert touch_page.locator("#motionFromSeconds").input_value() == "1"
        assert touch_page.locator("#motionToSeconds").input_value() == "5"
        assert not touch_errors, touch_errors
        assert touch_page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1"), "mobile editor shell remains fixed after section changes"
        print("L11-F2 touch UI: compact fixed shell, scene editing, mode switching, six camera presets, auto suggestions, undo, focus, preview, pause and replay passed")
        touch_context.close()
        browser.close()
