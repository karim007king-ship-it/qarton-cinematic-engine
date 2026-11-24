"""Run StudioSequenceV2 OfflineAudioContext measurements in real Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from os import environ
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = "/tests/fixtures/studio-sequence-audio-crossfade.html"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            executable = environ.get("CHROMIUM_EXECUTABLE_PATH")
            browser = (playwright.chromium.launch(executable_path=executable) if executable
                       else playwright.chromium.launch(channel="chrome"))
            try:
                page = browser.new_page()
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                response = page.goto(f"http://127.0.0.1:{server.server_port}{FIXTURE}", wait_until="load")
                if response is None or response.status != 200:
                    raise RuntimeError(f"Audio fixture returned HTTP {getattr(response, 'status', None)}")
                page.wait_for_function("document.querySelector('#result')?.textContent !== 'RUNNING'", timeout=30000)
                result = page.locator("#result").inner_text()
                if result != "PASS":
                    raise AssertionError("Chromium OfflineAudioContext fixture failed: " + page.locator("#failure").inner_text())
                if page_errors:
                    raise AssertionError("Chromium page errors: " + " | ".join(page_errors))
                print("Chromium OfflineAudioContext RMS, frequency, peak, and transition-boundary checks passed.")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
