"""Verify the original sprites on the production Canvas and offline artifacts."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import zipfile
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
NAMES = ("layla", "nour", "salim", "youssef")
LABELS = ("Original", "Closed", "Open", "Round", "Wide", "Teeth", "Blink")
ORIGINALS = ROOT / "examples/cinematic-runtime-lab/assets/characters"
JAVASCRIPT = """
async ({ names, originals }) => {
  const runtime = window.qartonCinematicRuntime;
  const renderer = window.qartonCinematicRenderer;
  const counts = {};
  const portraits = [];
  const live = {};
  const Renderer = renderer.constructor;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const closeup = new Renderer(canvas);
  const mouthLayer = (renderer, id) => renderer.metrics.lastDraw.characterGeometry[id].layers.find(l => l.role === 'mouth');
  const read = (ctx, x, y, w, h) => Array.from(ctx.getImageData(x,y,w,h).data);
  for (const name of names) {
    const scene = [...runtime.story.byId.values()].find(s => s.textScene.turns.some(t => t.speakerId === name));
    await runtime.loadScene(scene.id);
    const frame = window.__runtimeLastFrame;
    const source = frame.scene.characters.find(c => c.id === name);
    const speakingTurns = scene.textScene.turns.filter(t => t.speakerId === name);
    const seen = new Set();
    let matchedVisibleText = false;
    for (const turn of speakingTurns) {
      for (const event of turn.animation.events) {
        if (event.viseme === 'rest') continue;
        await runtime.seek(event.atMs + 5);
        if (window.__runtimeLastFrame.timeMs !== event.atMs + 5) continue;
        if (mouthLayer(renderer, name).variant !== event.viseme) throw Error('Text/face timing: ' + name);
        if (runtime.getState().visibleText.length > 0) matchedVisibleText = true;
        seen.add(event.viseme);
        for (const other of scene.characters.filter(c => c.id !== name)) {
          if (mouthLayer(renderer, other.id).variant !== 'closed') throw Error('Listener speaking: ' + other.id);
        }
      }
    }
    if (seen.size < 2 || !matchedVisibleText) throw Error('No visible text-driven animation: ' + name);
    live[name] = [...seen];

    // Fixed camera and source-size character for pixel comparisons.
    const actor = {...source, x: .5, y: 1, scale: 1/.7, facing: 'right', expression: 'neutral'};
    const still = {...scene, characters: [actor], backgrounds: [], lighting: {intensity:0},
      textScene: {...scene.textScene, characters: [actor], turns: []}};
    const crop = document.createElement('canvas');
    crop.width = 330; crop.height = 260;
    const ctx = crop.getContext('2d');
    const original = new Image();
    original.src = originals[name];
    await original.decode();
    const drawCrop = (source, sx, sy) => {
      ctx.fillStyle = '#6a6361';
      ctx.fillRect(0,0,crop.width,crop.height);
      ctx.drawImage(source,sx,sy);
      portraits.push(crop.toDataURL());
    };
    closeup.render({...frame, scene:still, characterAssets:new Map([[name,original]]),
      timeMs:0, camera:null, direction:null});
    drawCrop(canvas, -325, -2);
    const pixelMouths = new Set();
    let openEyes;
    let headed = false;
    for (const variant of ['closed','open','round','wide','teeth','blink']) {
      const blink = variant === 'blink';
      const turn = {startMs:0,endMs:200,speakerId:name,expression:'neutral',
        animation:{sample:()=>({viseme:blink?'closed':variant,blink:blink?1:0,headRotation:0})}};
      still.textScene.turns = [turn];
      closeup.render({...frame, scene:still, timeMs:0, camera:null, direction:null});
      const geometry = closeup.metrics.lastDraw.characterGeometry[name];
      if (!geometry.faceRigValid) throw Error('Uncalibrated ' + name);
      const mouth = mouthLayer(closeup,name);
      const eyes = geometry.layers.filter(l=>l.role==='eye_left' || l.role==='eye_right');
      const layerCtx = canvas.getContext('2d');
      const eyePixels = eyes.map(eye=>JSON.stringify(read(layerCtx,Math.floor(eye.anchorX-8),Math.floor(eye.anchorY-8),16,16)));
      if (variant==='closed') openEyes=eyePixels;
      if (blink && eyes.some((eye,i)=>eyePixels[i]===openEyes[i] || eye.variant!=='closed')) throw Error('Blink pixels unchanged ' + name);
      const head = geometry.layers.find(l=>l.role==='head');
      headed = head.rotation !== 0 && head.rotation === mouth.rotation && eyes.every(eye=>eye.rotation === head.rotation);
      const pixels = read(layerCtx,Math.floor(mouth.anchorX-15),Math.floor(mouth.anchorY-8),30,16);
      if (!blink) pixelMouths.add(JSON.stringify(pixels));
      drawCrop(canvas,-325,-2);
    }
    if (pixelMouths.size !== 5 || !headed) throw Error('Canvas pose/rotation mismatch ' + name);
    still.textScene.turns[0].expression = 'determined';
    closeup.render({...frame, scene:still, timeMs:0, camera:null, direction:null});
    const brows = closeup.metrics.lastDraw.characterGeometry[name].layers.filter(l=>l.role.startsWith('brow_'));
    if (brows.length!==2 || !brows.every(brow=>brow.variant==='determined')) throw Error('Expression not drawn ' + name);
    counts[name] = pixelMouths.size;
  }
  closeup.dispose();
  return {counts, portraits, live};
}
"""

def main():
    originals = {name: "data:image/webp;base64," + base64.b64encode((ORIGINALS / f"{name}.webp").read_bytes()).decode() for name in NAMES}
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"))
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
        context.add_init_script("""
          window.audioCalls = 0;
          for (const key of ['AudioContext','webkitAudioContext','MediaRecorder']) {
            if (window[key]) window[key] = class { constructor() { window.audioCalls++; throw Error(key); } };
          }
        """)
        page = context.new_page()
        errors, requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda req: requests.append(req.url) if req.url.startswith(("http:", "https:")) else None)
        standalone = DIST / "qarton-cinematic-runtime-standalone.html"
        page.goto(standalone.as_uri())
        page.wait_for_function("window.__runtimeLastFrame")
        results = page.evaluate(JAVASCRIPT, {"names": NAMES, "originals": originals})
        sheet = Image.new("RGB", (330 * len(LABELS), 284 * len(NAMES)), "#201a17")
        draw = ImageDraw.Draw(sheet)
        for index, portrait in enumerate(results.pop("portraits")):
            row, col = divmod(index, len(LABELS))
            xy = (col * 330, row * 284)
            draw.text((xy[0] + 10, xy[1] + 4), f"{NAMES[row].capitalize()}  |  {LABELS[col]}", fill="#ffe6b5")
            sheet.paste(Image.open(io.BytesIO(base64.b64decode(portrait.split(",", 1)[1]))), (xy[0], xy[1] + 24))
        sheet.save(DIST / "cinematic-face-comparison.png")
        with zipfile.ZipFile(DIST / "qarton-cinematic-runtime-android-preview.zip") as preview:
            assert preview.read("index.html") == standalone.read_bytes()
            preview.extractall(temp)
        page.goto((Path(temp) / "index.html").as_uri())
        page.wait_for_function("window.__runtimeLastFrame")
        ending = page.evaluate("""async () => {
          const rt=window.qartonCinematicRuntime;
          for (let i=0;i<12;i++) {
            const scene=rt.story.byId.get(rt.getState().sceneId);
            await rt.seek(scene.durationMs);
            const state=rt.getState();
            if (state.endingId) return state.endingId;
            if (state.pendingChoiceId) {
              const choice=rt.story.byId.get(state.sceneId).choices.find(c=>c.id===state.pendingChoiceId);
              if (!choice) continue;
              await rt.selectChoice(choice.options[0].id);
            } else if (state.transport==='waitingForAdvance') await rt.advanceDialogue();
            else { await rt.play(); await new Promise(resolve=>setTimeout(resolve,100)); }
          }
          return rt.getState().endingId;
        }""")
        assert ending, "No offline story ending reached"
        assert not errors and not requests, (errors, requests)
        assert page.evaluate("window.audioCalls") == 0
        results.update(offlineEnding=ending, httpRequests=len(requests), assetBytes=page.evaluate("window.qartonCinematicRuntime.decodedAssetBytes"),
                       htmlSha256=hashlib.sha256(standalone.read_bytes()).hexdigest())
        (DIST / "cinematic-face-browser-results.json").write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
