"""Open the standalone Android artifact from file:// in Chromium."""
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    page_path = Path("dist/qarton-character-animation-l7a-android-preview/index.html").resolve()
    assert page_path.is_file(), page_path
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(page_path.as_uri())
        page.wait_for_function("document.querySelector('#stage')?.dataset.scene === 'greeting'")

        def seek(milliseconds):
            page.locator("#seek").evaluate("""(slider, value) => {
                slider.value = String(value);
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }""", milliseconds)
            page.wait_for_function("value => +document.querySelector('#character').dataset.time === value",
                                   arg=milliseconds)

        seek(1000)
        pose = page.locator("#character").evaluate("el => [el.dataset.headRotation, el.dataset.blink, el.dataset.mouthOpen]")
        seek(0)
        seek(1000)
        assert page.locator("#character").evaluate(
            "el => [el.dataset.headRotation, el.dataset.blink, el.dataset.mouthOpen]") == pose
        page.locator("#switch").click()
        assert page.locator("#stage").get_attribute("data-scene") == "night"
        assert page.locator("#character").count() == 1
        assert not errors, errors
        browser.close()
    print("Standalone file:// Android preview passed Chromium checks.", flush=True)


if __name__ == "__main__":
    main()
