"""Independent diagnostic smoke test; no editor or audio core mutations."""
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
import shutil
import threading
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        chrome = shutil.which("google-chrome") or shutil.which("chromium")
        options = {"executable_path": chrome} if chrome else {"channel": "chrome"}
        browser = p.chromium.launch(**options, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
        page = browser.new_page(viewport={"width": 390, "height": 844}, permissions=["microphone"], accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"http://127.0.0.1:{server.server_port}/examples/audio-diagnostics/")
        for button, source in [("tone", "synthetic"), ("mic", "mic")]:
            page.click("#" + button)
            page.wait_for_function("!document.querySelector('#tone').disabled", timeout=30000)
            result = json.loads(page.locator("#result").inner_text())
            assert result["source"] == source and result["status"] == "finalized", result
            assert result["decodedDurationMs"] > 4000 and result["rms"] > 0.001 and result["peak"] > 0.001, result
            print(source, result)
        page.click("#play")
        page.wait_for_function("document.querySelector('#log').textContent.includes('started')")
        page.evaluate("""async () => {
            localStorage.setItem('qarton-motion-studio-current-project','diagnostic-test');
            localStorage.setItem('qarton-motion-studio-sequence:diagnostic-test',JSON.stringify({
              audioMasterVolume:1,sequence:{assets:[{id:'a',kind:'audio',name:'test.webm',mimeType:'audio/webm',size:3}],
              scenes:[{id:'s',audioTracks:[{id:'t',volume:1,clips:[{asset:'a',startMs:0,durationMs:1000,volume:1}]}]}]}}));
            const db=await new Promise((r,j)=>{let q=indexedDB.open('qarton-motion-assets-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('assets');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
            await new Promise((r,j)=>{let t=db.transaction('assets','readwrite');t.objectStore('assets').put(new Blob(['bad'],{type:'audio/webm'}),['diagnostic-test','a']);t.oncomplete=r;t.onerror=j;});db.close();
        }""")
        page.click("#project")
        page.wait_for_function("!document.querySelector('#project').disabled")
        result = json.loads(page.locator("#snapshot").inner_text())
        assert result["committedClips"] == 1 and result["clipsWithoutLinkedBytes"] == 0, result
        page.click("#inspect")
        page.wait_for_function("!document.querySelector('#inspect').disabled")
        result = json.loads(page.locator("#result").inner_text())
        assert "decodeError" in result, result
        with page.expect_download() as download:
            page.click("#report")
        assert download.value.suggested_filename == "qarton-audio-diagnostics.json"
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
