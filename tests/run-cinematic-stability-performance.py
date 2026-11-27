"""Measure actual cinematic scene drawing and transition stability in Chromium."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "dist/motion-studio-v2-l14c3-android-preview/cinematic-stability-performance.json"
HTML = "/tests/cinematic-stability-performance.html"
DURATIONS = [int(value) for value in os.environ.get("QARTON_CINEMATIC_PERF_DURATIONS_MS", "30000,300000").split(",")]


def main():
    reports = []
    with ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler) as server, sync_playwright() as playwright:
        server.RequestHandlerClass.directory = str(ROOT)
        Thread(target=server.serve_forever, daemon=True).start()
        executable = os.environ.get("CHROMIUM_EXECUTABLE_PATH")
        browser = playwright.chromium.launch(executable_path=executable, args=["--enable-precise-memory-info"]) if executable else playwright.chromium.launch(args=["--enable-precise-memory-info"])
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(360_000)
        page.set_default_navigation_timeout(60_000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: print(message.text, flush=True) if message.text.startswith("PERF_PROGRESS|") else None)
        page.goto(f"http://127.0.0.1:{server.server_port}{HTML}", wait_until="load")
        page.wait_for_function("window.__QARTON_STABILITY_READY === true")
        for duration in DURATIONS:
            result = page.evaluate("duration => window.__QARTON_STABILITY.run(duration)", duration)
            if result["actualDurationMs"] < duration - 1000:
                raise AssertionError({"benchmark ended too early": result})
            if result["frames"] < duration // 500:
                raise AssertionError({"not enough frames sampled": result})
            if result["sceneTransitions"] < duration // 9000:
                raise AssertionError({"transition loop was not exercised": result})
            if result["decodedAssetBytes"]["total"] > 210 * 1024 * 1024:
                raise AssertionError({"decoded assets exceeded stability budget": result["decodedAssetBytes"]})
            if result["retainedDomCanvasCount"] != 1:
                raise AssertionError({"unexpected attached canvas growth": result["retainedDomCanvasCount"]})
            reports.append(result)
            print(f"Cinematic {duration} ms: {result['avgFps']} FPS, p95 {result['p95FrameTimeMs']} ms, slow >50 ms {result['slowFramesOver50Ms']}, estimated decoded assets {result['decodedAssetMiB']} MiB", flush=True)
        assert not errors, errors
        browser.close()
        server.shutdown()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({"browser": "Chromium headless", "device": "CI desktop; not Android device", "durations": reports}, indent=2))
    print(f"Wrote {REPORT.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
