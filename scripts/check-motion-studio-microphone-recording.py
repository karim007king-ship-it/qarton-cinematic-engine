"""Exercise MediaRecorder capture with a virtual microphone and verify real audio end-to-end."""
from base64 import b64decode
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from os import environ
import array
import json
import math
import struct
import shutil
import subprocess
import tempfile
import threading
import wave

from playwright.sync_api import sync_playwright


def dominant_tone(samples, sample_rate):
    scores = {}
    for frequency in (440, 660, 880):
        coefficient = 2 * math.cos(2 * math.pi * frequency / sample_rate)
        previous = previous2 = 0.0
        for value in samples:
            current = value + coefficient * previous - previous2
            previous2, previous = previous, current
        scores[frequency] = previous2 * previous2 + previous * previous - coefficient * previous * previous2
    return max(scores, key=scores.get)


def decode_pcm(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"
    ], timeout=60)
    samples = array.array("f")
    samples.frombytes(raw)
    assert len(samples), f"No decoded audio samples in {path}"
    return samples


def measure_signal(samples, start_seconds=0.2, duration_seconds=1.0):
    start = int(start_seconds * 48000)
    signal = samples[start:start + int(duration_seconds * 48000)]
    assert len(signal) > 4800, f"Signal window is too short: {len(signal)} samples"
    rms = math.sqrt(sum(value * value for value in signal) / len(signal))
    tone = dominant_tone(signal, 48000)
    return {"rms": rms, "toneHz": tone, "samples": len(signal)}


root = Path(__file__).resolve().parents[1]
slug = environ.get("MOTION_STUDIO_PREVIEW_SLUG", "motion-studio-l11h4-audio-recording-fix-android-preview")
preview = root / "dist" / slug / "index.html"
artifact_dir = root / "artifacts/motion-studio-l11h4-audio-recording-fix"
artifact_dir.mkdir(parents=True, exist_ok=True)
assert preview.is_file()

with tempfile.TemporaryDirectory(prefix="qarton-virtual-mic-") as directory:
    temp = Path(directory)
    fake_mic = temp / "virtual-mic-660hz.wav"
    sample_rate = 48_000
    with wave.open(str(fake_mic), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"".join(
            struct.pack("<h", int(12_000 * math.sin(2 * math.pi * 660 * index / sample_rate)))
            for index in range(sample_rate * 8)
        ))

    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            chromium_path = environ.get("CHROMIUM_EXECUTABLE_PATH") or shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
            browser_options = {"executable_path": chromium_path} if chromium_path else {"channel": "chrome"}
            browser = playwright.chromium.launch(**browser_options, args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={fake_mic}",
                "--autoplay-policy=no-user-gesture-required"
            ])
            context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                          is_mobile=True, has_touch=True, accept_downloads=True,
                                          permissions=["microphone"])
            context.add_init_script("""(() => {
              const NativeAudio = window.Audio;
              window.__qartonRecordedPreviewVoices = [];
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
                }
                window.__qartonRecordedPreviewVoices.push(voice);
                return voice;
              };
            })();""")
            page = context.new_page()
            page_errors = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.goto(f"{origin}/dist/{slug}/index.html")
            page.wait_for_function("document.querySelector('#stage')?.width > 0")
            assert page.evaluate("isSecureContext && !!navigator.mediaDevices?.getUserMedia"), "localhost must expose the secure microphone API"
            capabilities = page.evaluate("""() => ({
              webm: MediaRecorder.isTypeSupported('audio/webm;codecs=opus'),
              mp4: MediaRecorder.isTypeSupported('audio/mp4'),
              ogg: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus'),
              amr: MediaRecorder.isTypeSupported('audio/amr')
            })""")

            # Exercise every genuinely supported audio recording container with the virtual microphone.
            supported = []
            if capabilities["webm"]: supported.append("audio/webm;codecs=opus")
            if capabilities["mp4"]: supported.append("audio/mp4")
            if capabilities["ogg"]: supported.append("audio/ogg;codecs=opus")
            assert supported, f"Chromium exposes no supported audio MediaRecorder format: {capabilities}"
            for mime in supported:
                recording = page.evaluate("""async mime => {
                  const stream = await navigator.mediaDevices.getUserMedia({audio: true});
                  const recorder = new MediaRecorder(stream, {mimeType: mime});
                  const chunks = [];
                  const stopped = new Promise((resolve, reject) => {
                    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                    recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
                    recorder.onstop = async () => {
                      try {
                        const blob = new Blob(chunks, {type: recorder.mimeType || mime});
                        const bytes = new Uint8Array(await blob.arrayBuffer());
                        let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                        resolve({mime: blob.type, data: btoa(binary), size: blob.size});
                      } catch (error) { reject(error); }
                    };
                  });
                  recorder.start(200);
                  await new Promise(resolve => setTimeout(resolve, 1800));
                  recorder.stop();
                  const result = await stopped;
                  stream.getTracks().forEach(track => track.stop());
                  return result;
                }""", mime)
                suffix = "m4a" if recording["mime"].startswith("audio/mp4") else "ogg" if recording["mime"].startswith("audio/ogg") else "webm"
                path = temp / f"direct-{suffix}.{suffix}"
                path.write_bytes(b64decode(recording["data"]))
                assert 0 < recording["size"] <= 20 * 1024 * 1024, recording
                samples = decode_pcm(path)
                decoded_duration = len(samples) / 48000
                measured = measure_signal(samples)
                assert 1.4 < decoded_duration < 2.3, {"mime": recording["mime"], "duration": decoded_duration}
                assert measured["rms"] > 0.025 and abs(measured["toneHz"] - 660) < 35, {"mime": recording["mime"], **measured}
                print(f"Virtual mic {recording['mime']}: decoded={decoded_duration:.3f}s RMS={measured['rms']:.4f} tone={measured['toneHz']}Hz")

            # Import an image, make a 3s scene, and prepare a second scene to test scene locking.
            image = root / "examples/motion-studio-lab/preview-test.png"
            page.locator("#imageInput").set_input_files(str(image))
            page.wait_for_function("document.querySelector('#imageName').textContent.includes('preview-test.png')")
            page.locator('nav.bottom-dock [data-editor-section="more"]').click()
            page.locator("#advancedProjectOptions > summary").click()
            page.locator("#duration").press("Home")
            page.wait_for_function("document.querySelector('#integratedTo').value === '3000'")
            page.locator('nav.bottom-dock [data-editor-section="scenes"]').click()
            page.locator("#addSceneButton").click()
            page.wait_for_function("document.querySelectorAll('.scene-select').length === 2")
            page.locator(".scene-select").first.click()
            page.wait_for_function("document.querySelector('#sceneDuration').value === '3'")

            # Verify export capability before recording so the busy-state assertion is meaningful.
            page.locator('nav.bottom-dock [data-editor-section="more"]').click()
            page.locator(".export-options > summary").click()
            video_format = page.evaluate("""() => {
              if (['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].some(type => MediaRecorder.isTypeSupported(type))) return 'webm';
              if (['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].some(type => MediaRecorder.isTypeSupported(type))) return 'mp4';
              return null;
            }""")
            assert video_format, "Chromium must support either WebM or MP4 video export for signal verification"
            page.locator("#integratedFormat").select_option(video_format)
            page.locator("#integratedAudio").select_option("mix")
            page.locator("#integratedQuality").select_option("480p")
            page.locator("#integratedProbeButton").click()
            page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') || !document.querySelector('#integratedError').hidden", timeout=30000)
            assert "تم التحقق فعليًا" in page.locator("#integratedStatus").inner_text(), page.locator("#integratedError").inner_text()

            page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
            page.locator("#audioTrackType").select_option("music")
            record_button = page.locator(".microphone-record-button")
            record_button.click()
            page.wait_for_function("document.querySelector('.microphone-record-button').textContent === 'إيقاف التسجيل'", timeout=10000)
            assert page.locator(".scene-select").nth(1).is_disabled(), "scene switching must lock while recording"
            assert page.locator("#integratedExportButton").is_disabled(), "export must lock while recording"
            page.wait_for_timeout(1800)
            record_button.click()
            page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1", timeout=30000)
            clip = page.locator("#audioTracks .audio-clip")
            assert "recording-" in clip.inner_text(), clip.inner_text()
            duration_ms = int(page.locator("#audioClipDuration").input_value())
            assert 1400 <= duration_ms <= 2300, duration_ms
            assert "تم التحقق وإضافة التسجيل" in page.locator("#audioTimelineMessage").inner_text()
            print(f"Timeline auto-insert: duration={duration_ms}ms, supported audio MIME={supported}")

            # Persist project metadata and audio bytes, then verify that restored playback has a real signal.
            page.locator('nav.bottom-dock [data-editor-section="more"]').click()
            with page.expect_download(timeout=15000) as project_download:
                page.locator("#saveProjectButton").evaluate("el => el.click()")
            project_path = temp / "qarton-recorded-audio-project.json"
            project_download.value.save_as(project_path)
            saved_text = project_path.read_text()
            assert "recording-" in saved_text and "audio-clip-" in saved_text, "saved project must include the recorded clip and asset"
            page.reload()
            page.wait_for_function("document.querySelectorAll('#audioTracks .audio-clip').length === 1", timeout=25000)
            assert "استُعيد" in page.locator("#assetLibraryMessage").inner_text(), page.locator("#assetLibraryMessage").inner_text()
            page.locator('nav.bottom-dock [data-editor-section="audio"]').click()
            page.locator("#audioTracks .audio-clip").first.click()
            assert "recording-" in page.locator("#audioSelection").inner_text()
            page.locator("#playPauseButton").click()
            page.wait_for_function("window.__qartonRecordedPreviewVoices.some(voice => !voice.paused && voice.currentTime > 0.2)", timeout=10000)
            preview_signal = page.evaluate("""() => {
              const voice = window.__qartonRecordedPreviewVoices.filter(item => !item.paused).at(-1);
              const result = voice.__qartonMeasure(); voice.pause(); return result;
            }""")
            assert preview_signal["rms"] > 0.02 and abs(preview_signal["frequency"] - 660) < 40, preview_signal
            print(f"Restored preview signal: RMS={preview_signal['rms']:.4f} tone={preview_signal['frequency']:.1f}Hz")

            # Export both scenes, decode the file, and verify the recorded signal is present in its audio stream.
            page.locator('nav.bottom-dock [data-editor-section="more"]').click()
            page.locator(".export-options > summary").click()
            page.locator("#integratedProbeButton").click()
            page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('تم التحقق فعليًا') || !document.querySelector('#integratedError').hidden", timeout=30000)
            assert "تم التحقق فعليًا" in page.locator("#integratedStatus").inner_text(), page.locator("#integratedError").inner_text()
            page.locator("#integratedExportButton").click()
            page.wait_for_function("document.querySelector('#integratedStatus').textContent.includes('اكتمل التصدير المتكامل') || !document.querySelector('#integratedError').hidden", timeout=90000)
            assert "اكتمل التصدير المتكامل" in page.locator("#integratedStatus").inner_text(), page.locator("#integratedError").inner_text()
            with page.expect_download(timeout=15000) as export_download:
                page.locator("#integratedDownload").click()
            exported = temp / f"microphone-export.{video_format}"
            export_download.value.save_as(exported)
            streams = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(exported)], text=True, timeout=60))
            assert sum(stream["codec_type"] == "video" for stream in streams["streams"]) == 1, streams
            assert sum(stream["codec_type"] == "audio" for stream in streams["streams"]) == 1, streams
            exported_pcm = decode_pcm(exported)
            exported_duration = len(exported_pcm) / 48000
            assert 5.5 < exported_duration < 6.5, {"duration": exported_duration, "format": streams.get("format")}
            output_signal = measure_signal(exported_pcm, 0.3, 1.0)
            assert output_signal["rms"] > 0.015 and abs(output_signal["toneHz"] - 660) < 40, output_signal
            print(f"Export {video_format}: decoded audio={exported_duration:.3f}s RMS={output_signal['rms']:.4f} tone={output_signal['toneHz']}Hz")
            assert not page_errors, page_errors
            page.screenshot(path=str(artifact_dir / "microphone-recording-recovered-project.png"), full_page=True)
            browser.close()
    finally:
        server.shutdown()
