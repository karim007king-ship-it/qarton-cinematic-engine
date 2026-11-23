from pathlib import Path
import os
from playwright.sync_api import sync_playwright

preview = Path("dist/cinematic-visual-effects-l9a/index.html").resolve()
if not preview.exists():
    raise SystemExit("Standalone preview was not generated")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_PATH") or None,
                                args=["--no-sandbox"] if os.environ.get("CHROMIUM_PATH") else [])
    page = browser.new_page(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(preview.as_uri(), wait_until="load")
    page.get_by_test_id("stage").wait_for()
    assert page.get_by_test_id("status").inner_text().startswith("جاهز")
    image0 = page.get_by_test_id("stage").screenshot()
    page.get_by_test_id("seek").fill("1450")
    assert "الوقت" in page.get_by_test_id("status").inner_text()
    image1 = page.get_by_test_id("stage").screenshot()
    assert image0 != image1, "seeking must visibly change the preview frame"
    page.get_by_test_id("play").click()
    assert page.get_by_test_id("status").inner_text() == "المشهد يعمل"
    page.wait_for_timeout(120)
    page.get_by_test_id("pause").click()
    assert page.get_by_test_id("status").inner_text() == "المشهد متوقف مؤقتًا"
    page.get_by_test_id("replay").click()
    assert page.get_by_test_id("status").inner_text() == "أُعيد المشهد من البداية"
    assert page.locator("canvas").evaluate("el => el.getContext('2d') !== null")
    assert not errors, errors
    browser.close()
