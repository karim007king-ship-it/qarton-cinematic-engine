"""Run the StudioSequenceV2 pixel fixture in a real Chromium browser."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from os import environ
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = "/tests/fixtures/studio-sequence-compositor.html"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def main():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
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
                    raise RuntimeError(f"Fixture returned HTTP {getattr(response, 'status', None)}")
                page.wait_for_function("document.querySelector('#result')?.textContent !== 'RUNNING'", timeout=15000)
                result = page.locator("#result").inner_text()
                if result != "PASS":
                    details = page.locator("#failure").inner_text()
                    raise AssertionError(f"Chromium compositor fixture failed: {details}")
                if page_errors:
                    raise AssertionError("Chromium page errors: " + " | ".join(page_errors))
                print("Chromium compositor pixel, boundary, determinism, and resource checks passed.")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
