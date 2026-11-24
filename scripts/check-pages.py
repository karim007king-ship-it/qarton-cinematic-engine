"""Exercise the staged Pages site in desktop and touch Chromium contexts."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from os import environ
from pathlib import Path
import re
import struct
from threading import Thread
import zlib

from playwright.sync_api import sync_playwright


def exercise(context, url):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: errors.append(f"{response.status} {response.url}")
            if response.status >= 400 else None)
    page.goto(url)
    page.get_by_role("link", name="افتح تجربة المحرك").click()
    page.wait_for_selector(".qarton-character img")
    for control, scene in [("scene-two", "dusk"), ("scene-one", "dawn")]:
        page.locator(f"#{control}").click()
        page.get_by_text(f"Scene {scene} active", exact=False).wait_for()

    page.locator("#audio").click()
    page.get_by_text("Audio cues started", exact=False).wait_for()
    page.wait_for_function("""() => {
        const characters = [...document.querySelectorAll('.qarton-character')];
        const stage = document.querySelector('#stage').getBoundingClientRect();
        return characters.length === 2 && characters.every(character => {
            const rect = character.getBoundingClientRect();
            return character.dataset.state === 'idle'
                && ['determined', 'alert'].includes(character.dataset.expression)
                && rect.left >= stage.left && rect.right <= stage.right
                && rect.top >= stage.top && rect.bottom <= stage.bottom
                && character.firstChild.naturalWidth > 0;
        });
    }""")
    page.locator("#destroy").click()
    page.get_by_text("Destroyed: animation loop", exact=False).wait_for()
    assert page.locator(".qarton-character, .qarton-scene").count() == 0
    page.goto(url)
    page.get_by_role("link", name="جرّب مشهد المرصد").click()
    for attempt in range(2):
        if attempt:
            page.locator("#play").click()
        page.get_by_text("المشهد جاهز", exact=True).wait_for()
        page.wait_for_selector('[data-expression="greeting"][data-state="idle"]')
        assert page.locator(".qarton-layer img").count() == 2
        assert page.locator("#stage img").evaluate_all(
            "(images) => images.every(image => image.complete && image.naturalWidth > 0)")
        assert page.locator(".camera").evaluate("(el) => el.style.transform.includes('scale(')")
        assert page.locator('[data-layer-id="ridge"]').evaluate("(el) => !!el.style.transform")
        assert page.locator(".qarton-character").evaluate("""el => {
            const r = el.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
            return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom;
        }""")
    page.locator("#stop").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert page.locator("#stage img").count() == 0
    page.goto(url)
    page.get_by_role("link", name="مختبر حركة الشخصيات").click()
    actor = page.locator(".qarton-character")
    seek = page.locator("#seek")
    def sample(ms, filename, label):
        seek.evaluate("""(slider, value) => {
            slider.value = value;
            slider.dispatchEvent(new Event('input', {bubbles: true}));
        }""", ms)
        page.wait_for_function("""file => {
            const img = document.querySelector('.qarton-character img');
            return img?.src.endsWith('/' + file) && img.complete && img.naturalWidth > 0;
        }""", arg=filename)
        assert page.locator("#status").inner_text() == label

    page.wait_for_function("!document.querySelector('#seek').disabled")
    sample(1250, "walk-1.svg", "مشي")
    sample(1900, "walk-1-blink.svg", "مشي")
    sample(3400, "gesture-1.svg", "تحيّة")
    pose = page.locator("#camera").get_attribute("style")
    sample(1250, "walk-1.svg", "مشي")
    assert page.locator("#camera").get_attribute("style") != pose
    page.locator("#toggle").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 1350")
    page.locator("#toggle").click()
    page.get_by_role("button", name="تشغيل", exact=True).wait_for()
    paused = seek.input_value()
    page.wait_for_timeout(120)
    assert seek.input_value() == paused
    page.locator("#switch").click()
    page.wait_for_selector('#stage[data-scene="evening"] .qarton-character')
    assert actor.count() == 1 and seek.input_value() == "0"
    page.locator("#close").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert actor.count() == 0
    page.emulate_media(reduced_motion="reduce")
    page.reload()
    page.wait_for_function("!document.querySelector('#seek').disabled")
    sample(1900, "walk-0.svg", "مشي")
    assert not page.evaluate("""performance.getEntriesByType('resource')
        .some(entry => entry.name.includes('-blink.svg'))""")
    page.emulate_media(reduced_motion="no-preference")
    page.add_init_script("""window.labTones = 0;
        window.labContexts = [];
        window.AudioContext = class extends AudioContext {
            constructor(...args) { super(...args); window.labContexts.push(this); }
        };
        const start = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function(...args) {
            window.labTones++;
            return start.apply(this, args);
        };""")
    page.goto(url)
    page.get_by_role("link", name="إشارة من المرصد").click()
    page.wait_for_function("!document.querySelector('#play').disabled")
    def move_to(ms):
        page.locator("#seek").evaluate("""(el, t) => {
            el.value = t; el.dispatchEvent(new Event('input', {bubbles:true}));
        }""", ms)
        page.wait_for_function("t => +document.querySelector('.camera').dataset.time === t", arg=ms)

    move_to(1900)
    assert page.locator(".cast img").get_attribute("src").endswith("walk-1-blink.svg")
    assert page.locator(".qarton-layer img").count() == 2
    camera = page.locator(".camera").evaluate("e => e.style.transform")
    ridge = page.locator('[data-layer-id="ridge"]').evaluate("e => e.style.transform")
    move_to(800)
    assert page.locator(".camera").evaluate("e => e.style.transform") != camera
    assert page.locator('[data-layer-id="ridge"]').evaluate("e => e.style.transform") != ridge
    assert page.evaluate("labTones") == 0
    page.locator("#play").click()
    page.wait_for_function("labTones === 1")
    page.locator("#pause").click()
    page.get_by_role("button", name="استئناف").wait_for()
    frozen = page.locator(".camera").get_attribute("data-time")
    page.wait_for_timeout(150)
    assert page.locator(".camera").get_attribute("data-time") == frozen
    move_to(3400)
    assert "تحيّة" in page.locator("#status").inner_text()
    assert page.evaluate("labTones") == 1
    page.locator("#replay").click()
    page.wait_for_function("+document.querySelector('.camera').dataset.time < 500")
    page.locator("#switch").click()
    page.get_by_text("ضوء القمر · وقوف", exact=True).wait_for()
    assert page.locator(".camera").count() == 1
    assert page.locator(".camera").get_attribute("data-time") == "0"
    assert page.locator(".cast img").count() == 1
    page.wait_for_function("labContexts.length === 1 && labContexts[0].state === 'closed'")
    page.locator("#play").click()
    page.wait_for_function("labContexts.length === 2 && labContexts[1].state === 'running'")
    page.locator("#close").click()
    page.get_by_text("تم إغلاق المشهد", exact=True).wait_for()
    assert page.locator("#stage img").count() == 0
    assert page.evaluate("labContexts.every(context => context.state === 'closed')")
    page.emulate_media(reduced_motion="reduce")
    page.reload()
    page.wait_for_function("!document.querySelector('#play').disabled")
    camera = page.locator(".camera").evaluate("e => e.style.transform")
    move_to(1900)
    assert page.locator(".camera").evaluate("e => e.style.transform") == camera
    assert page.locator(".cast img").get_attribute("src").endswith("walk-0.svg")

    page.add_init_script("""(() => {
        const nativeCreateImageBitmap = window.createImageBitmap.bind(window);
        window.labBitmapCalls = [];
        window.createImageBitmap = async (source, ...options) => {
            if (source?.name === 'preview-test-slow.png')
                await new Promise(resolve => setTimeout(resolve, 700));
            const bitmap = await nativeCreateImageBitmap(source, ...options);
            window.labBitmapCalls.push({name: source?.name, options: options[0] || {}, width: bitmap.width, height: bitmap.height});
            return bitmap;
        };
    })();""")
    page.goto(url + "examples/motion-studio-lab/")
    export_support = page.evaluate("""() => {
        const Recorder = window.MediaRecorder;
        const candidates = {
            mp4: ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'],
            webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        };
        const available = Object.fromEntries(Object.entries(candidates).map(([format, values]) =>
            [format, !!Recorder && values.some(type => { try { return Recorder.isTypeSupported(type); } catch { return false; } })]));
        return {available, selected: document.querySelector('#exportFormat').value,
                disabled: Object.fromEntries(['mp4', 'webm'].map(format => [format,
                    document.querySelector(`#exportFormat option[value=${format}]`).disabled]))};
    }""")
    assert export_support["available"]["mp4"] or export_support["available"]["webm"]
    assert export_support["selected"] == ("mp4" if export_support["available"]["mp4"] else "webm")
    assert export_support["disabled"]["mp4"] == (not export_support["available"]["mp4"])
    assert export_support["disabled"]["webm"] == (not export_support["available"]["webm"])
    assert page.locator("#exportButton").is_disabled()
    image_input = page.locator("#imageInput")
    image_input.set_input_files(str(site / "examples/motion-studio-lab/preview-large.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert "preview-large.png" in page.locator("#imageName").inner_text()
    large_decode = page.evaluate("labBitmapCalls.find(call => call.name === 'preview-large.png')")
    assert large_decode and large_decode["options"].get("resizeWidth") == 1280
    assert large_decode["width"] * large_decode["height"] <= 2_621_440
    assert large_decode["width"] <= 2048 and large_decode["height"] <= 2048
    native_project = re.search(r"(\d+) × (\d+) · معاينة (\d+) × (\d+)", page.locator("#viewportValue").evaluate("el => el.textContent"))
    assert native_project
    assert abs(int(native_project.group(1)) / int(native_project.group(2)) - large_decode["width"] / large_decode["height"]) < 0.003

    image_input.set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert "preview-test.png" in page.locator("#imageName").inner_text()
    assert page.locator("#exportButton").is_enabled()
    normal_decode = page.evaluate("labBitmapCalls.find(call => call.name === 'preview-test.png')")
    assert normal_decode and normal_decode["width"] <= 2048 and normal_decode["height"] <= 2048
    square_project = re.search(r"(\d+) × (\d+) · معاينة (\d+) × (\d+)", page.locator("#viewportValue").evaluate("el => el.textContent"))
    assert square_project and square_project.group(1) == square_project.group(2)

    assert page.locator("#aspectPreset").input_value() == "original"
    assert page.locator("#fitMode").input_value() == "fit"
    page.locator("#aspectPreset").select_option("portrait")
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    preview_dimension = page.locator("#stage").evaluate("el => [el.width, el.height]")
    assert preview_dimension == [720, 1280]
    assert "1080 × 1920" in page.locator("#viewportValue").inner_text()
    fit_frame = page.locator("#stage").evaluate("el => el.toDataURL()")
    page.locator("#fitMode").select_option("fill")
    page.wait_for_function("previous => document.querySelector('#stage').toDataURL() !== previous", arg=fit_frame)
    fill_frame = page.locator("#stage").evaluate("el => el.toDataURL()")
    assert fit_frame != fill_frame

    page.locator("#endZoom").evaluate("el => { el.value = '1.4'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    page.locator("#endX").evaluate("el => { el.value = '42'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    page.locator("#endY").evaluate("el => { el.value = '-21'; el.dispatchEvent(new Event('input', {bubbles:true})); }")

    image_input.set_input_files({
        "name": "preview-test-slow.png", "mimeType": "image/png",
        "buffer": (site / "examples/motion-studio-lab/preview-test.png").read_bytes()
    })
    image_input.set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert "preview-test.png" in page.locator("#imageName").inner_text()
    page.wait_for_timeout(760)
    assert "preview-test.png" in page.locator("#imageName").inner_text()
    preview = page.locator("#stage")
    studio_seek = page.locator("#seek")
    def set_studio_time(ms):
        studio_seek.evaluate("""(el, value) => {
            el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", ms)
    set_studio_time(6000)
    at_middle = preview.evaluate("el => el.toDataURL()")
    set_studio_time(0)
    set_studio_time(6000)
    assert preview.evaluate("el => el.toDataURL()") == at_middle
    page.locator("#playPauseButton").scroll_into_view_if_needed()
    print("Mobile transport hit test:", json.dumps(page.locator("#playPauseButton").evaluate("el => { const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return {width:innerWidth,height:innerHeight,scrollY,coarse:matchMedia('(pointer: coarse)').matches,previewPosition:getComputedStyle(document.querySelector('.preview-panel')).position,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:hit?.outerHTML?.slice(0,180)}; }"), ensure_ascii=False), flush=True)
    if page.evaluate("matchMedia('(pointer: coarse)').matches"):
        play_button = page.locator("#playPauseButton")
        play_button.evaluate("el => el.scrollIntoView({block:'center', inline:'center', behavior:'instant'})")
        box = play_button.bounding_box()
        assert play_button.evaluate("el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button') === el; }"), "touch Play button must be the actual hit target"
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    else:
        page.locator("#playPauseButton").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 6200")
    if page.evaluate("matchMedia('(pointer: coarse)').matches"):
        play_button = page.locator("#playPauseButton")
        play_button.evaluate("el => el.scrollIntoView({block:'center', inline:'center', behavior:'instant'})")
        box = play_button.bounding_box()
        assert play_button.evaluate("el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button') === el; }"), "touch Pause button must be the actual hit target"
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    else:
        page.locator("#playPauseButton").click()
    paused_value = studio_seek.input_value()
    page.locator("#aspectPreset").select_option("landscape")
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert studio_seek.input_value() == paused_value
    assert page.locator("#playPauseButton").inner_text() == "متابعة"
    assert page.locator("#stage").evaluate("el => [el.width, el.height]") == [1280, 720]
    page.wait_for_timeout(140)
    assert studio_seek.input_value() == paused_value
    page.locator("#aspectPreset").select_option("post")
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    assert studio_seek.input_value() == paused_value
    assert page.locator("#playPauseButton").inner_text() == "متابعة"
    assert page.locator("#stage").evaluate("el => [el.width, el.height]") == [858, 1073]
    if page.evaluate("matchMedia('(pointer: coarse)').matches"):
        replay_button = page.locator("#replayButton")
        replay_button.evaluate("el => el.scrollIntoView({block:'center', inline:'center', behavior:'instant'})")
        box = replay_button.bounding_box()
        assert replay_button.evaluate("el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button') === el; }"), "touch Replay button must be the actual hit target"
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    else:
        page.locator("#replayButton").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 0")
    page.wait_for_function("Number(document.querySelector('#seek').value) < 1000")
    with page.expect_download() as download_info:
        page.locator("#saveProjectButton").click()
    project_download = download_info.value
    project_path = Path("/tmp/qarton-motion-studio-check.json")
    project_download.save_as(project_path)
    project_json = project_path.read_text()
    assert "qarton-motion-studio-project" in project_json
    assert "preview-test.png" in project_json
    assert "<svg" not in project_json
    project_data = json.loads(project_json)
    assert project_data["settings"] == {"aspectPreset": "post", "fitMode": "fill"}
    assert project_data["project"]["viewport"]["width"] == 1080
    assert project_data["project"]["viewport"]["height"] == 1350
    assert project_data["project"]["camera"][1]["value"]["x"] == 42
    assert project_data["project"]["camera"][1]["value"]["y"] == -21
    project_data["project"]["layers"][0]["assetId"] = "imported-portrait-42"
    project_path.write_text(json.dumps(project_data))
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(project_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    assert "أعد اختيار الصورة" in page.locator("#imageName").inner_text()
    assert page.locator("#aspectPreset").input_value() == "post"
    assert page.locator("#fitMode").input_value() == "fill"
    page.locator("#imageInput").set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    with page.expect_download() as rebound_download_info:
        page.locator("#saveProjectButton").click()
    rebound_path = Path("/tmp/qarton-motion-studio-rebound.json")
    rebound_download_info.value.save_as(rebound_path)
    rebound_data = json.loads(rebound_path.read_text())
    assert rebound_data["project"]["layers"][0]["assetId"] == "imported-portrait-42"

    legacy_data = json.loads(project_json)
    legacy_data["project"]["viewport"] = {"width": 720, "height": 1280, "fps": 24}
    legacy_data["project"]["camera"][1]["atMs"] = legacy_data["project"]["durationMs"]
    legacy_data.pop("settings")
    legacy_path = Path("/tmp/qarton-motion-studio-legacy.json")
    legacy_path.write_text(json.dumps(legacy_data))
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(legacy_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    assert page.locator("#aspectPreset").input_value() == "portrait"
    assert page.locator("#fitMode").input_value() == "fit"

    image_input.set_input_files({
        "name": "preview-test-slow.png", "mimeType": "image/png",
        "buffer": (site / "examples/motion-studio-lab/preview-test.png").read_bytes()
    })
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(project_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    relink_label = page.locator("#imageName").inner_text()
    relink_frame = preview.evaluate("el => el.toDataURL()")
    page.wait_for_timeout(760)
    assert page.locator("#imageName").inner_text() == relink_label
    assert preview.evaluate("el => el.toDataURL()") == relink_frame

    studio_seek = page.locator("#seek")
    studio_seek.evaluate("""(el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 5000)
    page.locator("#addKeyframeButton").click()
    assert page.locator(".keyframe-marker").count() == 3
    assert page.locator('.keyframe-marker[aria-pressed="true"]').get_attribute("data-key-time") == "5000"
    studio_seek.evaluate("""(el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 6000)
    before_edit = preview.evaluate("el => el.toDataURL()")
    page.locator("#keyframeZoom").fill("1.9")
    page.locator("#keyframeZoom").dispatch_event("change")
    assert preview.evaluate("el => el.toDataURL()") != before_edit

    lane = page.locator("#timelineLane")
    lane_box = lane.bounding_box()
    key_box = page.locator('.keyframe-marker[data-key-time="5000"]').bounding_box()
    page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
    page.mouse.down()
    page.mouse.move(lane_box["x"] + lane_box["width"] * 7000 / 12000,
                    lane_box["y"] + lane_box["height"] / 2, steps=8)
    page.mouse.up()
    moved_camera_keys = page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")
    if page.locator('.keyframe-marker[data-key-time="7000"]').count() != 1:
        raise AssertionError({
            "camera_keys_after_drag": moved_camera_keys,
            "timeline_message": page.locator("#timelineMessage").inner_text(),
            "error_message": page.locator("#errorMessage").inner_text(),
            "is_dragging": lane.get_attribute("data-dragging"),
            "playhead": page.locator("#timelinePlayhead").get_attribute("style"),
        })
    horizontal_overflow = page.evaluate("""() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        viewportWidth: innerWidth,
        offenders: [...document.querySelectorAll('body *')].map(element => {
            const rect = element.getBoundingClientRect();
            return {tag: element.tagName, id: element.id, className: String(element.className),
                left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth};
        }).filter(item => item.right > innerWidth + 1 || item.left < -1 || item.scrollWidth > item.clientWidth + 1)
          .slice(0, 12)
    })""")
    assert horizontal_overflow["scrollWidth"] <= horizontal_overflow["viewportWidth"], horizontal_overflow

    with page.expect_download() as timeline_download_info:
        page.locator("#saveProjectButton").click()
    timeline_path = Path("/tmp/qarton-motion-studio-l6b.json")
    timeline_download_info.value.save_as(timeline_path)
    timeline_data = json.loads(timeline_path.read_text())
    assert [key["atMs"] for key in timeline_data["project"]["camera"]] == [0, 7000, 12000]
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(timeline_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    assert page.locator(".keyframe-marker").count() == 3
    page.locator("#imageInput").set_input_files(str(site / "examples/motion-studio-lab/preview-test.png"))
    page.get_by_text("المعاينة جاهزة", exact=True).wait_for()
    studio_seek.evaluate("""(el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 6000)
    repeat_frame = preview.evaluate("el => el.toDataURL()")
    studio_seek.evaluate("""(el, value) => {
        el.value = '0'; el.dispatchEvent(new Event('input', {bubbles:true}));
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 6000)
    assert preview.evaluate("el => el.toDataURL()") == repeat_frame
    page.locator('.keyframe-marker[data-key-time="7000"]').evaluate("el => el.click()")
    page.locator("#deleteKeyframeButton").click()
    assert [int(value) for value in page.locator(".keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")] == [0, 12000]

    # Exercise the separate character lane through real DOM events and Canvas sampling.
    for position in (2000, 6000, 10000):
        studio_seek.evaluate("""(el, value) => {
            el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
        }""", position)
        page.locator("#addCharacterKeyframe").click()
    assert page.locator(".character-keyframe-marker").count() == 3
    focus_marker = page.locator('.character-keyframe-marker[data-key-time="6000"]')
    focus_marker.evaluate("el => el.focus()")
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement?.dataset.keyTime") == "6000"
    page.locator('.character-keyframe-marker[data-key-time="6000"]').evaluate("el => el.click()")
    mouth = page.locator('[data-character-channel="mouthOpen"]')
    mouth.fill("0.9")
    mouth.dispatch_event("change")
    assert page.locator("#characterTimelineSelection").inner_text() == "المحدد · 00:06.00"
    set_studio_time(6000)
    neutral_face = preview.evaluate("el => el.toDataURL()")
    expression = page.locator('[data-character-channel="expression"]')
    expression.select_option("happy")
    expression.dispatch_event("change")
    happy_face = preview.evaluate("el => el.toDataURL()")
    assert happy_face != neutral_face
    gesture = page.locator('[data-character-channel="gesture"]')
    gesture.select_option("wave")
    gesture.dispatch_event("change")
    assert preview.evaluate("el => el.toDataURL()") != happy_face
    studio_seek.evaluate("""(el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 4000)
    character_frame = preview.evaluate("el => el.toDataURL()")
    studio_seek.evaluate("""(el, value) => {
        el.value = '0'; el.dispatchEvent(new Event('input', {bubbles:true}));
        el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
    }""", 4000)
    assert preview.evaluate("el => el.toDataURL()") == character_frame
    # A trusted Chromium drag survives marker rerender; cancel keeps the last
    # committed position from the continuous gesture.
    character_lane = page.locator("#characterTimelineLane")
    def current_character_times():
        return [int(value) for value in page.locator(".character-keyframe-marker")
            .evaluate_all("els => els.map(el => el.dataset.keyTime)")]
    character_drag_snapshots = {}
    character_box = character_lane.bounding_box()
    character_key_box = page.locator('.character-keyframe-marker[data-key-time="6000"]').bounding_box()
    page.evaluate("""() => {
        window.lastCharacterPointerId = null;
        document.querySelector('#characterTimelineLane').addEventListener('pointerdown', event => {
            window.lastCharacterPointerId = event.pointerId;
        }, {capture: true});
    }""")
    page.mouse.move(character_key_box["x"] + character_key_box["width"] / 2,
                    character_key_box["y"] + character_key_box["height"] / 2)
    page.mouse.down()
    page.wait_for_function("document.querySelector('#characterTimelineLane').hasPointerCapture(window.lastCharacterPointerId)")
    page.mouse.move(character_box["x"] + character_box["width"] * .58,
                    character_box["y"] + character_box["height"] / 2, steps=8)
    page.evaluate("""() => document.querySelector('#characterTimelineLane').dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true, pointerId: window.lastCharacterPointerId, pointerType: 'mouse', isPrimary: true
    }))""")
    assert page.locator('.character-keyframe-marker[data-key-time="6960"]').count() == 1
    assert page.locator("#characterTimelineLane").get_attribute("data-scrubbing") is None
    character_drag_snapshots["cancel"] = current_character_times()
    page.mouse.up()

    # A drag into an occupied timestamp fails atomically, while a
    # lostpointercapture event after a valid move keeps the moved key.
    character_lane = page.locator("#characterTimelineLane")
    character_box = character_lane.bounding_box()
    key_box = page.locator('.character-keyframe-marker[data-key-time="6960"]').bounding_box()
    page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
    page.mouse.down()
    page.wait_for_function("document.querySelector('#characterTimelineLane').hasPointerCapture(window.lastCharacterPointerId)")
    assert character_lane.get_attribute("data-scrubbing") is None, "marker pointerdown must not start lane scrubbing"
    page.mouse.move(character_box["x"] + character_box["width"] * (10000 / 12000),
                    character_box["y"] + character_box["height"] / 2, steps=8)
    assert "يوجد مفتاح آخر" in page.locator("#characterTimelineMessage").inner_text()
    character_lane.evaluate("""(el, id) => el.dispatchEvent(new PointerEvent('lostpointercapture', {
        bubbles: true, pointerId: id, pointerType: 'mouse', isPrimary: true
    }))""", page.evaluate("window.lastCharacterPointerId"))
    collision_times = [int(value) for value in page.locator(".character-keyframe-marker").evaluate_all("els => els.map(el => el.dataset.keyTime)")]
    character_drag_snapshots["collision"] = collision_times
    collision_candidates = [value for value in collision_times if 6960 < value < 10000]
    assert len(collision_times) == 3 and len(set(collision_times)) == 3
    assert collision_candidates, "failed occupied timestamp retains the last valid drag position"
    page.mouse.up()

    character_box = character_lane.bounding_box()
    collision_source = 2000
    key_box = page.locator(f'.character-keyframe-marker[data-key-time="{collision_source}"]').bounding_box()
    page.evaluate("""() => {
        window.lostCapturePointerId = null;
        document.querySelector('#characterTimelineLane').addEventListener('pointerdown', event => {
            window.lostCapturePointerId = event.pointerId;
        }, {capture: true, once: true});
    }""")
    page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
    page.mouse.down()
    lost_pointer_id = page.evaluate("window.lostCapturePointerId")
    assert lost_pointer_id is not None
    assert character_lane.evaluate("(el, id) => el.hasPointerCapture(id)", lost_pointer_id)
    current_lane_box = character_lane.bounding_box()
    target_x = current_lane_box["x"] + current_lane_box["width"] * (8040 / 12000)
    page.mouse.move(target_x, current_lane_box["y"] + current_lane_box["height"] / 2)
    assert page.locator('.character-keyframe-marker[data-key-time="8040"]').count() == 1
    character_drag_snapshots["lostCapture"] = current_character_times()
    character_lane.evaluate("""(el, id) => el.dispatchEvent(new PointerEvent('lostpointercapture', {
        bubbles: true, pointerId: id, pointerType: 'mouse', isPrimary: true
    }))""", lost_pointer_id)
    assert page.locator('.character-keyframe-marker[data-key-time="8040"]').count() == 1
    page.wait_for_function("!document.querySelector('#characterTimelineLane').hasAttribute('data-dragging')")
    page.mouse.up()
    assert page.locator('.character-keyframe-marker[data-key-time="8040"]').count() == 1

    character_box = character_lane.bounding_box()
    key_box = page.locator('.character-keyframe-marker[data-key-time="8040"]').bounding_box()
    page.mouse.move(key_box["x"] + key_box["width"] / 2, key_box["y"] + key_box["height"] / 2)
    page.mouse.down()
    page.wait_for_function("document.querySelector('#characterTimelineLane').hasPointerCapture(window.lastCharacterPointerId)")
    current_lane_box = character_lane.bounding_box()
    page.mouse.move(current_lane_box["x"] + current_lane_box["width"] * (7500 / 12000),
                    current_lane_box["y"] + current_lane_box["height"] / 2)
    page.mouse.up()
    assert page.locator('.character-keyframe-marker[data-key-time="7500"]').count() == 1
    character_drag_snapshots["moveTo7500"] = current_character_times()

    # Use a real browser pointer to begin a lane scrub, then acquire the export
    # lock. The lock must release capture and discard the stale scrub before retry.
    page.locator("#exportDuration").select_option("3000")
    character_box = character_lane.bounding_box()
    page.evaluate("""() => {
        window.characterPointerId = null;
        document.querySelector('#characterTimelineLane').addEventListener('pointerdown', event => {
            window.characterPointerId = event.pointerId;
        }, {capture: true, once: true});
    }""")
    page.mouse.move(character_box["x"] + character_box["width"] * .4, character_box["y"] + character_box["height"] / 2)
    page.mouse.down()
    pointer_id = page.evaluate("window.characterPointerId")
    assert pointer_id is not None
    assert character_lane.evaluate("(el, id) => el.hasPointerCapture(id)", pointer_id)
    locked_time = page.locator("#seek").input_value()
    page.locator("#exportButton").evaluate("el => el.click()")
    page.wait_for_function("!document.querySelector('#cancelExportButton').hidden")
    assert character_lane.get_attribute("aria-disabled") == "true"
    assert character_lane.get_attribute("data-scrubbing") is None
    assert not character_lane.evaluate("(el, id) => el.hasPointerCapture(id)", pointer_id)
    page.locator("#cancelExportButton").evaluate("el => el.click()")
    page.wait_for_function("document.querySelector('#exportStatus').textContent.includes('أُلغي التسجيل')")
    page.wait_for_function("document.querySelector('#characterTimelineLane').getAttribute('aria-disabled') === 'false'")
    page.mouse.move(character_box["x"] + character_box["width"] * .9, character_box["y"] + character_box["height"] / 2)
    assert page.locator("#seek").input_value() == locked_time, "cancelled scrub must not resume after export unlock"
    page.mouse.up()

    with page.expect_download() as character_download_info:
        page.locator("#saveProjectButton").click()
    character_path = Path("/tmp/qarton-motion-studio-character.json")
    character_download_info.value.save_as(character_path)
    character_data = json.loads(character_path.read_text())
    saved_character_times = [key["atMs"] for key in character_data["characterTrack"]["keyframes"]]
    assert saved_character_times == sorted([7500, collision_candidates[-1], 10000]), {
        "saved_times": saved_character_times,
        "drag_snapshots": character_drag_snapshots,
        "timeline_message": page.locator("#characterTimelineMessage").inner_text(),
        "selection": page.locator("#characterTimelineSelection").inner_text(),
    }
    page.locator("#loadProjectButton").click()
    page.locator("#projectInput").set_input_files(str(character_path))
    page.get_by_text("فُتح المشروع؛ اختر الصورة المرتبطة به", exact=True).wait_for()
    assert page.locator(".character-keyframe-marker").count() == 3
    page.locator('.character-keyframe-marker[data-key-time="7500"]').evaluate("el => el.click()")
    page.locator("#deleteCharacterKeyframe").click()
    remaining_character_times = [int(value) for value in page.locator(".character-keyframe-marker")
        .evaluate_all("els => els.map(el => el.dataset.keyTime)")]
    assert remaining_character_times == sorted([collision_candidates[-1], 10000]), {
        "remaining_times": remaining_character_times,
        "deleted_time": 7500,
        "drag_snapshots": character_drag_snapshots,
    }
    page.goto(url + "examples/character-animation-lab/")
    page.wait_for_function("document.querySelector('#status')?.textContent.includes('المشهد جاهز')")
    actor = page.locator("#character")
    assert actor.count() == 1
    def seek_character(ms):
        page.locator("#seek").evaluate("""(el, time) => {
            el.value = String(time); el.dispatchEvent(new Event('input', {bubbles:true}));
        }""", ms)
        page.wait_for_function("time => +document.querySelector('#character').dataset.time === time", arg=ms)

    seek_character(250)
    sampled = actor.evaluate("el => [el.dataset.headRotation, el.dataset.eyeX, el.dataset.expression]")
    assert sampled[2] == "neutral"
    seek_character(0)
    seek_character(250)
    assert actor.evaluate("el => [el.dataset.headRotation, el.dataset.eyeX, el.dataset.expression]") == sampled
    seek_character(820)
    assert float(actor.get_attribute("data-blink")) > 0
    assert actor.get_attribute("data-gesture") == "wave"
    seek_character(1350)
    assert actor.get_attribute("data-expression") == "happy"
    assert float(actor.get_attribute("data-mouth-open")) > 0
    initial_frame = page.locator("#spritePreview").get_attribute("viewBox")
    seek_character(350)
    assert page.locator("#spritePreview").get_attribute("viewBox") != initial_frame
    page.locator("#play").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 400")
    page.locator("#pause").click()
    paused_time = page.locator("#seek").input_value()
    page.wait_for_timeout(120)
    assert page.locator("#seek").input_value() == paused_time
    page.locator("#replay").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 0")
    page.wait_for_function("Number(document.querySelector('#seek').value) < 100")
    page.locator("#play").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 100")
    page.locator("#switch").click()
    page.wait_for_function("document.querySelector('#stage').dataset.scene === 'night'")
    assert actor.count() == 1 and actor.get_attribute("data-time") == "0"
    assert "ضوء المساء" in page.locator("#status").inner_text()
    page.wait_for_timeout(120)
    assert actor.get_attribute("data-time") == "0"
    page.locator("#play").click()
    page.wait_for_function("Number(document.querySelector('#seek').value) > 0")
    page.locator("#switch").click()
    assert page.locator("#character").count() == 1
    browser_keyframes = page.evaluate("""async () => {
        const { createCharacterAnimation } = await import(
            new URL('../../src/character/animation-core.js', location.href));
        const animation = createCharacterAnimation({
            character: { id: 'browser-order', initial: { headRotation: -5, eyeY: 0.25 } },
            durationMs: 2000,
            keyframes: [
                { atMs: 1000, values: { headRotation: 30 } },
                { atMs: 1500, values: { eyeY: -0.5 } },
                { atMs: 0, values: { eyeX: 0.5 } },
                { atMs: 500, values: { headRotation: 10, mouthOpen: 0.4 }, easing: 'linear' }
            ]
        });
        const result = [250, 750, 1250].map(time => animation.sample(time));
        animation.sample(0);
        const repeated = animation.sample(750);
        return {
            times: animation.timeline.events.map(event => event.atMs),
            headAt250: result[0].headRotation,
            headAt750: result[1].headRotation,
            eyeXAt750: result[1].eyeX,
            mouthAt750: result[1].mouthOpen,
            eyeYAt1250: result[2].eyeY,
            seekStable: JSON.stringify(result[1]) === JSON.stringify(repeated)
        };
    }""")
    assert browser_keyframes == {
        "times": [0, 500, 1000, 1500], "headAt250": 2.5, "headAt750": 20,
        "eyeXAt750": 0.5, "mouthAt750": 0.4, "eyeYAt1250": -0.125, "seekStable": True
    }
    assert not errors, errors


if __name__ == "__main__":
    site = Path("_site").resolve()
    assert (site / "index.html").is_file()
    def png_chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)

    width, height = 6000, 4000
    compressor = zlib.compressobj(1)
    row = b"\x00" + b"\x30\x90\xd0\xff" * width
    compressed_rows = bytearray()
    for _ in range(height):
        compressed_rows.extend(compressor.compress(row))
    compressed_rows.extend(compressor.flush())
    large_png = (b"\x89PNG\r\n\x1a\n" +
                 png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) +
                 png_chunk(b"IDAT", bytes(compressed_rows)) + png_chunk(b"IEND", b""))
    (site / "examples/motion-studio-lab/preview-large.png").write_bytes(large_png)
    handler = partial(SimpleHTTPRequestHandler, directory=site.parent)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as pw:
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/{site.name}/"
        executable = environ.get("CHROMIUM_EXECUTABLE_PATH")
        browser = pw.chromium.launch(executable_path=executable) if executable else pw.chromium.launch(channel="chrome")
        for device in [None, "Pixel 7"]:
            with browser.new_context(**(pw.devices[device] if device else {})) as context:
                exercise(context, url)
                print(f"{device or 'Desktop'} passed", flush=True)
        browser.close()
        server.shutdown()
