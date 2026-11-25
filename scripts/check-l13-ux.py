"""Audit actual baseline and exercise isolated prototype; no real microphone/export in prototype."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, shutil, threading
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
out = root / "artifacts/l13-ux"
out.mkdir(parents=True, exist_ok=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}"
sizes = [(320,568),(360,640),(390,844),(412,915),(480,960)]
sizes += [(h,w) for w,h in sizes[:]]
measurements=[]
try:
    with sync_playwright() as p:
        chrome=shutil.which("google-chrome") or shutil.which("chromium")
        browser=p.chromium.launch(**({"executable_path":chrome} if chrome else {"channel":"chrome"}))
        page=browser.new_page(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,accept_downloads=True)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(url+"/examples/motion-studio-lab/")
        page.wait_for_function("document.querySelector('.studio').dataset.editorMode === 'simple'")
        assert page.locator("#previewSceneStrip").is_hidden()
        page.locator('[data-editor-section="audio"]').click()
        assert page.locator(".studio").get_attribute("data-editor-mode") == "professional"
        page.locator('[data-editor-section="motion"]').click()
        assert page.locator(".studio").get_attribute("data-editor-mode") == "professional"
        page.locator('[data-editor-mode-button="simple"]').click()
        for w,h in sizes:
            page.set_viewport_size({"width":w,"height":h})
            for section in ("scenes","motion","audio","effects","more"):
                page.locator(f'[data-editor-section="{section}"]').click()
                data=page.evaluate("""() => {
                  const box=e=>{const r=e.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom)}};
                  const panel=document.querySelector('[data-tool-panel]:not([hidden])');
                  const visible=[...document.querySelectorAll('button,select,input:not(.sr-only)')].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && e.getBoundingClientRect().width>1);
                  return {viewport:[innerWidth,innerHeight],bodyOverflow:document.documentElement.scrollWidth>innerWidth,mode:document.querySelector('.studio').dataset.editorMode,drawer:box(panel),preview:box(document.querySelector('.studio-preview')),dock:box(document.querySelector('.bottom-dock')),scrollHeight:panel.scrollHeight,smallTargets:visible.filter(e=>{let r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.id||e.dataset.editorModeButton||e.dataset.editorSection||e.className),smallFonts:visible.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).length}
                }""")
                measurements.append({"app":"baseline","size":[w,h],"section":section,**data})
            page.screenshot(path=str(out/f"baseline-{w}x{h}.png"))
        assert not errors, errors
        page.goto(url+"/examples/motion-studio-l13-ux/")
        assert page.locator("#app").get_attribute("data-mode")=="simple"
        for w,h in sizes:
            page.set_viewport_size({"width":w,"height":h})
            print("prototype",w,h,page.evaluate("() => ({viewport:[innerWidth,innerHeight],app:document.querySelector('.app').getBoundingClientRect().toJSON(),work:document.querySelector('.work').getBoundingClientRect().toJSON(),dock:document.querySelector('.dock').getBoundingClientRect().toJSON()})"),flush=True)
            for section in ("scenes","motion","audio","characters","effects","project"):
                page.locator(f'[data-tab="{section}"]').click()
                data=page.evaluate("""() => {
                  const box=e=>{const r=e.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom)}};
                  const drawer=document.querySelector('.drawer'),dock=document.querySelector('.dock');
                  const visible=[...document.querySelectorAll('.dock button,.top button,.transport button')];
                  return {viewport:[innerWidth,innerHeight],bodyOverflow:document.documentElement.scrollWidth>innerWidth,drawer:box(drawer),preview:box(document.querySelector('.viewer')),dock:box(dock),scrollHeight:drawer.scrollHeight,smallTargets:visible.filter(e=>{let r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9}).map(e=>e.id||e.dataset.tab),panels:[...document.querySelectorAll('[data-panel]:not([hidden])')].length}
                }""")
                measurements.append({"app":"prototype","size":[w,h],"section":section,**data})
                assert data["viewport"]==[w,h] and not data["bodyOverflow"] and data["dock"]["bottom"]<=h+1 and data["drawer"]["height"]>40 and data["panels"]==1 and not data["smallTargets"],data
                assert page.locator("#app").get_attribute("data-mode")=="simple"
            page.locator('[data-tab="audio"]').click()
            page.screenshot(path=str(out/f"prototype-{w}x{h}.png"))
        page.set_viewport_size({"width":390,"height":844})
        page.locator('[data-tab="scenes"]').click()
        assert page.locator("#deleteScene").is_disabled()
        page.click("#addScene")
        assert page.locator("[data-scene]").count()==2
        page.fill("#sceneName","لقطة ثانية")
        page.locator("#sceneName").press("Tab")
        page.click("#duplicate")
        assert page.locator("[data-scene]").count()==3
        page.click("#previous")
        page.click("#deleteScene")
        assert page.locator("[data-scene]").count()==2
        page.click("#undo")
        assert page.locator("[data-scene]").count()==3
        page.locator("#imageFile").set_input_files(str(root/"examples/motion-studio-lab/preview-test.png"))
        page.wait_for_function("document.querySelector('#frame').classList.contains('has-image')")
        page.locator('[data-tab="motion"]').click()
        page.locator('[data-motion="تقريب"]').click()
        page.click("#play")
        page.wait_for_timeout(300)
        assert float(page.locator("#seek").input_value())>0
        page.click("#restart")
        assert float(page.locator("#seek").input_value())==0
        page.locator('[data-tab="audio"]').click()
        page.click("#record")
        assert page.locator("#addScene").is_disabled() and page.locator("#export").is_disabled()
        page.wait_for_timeout(200)
        assert float(page.locator("#level").get_attribute("value"))>0
        page.click("#record")
        assert page.locator("#clips button").count()==1 and page.locator("#playClip").is_enabled()
        page.click("#playClip")
        assert "محاكاة" in page.locator("#status").inner_text()
        page.click("#music")
        assert page.locator("#clips button").count()==2
        page.click("#deleteClip")
        assert page.locator("#clips button").count()==1
        page.locator('[data-tab="characters"]').click()
        page.locator('[data-character="رمش"]').click()
        assert "رمش" in page.locator("#characterStatus").inner_text()
        page.locator('[data-tab="effects"]').click()
        page.locator('[data-effect="تظليل"]').click()
        assert page.locator('[data-effect="تظليل"]').get_attribute("aria-pressed")=="true"
        page.locator('[data-tab="project"]').click()
        page.click("#pro")
        page.locator('[data-tab="motion"]').click()
        assert page.locator("#addKey").is_visible()
        page.click("#addKey")
        page.locator('[data-tab="project"]').click()
        page.click("#saveLocal")
        page.click("#openLocal")
        with page.expect_download() as d:
            page.click("#json")
        assert d.value.suggested_filename=="qarton-l13-demo.json"
        page.click("#export")
        page.click("#startExport")
        assert page.locator("#record").is_disabled()
        page.wait_for_function("document.querySelector('#progress').value===100")
        assert "لا يوجد ملف فيديو" in page.locator("#exportState").inner_text()
        page.click("#closeModal")
        assert page.locator("#modal").is_hidden()
        assert not errors,errors
        browser.close()
finally:
    (out/"measurements.json").write_text(json.dumps(measurements,ensure_ascii=False,indent=2))
    server.shutdown()
print(f"PASS: {len(measurements)} layout measurements; baseline observed, prototype asserted; simulated editing workflow")
