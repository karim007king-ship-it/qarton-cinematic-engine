from pathlib import Path
from os import environ
from shutil import which
from playwright.sync_api import sync_playwright

preview = Path("dist/cinematic-audio-l8a-android-preview/index.html").resolve()
assert preview.is_file(), "standalone preview was not built"
with sync_playwright() as playwright:
    executable = environ.get("CHROMIUM_EXECUTABLE_PATH") or which("chromium")
    browser = playwright.chromium.launch(executable_path=executable) if executable else playwright.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(preview.as_uri(), wait_until="load")
    assert page.title() == "مختبر الصوت السينمائي — QARTON"
    assert page.evaluate("window.isSecureContext")
    assert page.evaluate("Boolean(window.AudioContext || window.webkitAudioContext)")
    page.locator("#seek").evaluate("el => { el.value = '800'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#character").get_attribute("data-viseme") == "open"
    assert "phoneme: a" in page.locator("#visemeLabel").inner_text()
    page.locator("#seek").evaluate("el => { el.value = '600'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#character").get_attribute("data-viseme") == "closed"
    page.locator("#seek").evaluate("el => { el.value = '400'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#character").get_attribute("data-viseme") == "rest"
    page.locator("#seek").evaluate("el => { el.value = '1700'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#character").get_attribute("data-viseme") == "closed"
    page.locator("#playButton").click()
    page.wait_for_function("window.cinematicAudioLab.player.state === 'playing'")
    assert page.locator("#status").inner_text().find("يعمل") >= 0
    page.locator("#pauseButton").click()
    assert page.evaluate("window.cinematicAudioLab.player.state") == "paused"
    assert page.evaluate("window.cinematicAudioLab.player.activeVoiceCount") == 0
    page.locator("#replayButton").click()
    page.wait_for_function("window.cinematicAudioLab.player.state === 'playing'")
    page.locator("#masterVolume").evaluate("el => { el.value = '0.4'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert not errors, errors
    browser.close()
print("Chromium Android-size preview checks passed")
