"""Check the live HTTPS hosts without changing their deployment or access policy."""
import argparse
import base64
import json
from urllib.error import HTTPError
from urllib.request import urlopen

HOSTS = {
    "studio": "https://qarton-motion-studio-l13-preview.surescout32.chatgpt.site/",
    "lab": "https://qarton-audio-diagnostics-b2.surescout32.chatgpt.site/",
}
HEADERS = ("content-type", "permissions-policy", "content-security-policy", "x-frame-options")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVnQAAAAASUVORK5CYII="
)


def headers(response):
    return {key: response.get(key) for key in HEADERS}


def gate(url):
    try:
        response = urlopen(url, timeout=15)
    except HTTPError as failure:
        response = failure
    with response:
        body = response.read(200_000)
        return {
            "status": response.code,
            "sign_in_gate": b"Log in to access" in body or b"Sign in required" in body,
            "headers": headers(response.headers),
        }


def browser_checks(args):
    from playwright.sync_api import sync_playwright

    flags = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=flags if args.fake_mic else [])
        context = browser.new_context(
            storage_state=args.storage_state, viewport={"width": 390, "height": 844},
            is_mobile=True, has_touch=True,
        )
        for name, url in HOSTS.items():
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            response = page.goto(url, wait_until="load", timeout=30000)
            assert response and response.ok, f"{name}: authentication or HTTP failure"
            environment = page.evaluate("""async () => ({
                topLevel: window.top === window.self,
                secureContext: isSecureContext,
                microphonePolicy: (document.permissionsPolicy ?? document.featurePolicy)
                    ?.allowsFeature('microphone') ?? null,
                permission: await navigator.permissions.query({name:'microphone'})
                    .then(result => result.state, () => 'unknown')
            })""")
            print(json.dumps({"target": name, "environment": environment,
                              "headers": headers(response.headers)}))
            if name == "lab":
                page.locator("#tone").click()
                page.wait_for_function("JSON.parse(document.querySelector('#result').textContent).rms > 0.001",
                                       timeout=25000)
            else:
                page.locator("#quickRecordAudio").wait_for(state="attached")
                picker = page.locator('label[for="imageInput"]')
                if not picker.is_visible():
                    print("studio: restored project hides the primary image chooser")
                else:
                    with page.expect_file_chooser(timeout=5000) as chooser:
                        picker.click()
                    chooser.value.set_files({"name": "audit.png", "mimeType": "image/png", "buffer": PNG})
                    page.wait_for_selector('.studio[data-image-ready="true"]', state="attached")
                    assert picker.is_visible(), "image chooser disappeared after the first image loaded"
                    with page.expect_file_chooser(timeout=5000) as replacement:
                        picker.click()
                    replacement.value.set_files({"name": "replacement.png", "mimeType": "image/png", "buffer": PNG})
                    page.wait_for_function(
                        "document.querySelector('#imageName').textContent.includes('replacement.png')",
                        timeout=15000,
                    )
                    assert picker.is_visible(), "image chooser disappeared after replacing an image"
                    print("studio: PNG import and replacement succeeded; chooser remains visible")
                page.locator('[data-editor-section="audio"]').click()
                record = page.locator("#quickRecordAudio")
                assert record.is_visible(), "Audio tab did not reveal recording control"
                if args.fake_mic:
                    record.click()
                    page.wait_for_function(
                        "document.querySelector('#quickRecordAudio').textContent.includes('إيقاف')",
                        timeout=12000,
                    )
                    record.click()
                    page.wait_for_selector(".audio-clip", state="visible", timeout=20000)
            assert not errors, errors
            page.close()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--storage-state")
    parser.add_argument("--fake-mic", action="store_true")
    options = parser.parse_args()
    if options.storage_state:
        browser_checks(options)
    else:
        print(json.dumps({name: gate(url) for name, url in HOSTS.items()}, indent=2))
