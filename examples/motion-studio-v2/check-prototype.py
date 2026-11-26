from pathlib import Path
from struct import pack
import zlib
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)
WIDTHS = (320, 360, 390, 412, 480)
SECTIONS = ("photos", "motion", "audio", "effects", "more")


def png_bytes(color=(190, 145, 67)):
    def chunk(kind, data):
        body = kind + data
        return pack(">I", len(data)) + body + pack(">I", zlib.crc32(body) & 0xffffffff)
    signature = b"\x89PNG\r\n\x1a\n"
    header = pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)
    pixels = bytes((0, *color, 255, *color, 255, 0, *color, 255, *color, 255))
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


PNG = png_bytes()

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in WIDTHS:
        page = browser.new_page(viewport={"width": width, "height": 800}, is_mobile=True, has_touch=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto((ROOT / "index.html").resolve().as_uri(), wait_until="load")
        page.wait_for_function("document.documentElement.dataset.prototypeReady === 'true'")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"horizontal overflow at {width}px"
        assert page.evaluate("document.documentElement.scrollHeight <= innerHeight"), f"vertical page scroll at {width}px"
        assert page.locator(".bottom-nav button").count() == 5
        assert page.locator("#previewStage").is_visible()
        assert page.evaluate("document.querySelector('#previewStage').clientHeight") > 300, f"preview too small at {width}px"
        if width in (320, 390, 480):
            page.screenshot(path=str(OUT / f"viewport-{width}.png"))
        if width == 390:
            page.locator("#chooseImageButton").click()
            page.locator("#imageInput").set_input_files({"name": "prototype.png", "mimeType": "image/png", "buffer": PNG})
            page.wait_for_function("document.querySelector('#previewImage').naturalWidth === 2")
            page.locator("#addSceneButton").click()
            assert page.locator(".scene-card").count() == 2
            for section in SECTIONS:
                page.locator(f'[data-section="{section}"]').click()
                page.locator(f'.panel-body[data-panel="{section}"]').wait_for(state="visible")
                assert page.locator("#sheetTitle").inner_text()
                assert page.evaluate("document.documentElement.scrollHeight <= innerHeight"), f"page scrolled while {section} panel was open"
                assert page.evaluate("Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).every(b => { const r=b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })"), f"touch target smaller than 44px at {width}px/{section}"
                page.screenshot(path=str(OUT / f"section-{section}.png"))
                if section == "audio":
                    page.locator("#audioInput").set_input_files({"name": "demo.wav", "mimeType": "audio/wav", "buffer": b"RIFFdemoWAVE"})
                    assert "demo.wav" in page.locator("#audioSelection").inner_text()
            page.locator("#playButton").click()
            assert page.locator("#studio").get_attribute("data-playing") == "true"
            page.locator("#stopButton").click()
            assert page.locator("#studio").get_attribute("data-playing") == "false"
        assert not errors, errors
        page.close()
    browser.close()
print("L14-A prototype checks passed at 320, 360, 390, 412, and 480px; section screenshots saved.")
