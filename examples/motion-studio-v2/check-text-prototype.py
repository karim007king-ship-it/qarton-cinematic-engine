from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os
import shutil
import base64
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "dist/motion-studio-v2-l14c3-android-preview/index.html"
OUT = HTML.parent
SHOTS = OUT / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)
if not HTML.exists():
    raise SystemExit("Build the standalone L14-C3 HTML before running this check")


def set_range(page, selector, value):
    page.locator(selector).evaluate("(el, value) => { el.value=String(value); el.dispatchEvent(new Event('input', {bubbles:true})); }", value)


def capture_canvas(page, name):
    data_url = page.evaluate("document.querySelector('#previewCanvas').toDataURL('image/png')")
    (SHOTS / name).write_bytes(base64.b64decode(data_url.split(",", 1)[1]))


def create_face_rig_files(page, folder):
    source = ROOT / "examples/cinematic-runtime-lab/assets/layered-test"
    parts = {
        "layla__body.webp": "body.svg", "layla__head.webp": "head.svg",
        "layla__hair_back.webp": "hair-back.svg", "layla__hair_front.webp": "hair-front.svg",
        "layla__eye_left.webp": "eye-left.svg", "layla__eye_right.webp": "eye-right.svg",
        "layla__brow_left.webp": "brow-left.svg", "layla__brow_right.webp": "brow-right.svg",
        "layla__mouth__closed.webp": "mouth-closed.svg", "layla__mouth__open.webp": "mouth-open.svg",
        "layla__mouth__round.webp": "mouth-round.svg", "layla__mouth__wide.webp": "mouth-wide.svg",
        "layla__mouth__teeth.webp": "mouth-teeth.svg"
    }
    svg = {name: (source / filename).read_text() for name, filename in parts.items()}
    encoded = page.evaluate("""async parts => {
      const out={};
      for(const [name,markup] of Object.entries(parts)){
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        canvas.getContext('2d').drawImage(image,0,0);out[name]=canvas.toDataURL('image/webp',.95);
      }
      return out;
    }""", svg)
    layouts = {
        "head": {"x": .5, "y": .29, "width": .4, "height": .36, "pivotX": .5, "pivotY": .88},
        "eye_left": {"x": .405, "y": .14, "width": .13, "height": .09, "pivotX": .5, "pivotY": .5},
        "eye_right": {"x": .595, "y": .14, "width": .13, "height": .09, "pivotX": .5, "pivotY": .5},
        "brow_left": {"x": .405, "y": .095, "width": .13, "height": .07, "pivotX": .5, "pivotY": .5},
        "brow_right": {"x": .595, "y": .095, "width": .13, "height": .07, "pivotX": .5, "pivotY": .5},
        "mouth": {"x": .5, "y": .22, "width": .19, "height": .075, "pivotX": .5, "pivotY": .5}
    }
    files = []
    manifest_layers = {}
    for name, data_url in encoded.items():
        path = Path(folder) / name
        path.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
        role = name.split("__")[1].split(".")[0]
        config = {"view": "front"}
        if role in layouts:
            config["layout"] = layouts[role]
        manifest_layers[name] = config
        files.append(path)
    manifest_path = Path(folder) / "layla.character.json"
    manifest_path.write_text(json.dumps({"characterId": "layla", "pose": "front", "layers": manifest_layers}, ensure_ascii=False))
    return [*files, manifest_path]


def visual_regression(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(HTML.as_uri() + "?testVisual=1", wait_until="load")
    page.wait_for_function("document.documentElement.dataset.artReady === 'true'")
    page.wait_for_function("window.__QARTON_TEST_API?.state().artReady === true")
    canvas = page.locator("#previewCanvas")
    page.evaluate("window.__QARTON_TEST_API.seek(1200)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"layla", "youssef"} and len(ids) == len(set(ids)), ids
    drawn_ids = canvas.get_attribute("data-drawn-character-ids").split(",")
    assert set(drawn_ids) == set(ids), {"expected visible portraits": ids, "actually drawn": drawn_ids}
    portrait_pixels = page.evaluate("""() => {
      const c=document.querySelector('#previewCanvas'), w=c.width, h=Math.floor(c.height*.70);
      const pixels=c.getContext('2d').getImageData(0,0,w,h).data; let warm=0, nonBackdrop=0;
      for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        if(r>70 && r>g*1.22 && r>b*1.18) warm++;
        if(Math.abs(r-25)+Math.abs(g-38)+Math.abs(b-53)>35) nonBackdrop++;
      }
      return {warm,nonBackdrop};
    }""")
    art_diagnostics = page.evaluate("window.__QARTON_TEST_API.artDiagnostics()")
    assert portrait_pixels["warm"] > 500 and portrait_pixels["nonBackdrop"] > 5000, {"portrait pixels missing above dialogue panel": portrait_pixels, "decoded art": art_diagnostics, "camera": page.evaluate("window.__QARTON_TEST_API.sequenceState().camera")}
    page.locator('[data-section="characters"]').click()
    page.locator("#closeSheetButton").click()
    page.evaluate("window.__QARTON_TEST_API.setDialogueReveal(true)")
    capture_canvas(page, "family-two-character.png")
    portrait = ROOT / "examples/motion-studio-v2/assets/characters/layla.webp"
    page.locator("#characterImageInput").set_input_files(str(portrait))
    page.wait_for_function("window.__QARTON_TEST_API.state().importedPortraitCount === 1")
    with tempfile.TemporaryDirectory(prefix="qarton-layer-fixture-") as folder:
        body = Path(folder) / "layla__body.webp"
        head = Path(folder) / "layla__head.webp"
        parts = page.evaluate("""async url => {
          const image=new Image(); image.src=url; await image.decode();
          const crop=(y,height) => { const c=document.createElement('canvas'); c.width=256;c.height=256; const x=c.getContext('2d'); x.drawImage(image,0,y*image.naturalHeight,image.naturalWidth,height*image.naturalHeight,0,0,256,256); return c.toDataURL('image/webp',.92); };
          return {body:crop(.34,.66),head:crop(0,.38)};
        }""", portrait.resolve().as_uri())
        body.write_bytes(base64.b64decode(parts["body"].split(",", 1)[1]))
        head.write_bytes(base64.b64decode(parts["head"].split(",", 1)[1]))
        assert body.read_bytes() != head.read_bytes(), "layer fixtures must be real distinct image regions, not repeated full portraits"
        page.locator("#characterImageInput").set_input_files([str(body), str(head)])
        page.wait_for_function("window.__QARTON_TEST_API.state().importedLayerCount === 2")
        assert page.locator("#previewCanvas").evaluate("el => el.dataset.renderedCharacterIds.split(',').length === 2")
    page.locator("#characterImageInput").set_input_files(str(portrait))
    page.wait_for_function("window.__QARTON_TEST_API.state().importedPortraitCount === 1")

    page.evaluate("window.__QARTON_TEST_API.loadDemo(1)")
    page.wait_for_function("document.querySelectorAll('#characterSelect option').length === 3")
    assert page.locator("#dialogueLineSelect option").count() == 4
    page.evaluate("window.__QARTON_TEST_API.seek(800)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"layla", "youssef", "salim"} and len(ids) == len(set(ids)), ids
    assert set(canvas.get_attribute("data-drawn-character-ids").split(",")) == set(ids)
    page.evaluate("window.__QARTON_TEST_API.setDialogueReveal(true)")
    capture_canvas(page, "confrontation-three-character.png")

    page.evaluate("window.__QARTON_TEST_API.loadDemo(2)")
    page.wait_for_function("document.querySelectorAll('#characterSelect option').length === 2")
    page.evaluate("window.__QARTON_TEST_API.seek(1300)")
    ids = canvas.get_attribute("data-rendered-character-ids").split(",")
    assert set(ids) == {"nour", "youssef"} and len(ids) == len(set(ids)), ids
    assert set(canvas.get_attribute("data-drawn-character-ids").split(",")) == set(ids)
    page.evaluate("window.__QARTON_TEST_API.setDialogueReveal(true)")
    capture_canvas(page, "emotional-two-character.png")
    page.evaluate("window.__QARTON_TEST_API.setTextScene({id:'mirror-face',title:'اختبار انعكاس الوجه',language:'tn',theme:'family',characters:[{id:'right-facing',name:'ليلى',spriteKey:'layla',x:.3,y:.82,scale:.72,z:0,face:{x:.55,y:.113,skin:'#d99a78'},facing:'right'},{id:'left-facing',name:'يوسف',spriteKey:'youssef',x:.7,y:.82,scale:.72,z:1,face:{x:.55,y:.109,skin:'#dca47e'},facing:'left'}],dialogue:[{id:'mirror-line',speakerId:'left-facing',expression:'surprised',text:'بُ، فِي قرطاج؟'}]})")
    page.evaluate("window.__QARTON_TEST_API.setDialogueReveal(true)")
    mirror_events = page.evaluate("window.__QARTON_TEST_API.visemes(0)")
    mirror_event = next(item for item in mirror_events["events"] if item["viseme"] == "round")
    page.evaluate("time => window.__QARTON_TEST_API.seek(time)", mirror_events["startMs"] + mirror_event["offsetMs"] + 30)
    capture_canvas(page, "mirrored-face-rig.png")
    reports = []
    sprite_keys = ["layla", "youssef", "nour", "salim"]
    for count in (4, 8):
        characters = [{"id": f"visual-{index + 1}", "name": f"شخصية {index + 1}", "spriteKey": sprite_keys[index % 4], "x": (index + 1) / (count + 1), "y": .76, "scale": .35 if count == 4 else .22, "z": index} for index in range(count)]
        dialogue = [{"id": f"role-{index + 1}", "speakerId": character["id"], "text": "نحكيوا مع بعضنا ونلقاو الطريق.", "expression": "thinking" if index % 2 else "determined"} for index, character in enumerate(characters)]
        page.evaluate("definition => window.__QARTON_TEST_API.setTextScene(definition)", {"id": f"crowd-{count}", "title": f"مشهد {count} شخصيات", "language": "tn", "theme": "ruins", "characters": characters, "dialogue": dialogue})
        page.evaluate("window.__QARTON_TEST_API.seek(1400)")
        ids = canvas.get_attribute("data-rendered-character-ids").split(",")
        assert len(ids) == count and len(ids) == len(set(ids)), ids
        assert set(canvas.get_attribute("data-drawn-character-ids").split(",")) == set(ids)
        if count == 8:
            capture_canvas(page, "eight-character-scene.png")
        reports.append({"characters": count, "uniqueCharacterIds": True})
    pose_reports = []
    pose_hashes = set()
    pose_texts = {"closed": "بْ", "round": "بُ", "wide": "بِ", "teeth": "ف", "open": "عَ"}
    page.set_viewport_size({"width": 720, "height": 1280})
    page.evaluate("window.__QARTON_TEST_API.loadDemo(0)")
    with tempfile.TemporaryDirectory(prefix="qarton-calibrated-face-rig-") as folder:
        rig_files = create_face_rig_files(page, folder)
        payload = [{"name": path.name, "type": "application/json" if path.suffix == ".json" else "image/webp", "data": base64.b64encode(path.read_bytes()).decode("ascii")} for path in rig_files]
        imported = page.evaluate("""async items => {
          const files=items.map(item=>new File([Uint8Array.from(atob(item.data),char=>char.charCodeAt(0))],item.name,{type:item.type}));
          return await window.__QARTON_TEST_API.importCharacterAssets(files,'layla');
        }""", payload)
        assert imported["mode"] == "layers" and imported["layerCount"] == 13, imported
        for viseme, text in pose_texts.items():
            page.evaluate("text => window.__QARTON_TEST_API.setTextScene({id:'mouth-poses',title:'أوضاع الفم',language:'tn',theme:'family',characters:[{id:'layla',name:'ليلى',spriteKey:'layla',x:.5,y:1,scale:1.1,z:0}],dialogue:[{id:'visemes',speakerId:'layla',expression:'neutral',text}]})", text)
            page.evaluate("window.__QARTON_TEST_API.setDialogueReveal(true)")
            timeline = page.evaluate("window.__QARTON_TEST_API.visemes(0)")
            event = next(item for item in timeline["events"] if item["viseme"] == viseme)
            timestamp = timeline["startMs"] + event["offsetMs"] + max(1, event["durationMs"] // 2)
            page.evaluate("time => window.__QARTON_TEST_API.seek(time)", timestamp)
            assert canvas.get_attribute("data-active-viseme") == viseme, {"wanted": viseme, "got": canvas.get_attribute("data-active-viseme")}
            capture_canvas(page, f"mouth-{viseme}.png")
            region = page.evaluate("""() => {
              const draw=window.__QARTON_TEST_API.textDrawDiagnostics(), rig=draw.characterGeometry.layla;
              if(!rig?.faceRigValid) throw Error('viseme rendering requires a calibrated transparent face rig');
              const c=document.querySelector('#previewCanvas'), mouth=rig.layers.find(layer=>layer.role==='mouth');
              const x=Math.max(0,Math.floor(mouth.anchorX-mouth.width/2)-2), y=Math.max(0,Math.floor(mouth.anchorY-mouth.height/2)-2);
              const w=Math.min(c.width-x,Math.max(1,Math.ceil(mouth.width)+4)), h=Math.min(c.height-y,Math.max(1,Math.ceil(mouth.height)+4));
              const d=c.getContext('2d').getImageData(x,y,w,h).data;let hsh=2166136261;
              for(let i=0;i<d.length;i+=4){hsh=Math.imul(hsh^d[i],16777619);hsh=Math.imul(hsh^d[i+1],16777619);hsh=Math.imul(hsh^d[i+2],16777619);}
              return String(hsh>>>0);
            }""")
            pose_hashes.add(region)
            pose_reports.append({"viseme": viseme, "capture": f"mouth-{viseme}.png", "regionHash": region, "calibratedFaceRig": True})
        assert len(pose_hashes) == 5, {"reason": "All five viseme poses on a calibrated transparent rig must produce distinct render samples", "distinctRegions": len(pose_hashes), "hashes": sorted(pose_hashes), "poses": pose_reports}
    cinematic_reports = []
    cinematic_shots = []
    for index, name in enumerate(("family-home", "night-mystery", "three-character-confrontation", "smoke-danger")):
        page.evaluate("index => window.__QARTON_TEST_API.addCinematicDemo(index)", index)
        sequence = page.evaluate("window.__QARTON_TEST_API.sequenceState()")
        current = sequence["scenes"][sequence["selectedIndex"]]
        start = sum(scene["durationMs"] for scene in sequence["scenes"][:sequence["selectedIndex"]])
        page.evaluate("time => window.__QARTON_TEST_API.seek(time)", start + 420)
        transition = page.locator("#previewCanvas").get_attribute("data-cinematic-transition")
        mood = page.locator("#previewCanvas").get_attribute("data-cinematic-mood")
        assert page.locator("#previewCanvas").get_attribute("data-rendered-scene") == current["id"]
        capture_canvas(page, f"cinematic-transition-{name}.png")
        page.evaluate("time => window.__QARTON_TEST_API.seek(time)", start + 1350)
        capture_canvas(page, f"cinematic-{name}.png")
        cinematic_reports.append({"scene": name, "mood": mood, "transition": transition, "characters": len(page.locator("#previewCanvas").get_attribute("data-rendered-character-ids").split(","))})
        cinematic_shots.append(f"cinematic-{name}.png")
    page.evaluate("window.__QARTON_TEST_API.setMood('emotional')")
    sequence = page.evaluate("window.__QARTON_TEST_API.sequenceState()")
    current_start = sum(scene["durationMs"] for scene in sequence["scenes"][:sequence["selectedIndex"]])
    page.evaluate("time => window.__QARTON_TEST_API.seek(time)", current_start + 420)
    assert page.locator("#previewCanvas").get_attribute("data-cinematic-transition") == "focus"
    return {"scenes": 4, "uniqueCharacterIds": True, "renderCounts": reports, "mouthPoseCaptures": pose_reports,
      "visuallyDistinctMouthRegions": len(pose_hashes), "cinematicScenes": cinematic_reports,
      "screenshots": ["family-two-character.png", "confrontation-three-character.png", "emotional-two-character.png", "eight-character-scene.png", "mirrored-face-rig.png", *[f"cinematic-transition-{name}.png" for name in ("family-home", "night-mystery", "three-character-confrontation", "smoke-danger")], *cinematic_shots]}


def exercise(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(HTML.as_uri() + "?testVisual=1", wait_until="load")
    page.wait_for_function("document.documentElement.dataset.prototypeReady === 'true'")
    page.wait_for_function("document.documentElement.dataset.artReady === 'true'")
    assert page.locator("#commitIndicator").inner_text().startswith("Commit ")
    assert page.locator("#previewCanvas").is_visible()
    assert page.locator("#characterSelect option").count() == 2
    assert page.locator("#dialogueLineSelect option").count() == 4
    assert page.locator("#textEngineStatus").evaluate("el => el.textContent") == "جاهز دون صوت"
    assert page.locator("#audioInput, #demoRecordButton, #micReady").count() == 0
    page.locator("[data-section='characters']").click()
    assert "طبقات" in page.locator("#characterAssetStatus").inner_text() or "أصول" in page.locator("#characterAssetStatus").inner_text()
    page.locator("#dialogueLineSelect").select_option("1")
    assert page.locator("#characterSelect").input_value() == "1"
    page.locator("#characterSelect").select_option("0")
    assert "ليلى" in page.locator("#dialogueLineSelect option:checked").inner_text()
    page.locator("#dialogueText").fill("مَبْسُوطٌ، فِي قرطاج؟\nنعم! هذا مشهد طويل " * 8)
    page.locator("#expressionSelect").select_option("determined")
    set_range(page, "#dialogueSpeed", 1.6)
    page.locator("#showAllTextButton").click()
    assert page.locator("#showAllTextButton").get_attribute("aria-pressed") == "true"
    page.locator("#characterScale").evaluate("el => { el.value='53'; el.dispatchEvent(new Event('input',{bubbles:true})); }")
    page.locator("#closeSheetButton").click()
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "true"
    page.wait_for_timeout(220)
    page.locator("#playButton").click()
    assert page.locator("#studio").get_attribute("data-playing") == "false"
    page.locator("#timelineSeek").evaluate("el => { el.value='1600'; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    assert page.locator("#currentTime").inner_text() != "00:00"
    state = page.evaluate("window.__QARTON_TEST_API.state()")
    assert state["turns"][1]["text"].startswith("مَبْسُوط")
    page.locator("#stopButton").click()
    assert page.locator("#currentTime").inner_text() == "00:00"
    page.locator("#playButton").click()
    page.wait_for_timeout(100)
    page.locator("#stopButton").click()
    states = page.evaluate("({audioContexts:window.__audioContextConstructed,getUserMediaCalls:window.__getUserMediaCalls,viseme:document.querySelector('#previewCanvas').dataset.activeViseme})")
    assert states["audioContexts"] == 0, states
    assert states["getUserMediaCalls"] == 0, states
    assert page.locator("#previewCanvas").evaluate("e => e.width > 0 && e.height > 0")
    return {"width": width, "height": height, "state": states}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or None, args=["--allow-file-access-from-files"])
    context = browser.new_context(viewport={"width": 390, "height": 844})
    context.add_init_script("""
      window.__audioContextConstructed=0; window.__getUserMediaCalls=0;
      for (const key of ['AudioContext','webkitAudioContext']) if (window[key]) {
        const Original=window[key]; window[key]=new Proxy(Original,{construct(target,args){window.__audioContextConstructed++;return Reflect.construct(target,args)}});
      }
      if (navigator.mediaDevices?.getUserMedia) { const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=(...args)=>{window.__getUserMediaCalls++;return original(...args)}; }
    """)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    visuals = visual_regression(page)
    reports = [exercise(page, width, 844) for width in (320, 360, 390, 412, 480)]
    landscape = exercise(page, 844, 390)
    assert not errors, errors
    (OUT / "text-animation-check-results.json").write_text(json.dumps({"responsive": reports, "landscape": landscape, "visualScenes": visuals, "pageErrors": errors}, ensure_ascii=False, indent=2))
    print("L14-C3 visual-scene, transitions, mirrored-face, and silent text-animation checks passed at 320, 360, 390, 412, 480px and landscape.")
    browser.close()
