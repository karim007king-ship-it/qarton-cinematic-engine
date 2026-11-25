"""Exercise long MP3 import, touch insertion, preview/export signal, and reload recovery."""
from pathlib import Path
from os import environ
import array
import json
import math
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright


def touch_tap(page, locator):
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box, f"touch target is not visible: {locator}"
    assert locator.evaluate("el => { const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return hit === el || hit?.closest('button') === el; }"), "touch hit-test did not reach the requested button"
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def dominant_tone(samples, sample_rate):
    def goertzel(frequency):
        coefficient = 2 * math.cos(2 * math.pi * frequency / sample_rate)
        previous = previous2 = 0.0
        for value in samples:
            current = value + coefficient * previous - previous2
            previous2, previous = previous, current
        return previous2 * previous2 + previous * previous - coefficient * previous * previous2
    return max((440, 660, 880), key=goertzel)


root = Path(__file__).resolve().parents[1]
slug = environ.get("MOTION_STUDIO_PREVIEW_SLUG", "motion-studio-l11h4-audio-fix-preview")
preview = root / "dist" / slug / "index.html"
image = root / "examples/motion-studio-lab/preview-test.png"
artifacts = root / "artifacts/motion-studio-l11h4-audio-fix"
artifacts.mkdir(parents=True, exist_ok=True)
assert preview.is_file() and image.is_file()

with tempfile.TemporaryDirectory(prefix="qarton-audio-import-") as directory:
    temp = Path(directory)
    mp3 = temp / "long-tone-51.52s.mp3"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=frequency=660:sample_rate=48000:duration=51.52", "-ac", "1", "-b:a", "32k",
                    "-codec:a", "libmp3lame", "-y", str(mp3)], check=True, timeout=60)
    metadata = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
                                                   "-of", "json", str(mp3)], text=True, timeout=30))["format"]
    source_duration = float(metadata["duration"])
    assert abs(source_duration - 51.52) < 0.10, source_duration
    assert int(metadata["size"]) < 240_000, metadata

    with sync_playwright() as playwright:
        executable = environ.get("CHROMIUM_EXECUTABLE_PATH")
        browser = playwright.chromium.launch(executable_path=executable) if executable else playwright.chromium.launch(channel="chrome")
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                     is_mobile=True, has_touch=True, accept_downloads=True)
        context.add_init_script("""(() => {
          const NativeAudio = window.Audio;
          window.__qartonPreviewVoices = [];
          window.Audio = function(...args) {
            const voice = new NativeAudio(...args);
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) {
              const context = new Ctx();
              const source = context.createMediaElementSource(voice);
              const analyser = context.createAnalyser(); analyser.fftSize = 8192;
              source.connect(analyser); analyser.connect(context.destination);
              const play = voice.play.bind(voice);
              voice.play = (...playArgs) => { context.resume(); return play(...playArgs); };
              voice.__qartonMeasure = () => {
                const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
                const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
                const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
                let peak = 0;
                for (let i = 1; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
                return { rms, frequency: peak * context.sampleRate / analyser.fftSize };
              };
              voice.__qartonAudioContext = context;
            }
            window.__qartonPreviewVoices.push(voice);
            return voice;
          };
        })();""")
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(preview.as_uri())
        page.wait_for_function("document.querySelector('#stage')?.width > 0")
        page.locator("#imageInput").set_input_files(str(image))
        page.wait_for_function("document.querySelector('#imageName').textContent.includes('preview-test.png')")
        page.locator('nav.bottom-dock [data-editor-section="more"]').click()
        page.locator("#advancedProjectOptions > summary").click()
        page.locator("#duration").press("Home")
        page.wait_for_function("document.querySelector('#integratedTo').value === '3000'")
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        page.locator(".advanced-audio-drawer > summary").click()
        add_button = page.locator("#addAudioClip")
        page.locator("#quickImportAudio").click()
        page.locator("#audioInput").set_input_files({"name": "corrupt.wav", "mimeType": "audio/wav", "buffer": b"not a valid WAV"})
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تعذر فك ترميز')", timeout=15000)
        assert page.locator("#audioTracks .audio-clip").count() == 0, "invalid bytes must not be added to the Timeline"
        page.locator("#audioInput").set_input_files(str(mp3))
        page.wait_for_function("document.querySelector('#audioTimelineMessage').textContent.includes('تم التحقق من الملف')", timeout=30000)
        assert not add_button.is_disabled(), "Add must become enabled after the selected MP3 is fully imported"
        assert "51.52" in page.locator("#audioFileName").inner_text(), page.locator("#audioFileName").inner_text()
        page.locator("#audioTrackType").select_option("music")
        touch_tap(page, add_button)
        page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1")
        assert page.locator("#audioClipDuration").input_value() == "3000", "a 51.52 second file must be clipped to the 3 second scene"
        assert "مدة 00:03.00" in page.locator("#audioTimelineMessage").inner_text(), page.locator("#audioTimelineMessage").inner_text()

        # The simplified actions import directly into their intended tracks.
        page.locator("#deleteSelectedAudio").click()
        with page.expect_file_chooser() as dialogue_picker:
            page.locator("#quickImportAudio").click()
        dialogue_picker.value.set_files(str(mp3))
        page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1", timeout=30000)
        assert page.locator("#audioSelection").inner_text().startswith("حوار"), page.locator("#audioSelection").inner_text()
        with page.expect_file_chooser() as music_picker:
            page.locator("#quickAddMusic").click()
        music_picker.value.set_files(str(mp3))
        page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 2", timeout=30000)
        assert page.locator("#audioSelection").inner_text().startswith("موسيقى"), page.locator("#audioSelection").inner_text()
        page.locator("#deleteSelectedAudio").click()
        page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1")
        print("Quick audio actions: dialogue import, music import, selection, and delete passed")
        if page.locator(".advanced-audio-drawer").get_attribute("open") is None:
            page.locator(".advanced-audio-drawer > summary").click()
        page.locator("#audioTracks .audio-clip").first.click()
        start_field = page.locator("#audioClipStart")
        start_field.fill("200")
        start_field.press("Enter")
        assert page.evaluate("document.activeElement?.id") == "audioClipStart", "editing should keep keyboard focus on the active timing field"

        touch_tap(page, page.locator("#playPauseButton"))
        page.wait_for_function("window.__qartonPreviewVoices.some(voice => !voice.paused && voice.currentTime > 0.2)", timeout=10000)
        preview_signal = page.evaluate("""() => {
          const voice = window.__qartonPreviewVoices.at(-1);
          const signal = voice.__qartonMeasure?.();
          voice.pause();
          return { ...signal, time: voice.currentTime, duration: voice.duration };
        }""")
        assert preview_signal["rms"] > 0.015 and abs(preview_signal["frequency"] - 660) < 35, preview_signal
        assert abs(preview_signal["duration"] - source_duration) < 0.15, preview_signal
        print(f"Long MP3 preview signal: duration={preview_signal['duration']:.3f}s, RMS={preview_signal['rms']:.4f}, tone={preview_signal['frequency']:.1f}Hz")

        with page.expect_download(timeout=15000) as project_download:
            page.locator("#saveProjectButton").evaluate("el => el.click()")
        project_path = temp / "qarton-audio-project.json"
        project_download.value.save_as(project_path)
        saved = json.loads(project_path.read_text())
        saved_tracks = saved.get("audioTracks", [])
        assert sum(len(track["clips"]) for track in saved_tracks) == 1, saved
        assert saved_tracks[1]["clips"][0]["durationMs"] == 3000, saved_tracks
        page.reload()
        page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1", timeout=20000)
        assert "استُعيد" in page.locator("#assetLibraryMessage").inner_text(), page.locator("#assetLibraryMessage").inner_text()
        page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
        touch_tap(page, page.locator("#audioTracks .audio-clip"))
        assert page.locator("#audioClipDuration").input_value() == "3000"

        touch_tap(page, page.locator("#playPauseButton"))
        page.wait_for_function("window.__qartonPreviewVoices.some(voice => !voice.paused && voice.currentTime > 0.2)", timeout=10000)
        restored_signal = page.evaluate("""() => {
          const voice = window.__qartonPreviewVoices.filter(item => !item.paused).at(-1);
          const signal = voice.__qartonMeasure?.(); voice.pause(); return signal;
        }""")
        assert restored_signal["rms"] > 0.015 and abs(restored_signal["frequency"] - 660) < 35, restored_signal

        page.locator('nav.bottom-dock [data-editor-section="more"]').click()
        page.locator(".export-options > summary").click()
        page.locator("#integratedFormat").select_option("webm")
        page.locator("#integratedAudio").select_option("mix")
        page.locator("#integratedQuality").select_option("480p")
        page.locator("#integratedProbeButton").click()
        page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') || !document.querySelector('#integratedError').hidden", timeout=30000)
        assert "تم التحقق فعليًا" in page.locator("#integratedStatus").inner_text(), page.locator("#integratedError").inner_text()
        page.locator("#integratedExportButton").click()
        page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') || !document.querySelector('#integratedError').hidden", timeout=45000)
        assert "اكتمل التصدير المتكامل" in page.locator("#integratedStatus").inner_text(), page.locator("#integratedError").inner_text()
        with page.expect_download(timeout=15000) as export_download:
            page.locator("#integratedDownload").click()
        output = temp / "long-mp3-three-second-scene.webm"
        export_download.value.save_as(output)
        streams = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)], text=True, timeout=60))
        assert sum(stream["codec_type"] == "video" for stream in streams["streams"]) == 1, streams
        assert sum(stream["codec_type"] == "audio" for stream in streams["streams"]) == 1, streams
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(output), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], timeout=60)
        decoded = array.array("f"); decoded.frombytes(raw)
        decoded_duration = len(decoded) / 48000
        assert abs(decoded_duration - 3) < 0.15, {"decodedAudioDuration": decoded_duration, "format": streams.get("format")}
        signal = decoded[int(0.5 * 48000):int(1.5 * 48000)]
        rms = math.sqrt(sum(value * value for value in signal) / len(signal))
        tone = dominant_tone(signal, 48000)
        assert rms > 0.015 and tone == 660, {"rms": rms, "tone": tone, "samples": len(signal)}
        print(f"Long MP3 exported signal: 51.52s source in 3s scene, decoded audio={decoded_duration:.3f}s, RMS={rms:.4f}, tone={tone}Hz")
        assert not page_errors, page_errors
        page.screenshot(path=str(artifacts / "long-mp3-recovered-project.png"), full_page=True)
        browser.close()
