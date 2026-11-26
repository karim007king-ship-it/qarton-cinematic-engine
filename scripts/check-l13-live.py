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
                buildCommit: document.querySelector('#buildCommitBadge')?.dataset.buildCommit ?? null,
                runtime: window.QARTON_DIAGNOSTICS?.snapshot?.() ?? null,
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
                page.wait_for_function("window.QARTON_DIAGNOSTICS?.snapshot?.().phase === 'ready'", timeout=15000)
                assert page.locator("#buildCommitBadge").is_visible(), "published build commit is not visible"
                assert page.locator("#buildCommitBadge").get_attribute("data-build-commit"), "published build commit is empty"
                assert page.locator("#runtimeDiagnostics").is_hidden(), "JavaScript or resource errors were reported at startup"
                picker = page.locator('label[for="imageInput"]')
                assert picker.is_visible(), "primary image picker is missing or hidden in the published HTTPS app"
                image_input = page.locator("#imageInput")
                image_input.set_input_files({"name": "audit-first.png", "mimeType": "image/png", "buffer": PNG})
                page.wait_for_function("document.querySelector('#imageName').textContent.includes('audit-first.png')", timeout=15000)
                assert picker.is_visible(), "image picker disappeared after the first image loaded"
                image_input.set_input_files({"name": "audit-replacement.png", "mimeType": "image/png", "buffer": PNG})
                page.wait_for_function("document.querySelector('#imageName').textContent.includes('audit-replacement.png')", timeout=15000)
                assert picker.is_visible(), "image picker disappeared after image replacement"
                image_input.dispatch_event("cancel")
                assert "audit-replacement.png" in page.locator("#imageName").inner_text(), "cancelling the picker changed the active image"
                corrupt_before = page.locator(".asset-entry").count()
                image_input.set_input_files({"name": "broken.png", "mimeType": "image/png", "buffer": b"not a decodable PNG"})
                page.wait_for_timeout(300)
                assert "audit-replacement.png" in page.locator("#imageName").inner_text(), "corrupt image replaced the previous image"
                assert page.locator(".asset-entry").count() == corrupt_before, "corrupt image created an orphan asset"
                print("studio: first image, replacement, cancellation, corrupt-image rollback passed")
                page.locator('[data-editor-section="scenes"]').click()
                page.locator("#addSceneButton").click()
                assert page.locator(".scene-card").count() >= 2, "Add Scene failed on the published app"
                page.locator("#duplicateSceneButton").click()
                assert page.locator(".scene-card").count() >= 3, "Duplicate Scene failed on the published app"
                page.locator("#deleteSceneButton").click()
                assert page.locator(".scene-card").count() >= 2, "Delete Scene failed on the published app"
                page.locator('[data-editor-section="motion"]').click()
                assert page.locator("#motionStrength").is_visible(), "Motion tab failed on the published app"
                page.locator("#motionStrength").fill("65")
                page.locator('[data-editor-section="effects"]').click()
                page.locator("#visualEffectType").select_option("fade")
                page.locator("#addVisualEffect").click()
                assert page.locator(".visual-effect-clip").count() == 1, "Effects timeline failed on the published app"
                with page.expect_download(timeout=10000) as project_download:
                    page.locator("#saveProjectButton").click()
                assert project_download.value.suggested_filename.endswith(".json"), "project save did not produce JSON"
                page.locator("#headerExportButton").click()
                probe = page.locator("#integratedProbeButton")
                assert probe.is_visible(), "Export tab failed on the published app"
                probe.click()
                page.wait_for_function(
                    "document.querySelector('#integratedStatus').textContent && !document.querySelector('#integratedStatus').textContent.startsWith('جارٍ فحص')",
                    timeout=45000,
                )
                export_status = page.locator("#integratedStatus").inner_text()
                assert export_status, "published app returned no export capability result"
                export_button = page.locator("#integratedExportButton")
                if not export_button.is_disabled():
                    export_button.click()
                    page.wait_for_function("!document.querySelector('#integratedDownload').hidden", timeout=90000)
                    page.wait_for_function("document.querySelector('#integratedVideo').readyState >= 1", timeout=30000)
                print(json.dumps({"target": "studio-export-probe", "status": export_status,
                                  "exportEnabled": not export_button.is_disabled()}))
                page.locator('[data-editor-section="audio"]').click()
                record = page.locator("#quickRecordAudio")
                assert record.is_visible(), "Audio tab did not reveal recording control"
                before_mic = page.evaluate("QARTON_DIAGNOSTICS.snapshot().microphone")
                record.click()
                page.wait_for_function("QARTON_DIAGNOSTICS.snapshot().microphone.getUserMediaCalls > 0", timeout=5000)
                mic = page.evaluate("QARTON_DIAGNOSTICS.snapshot().microphone")
                assert mic["clickCount"] > before_mic["clickCount"], "record tap did not reach the recording handler"
                assert mic["policyAllows"] is not None, "browser did not expose an actual microphone policy verdict"
                print(json.dumps({"target": "studio-microphone-click", "diagnostics": mic}))
                if args.fake_mic:
                    page.wait_for_function("document.querySelector('#quickRecordAudio').textContent.includes('إيقاف')", timeout=12000)
                    record.click()
                    page.wait_for_selector(".audio-clip", state="visible", timeout=20000)
            assert not errors, errors
            if name == "studio":
                runtime = page.evaluate("QARTON_DIAGNOSTICS.snapshot()")
                assert runtime["phase"] == "ready" and runtime["buttonBindingsInitialized"], runtime
                assert not runtime["errors"], runtime["errors"]
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
