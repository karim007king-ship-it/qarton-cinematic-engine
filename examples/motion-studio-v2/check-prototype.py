from pathlib import Path
from struct import pack
import os
import sys
import tempfile
import zlib

from playwright.sync_api import sync_playwright

from build_standalone import BuildError, build_bundle


ROOT = Path(__file__).parent
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)
WIDTHS = (320, 360, 390, 412, 480)
SECTIONS = ("photos", "motion", "audio", "effects", "more")
COMMIT = os.environ.get("L14_COMMIT", "e28b7a6").lower()
if not COMMIT or any(char not in "0123456789abcdef" for char in COMMIT):
    raise AssertionError(f"invalid commit SHA for test: {COMMIT!r}")
COMMIT = COMMIT[:40]


def png_bytes(color=(190, 145, 67)):
    def chunk(kind, data):
        body = kind + data
        return pack(">I", len(data)) + body + pack(">I", zlib.crc32(body) & 0xffffffff)
    signature = b"\x89PNG\r\n\x1a\n"
    header = pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)
    pixels = bytes((0, *color, 255, *color, 255, 0, *color, 255, *color, 255))
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def assert_build_rejects_missing_assets(source_html, css, js):
    try:
        build_bundle(source_html, "", js, COMMIT)
    except BuildError:
        pass
    else:
        raise AssertionError("standalone build accepted missing CSS/design")
    try:
        build_bundle(source_html, css, "", COMMIT)
    except BuildError:
        pass
    else:
        raise AssertionError("standalone build accepted missing JavaScript")


source_html = (ROOT / "index.html").read_text(encoding="utf-8")
source_css = (ROOT / "app.css").read_text(encoding="utf-8")
source_js = (ROOT / "app.js").read_text(encoding="utf-8")
assert_build_rejects_missing_assets(source_html, source_css, source_js)
BUNDLE = ROOT / "dist" / "qarton-motion-studio-v2.html"
BUNDLE.parent.mkdir(exist_ok=True)
BUNDLE.write_text(build_bundle(source_html, source_css, source_js, COMMIT), encoding="utf-8")
assert "<style id=\"motionStudioV2Style\">" in BUNDLE.read_text(encoding="utf-8")
assert "<script id=\"motionStudioV2Script\">" in BUNDLE.read_text(encoding="utf-8")
assert "./app.css" not in BUNDLE.read_text(encoding="utf-8")
assert "./app.js" not in BUNDLE.read_text(encoding="utf-8")

PNG = png_bytes()

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in WIDTHS:
        page = browser.new_page(viewport={"width": width, "height": 800}, is_mobile=True, has_touch=True)
        errors = []
        external_requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: external_requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
        page.route("https://**/*", lambda route: route.abort())
        page.goto(BUNDLE.resolve().as_uri(), wait_until="load")
        page.wait_for_function("document.documentElement.dataset.prototypeReady === 'true'")
        assert page.locator("#commitIndicator").inner_text() == "Commit " + COMMIT[:7]
        assert page.evaluate("getComputedStyle(document.body).color") == "rgb(247, 243, 234)", "bundled CSS did not apply"
        assert page.evaluate("getComputedStyle(document.querySelector('#studio')).display") == "grid", "studio layout CSS is missing"
        assert not external_requests, f"standalone file made external requests: {external_requests}"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"horizontal overflow at {width}px"
        assert page.evaluate("document.documentElement.scrollHeight <= innerHeight"), f"vertical page scroll at {width}px"
        assert page.locator(".bottom-nav button").count() == 5
        assert page.locator("#previewStage").is_visible()
        assert page.evaluate("Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).every(b => { const r=b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })"), f"touch target smaller than 44px at {width}px"
        assert page.evaluate("document.querySelector('#previewStage').clientHeight") > 300, f"preview too small at {width}px"
        if width in (320, 390, 480):
            page.screenshot(path=str(OUT / f"viewport-{width}.png"))
        if width == 390:
            page.locator("#chooseImageButton").click()
            page.locator("#imageInput").set_input_files({"name": "prototype.png", "mimeType": "image/png", "buffer": PNG})
            page.wait_for_function("document.querySelector('#previewImage').naturalWidth === 2")
            assert page.locator("#replaceImageButton").is_visible()
            page.locator("#replaceImageButton").click()
            page.locator("#imageInput").set_input_files({"name": "replacement.png", "mimeType": "image/png", "buffer": PNG})
            assert page.locator("#previewLabel").inner_text() == "replacement.png"
            page.locator("#addSceneButton").click()
            assert page.locator(".scene-card").count() == 2
            page.locator(".scene-card").nth(1).click()
            assert page.locator(".scene-card").nth(1).get_attribute("aria-pressed") == "true"
            for section in SECTIONS:
                page.locator(f'[data-section="{section}"]').click()
                page.locator(f'.panel-body[data-panel="{section}"]').wait_for(state="visible")
                assert page.locator("#sheetTitle").inner_text()
                assert page.evaluate("document.documentElement.scrollHeight <= innerHeight"), f"page scrolled while {section} panel was open"
                assert page.evaluate("Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).every(b => { const r=b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })"), f"touch target smaller than 44px at {width}px/{section}"
                page.screenshot(path=str(OUT / f"section-{section}.png"))
                if section == "photos":
                    page.locator("#fitImageButton").click()
                    assert page.locator("#previewImage").evaluate("(image) => image.style.objectFit == 'contain'")
                if section == "motion":
                    page.locator('[data-motion-preset="zoom"]').click()
                    assert page.locator("#studio").get_attribute("data-motion") == "zoom"
                if section == "audio":
                    page.locator("#chooseAudioButton").click()
                    page.locator("#audioInput").set_input_files({"name": "demo.wav", "mimeType": "audio/wav", "buffer": b"RIFFdemoWAVE"})
                    assert "demo.wav" in page.locator("#audioSelection").inner_text()
                    page.locator("#demoRecordButton").click()
                    assert "غير مفعّل" in page.locator("#toast").inner_text()
                if section == "effects":
                    page.locator('[data-effect="warm"]').click()
                    assert page.locator("#studio").get_attribute("data-effect") == "warm"
            page.locator("#closeSheetButton").click()
            page.locator("#playButton").click()
            assert page.locator("#studio").get_attribute("data-playing") == "true"
            page.locator("#stopButton").click()
            assert page.locator("#studio").get_attribute("data-playing") == "false"
            page.locator("#undoButton").click()
            assert "غير مربوط" in page.locator("#toast").inner_text()
            page.locator("#saveButton").click()
            assert "غير مربوط" in page.locator("#toast").inner_text()
            page.locator("#exportButton").click()
            assert "غير مفعّل" in page.locator("#toast").inner_text()
            page.locator("#fullscreenButton").click()
            page.wait_for_timeout(50)
            assert page.evaluate("Boolean(document.fullscreenElement)") or page.locator("#toast").is_visible()
            page.evaluate("if (document.fullscreenElement) document.exitFullscreen()")
        assert not errors, errors
        page.close()
    browser.close()
print(f"L14-A standalone offline checks passed at {WIDTHS}; commit {COMMIT[:7]}; missing CSS/JS rejection verified.")
