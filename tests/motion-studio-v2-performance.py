import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASELINE = Path(sys.argv[1]).resolve()
CURRENT = Path(sys.argv[2]).resolve()


def measure(browser, html, counts):
    results = []
    for count in counts:
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.goto(html.as_uri(), wait_until="load")
        page.wait_for_function("document.documentElement.dataset.engineReady === 'true'")
        page.locator('[data-section="motion"]').click()
        page.locator("#sceneDuration").evaluate("el => { el.value='3'; el.dispatchEvent(new Event('change', {bubbles:true})); }")
        page.locator("#closeSheetButton").click()
        for total in range(2, count + 1):
            page.locator("#addSceneButton").click()
            page.wait_for_function("n => document.querySelectorAll('.scene-card').length === n", arg=total)
        page.locator("#playButton").click()
        sample = page.evaluate("""async () => {
          const intervals = []; let last = 0; const end = performance.now() + 2200;
          await new Promise(resolve => { function frame(t) { if (last) intervals.push(t-last); last=t; if (t < end) requestAnimationFrame(frame); else resolve(); } requestAnimationFrame(frame); });
          const ordered=[...intervals].sort((a,b)=>a-b); const avg=intervals.reduce((a,b)=>a+b,0)/Math.max(1,intervals.length);
          return {frames:intervals.length, fps: +(1000/avg).toFixed(1), p95FrameMs:+(ordered[Math.floor(ordered.length*.95)]||0).toFixed(2), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(1) : null, domNodes:document.getElementsByTagName('*').length};
        }""")
        results.append({"scenes": count, **sample})
        page.close()
    return results

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--allow-file-access-from-files", "--js-flags=--expose-gc"])
    before = measure(browser, BASELINE, [10, 20, 50])
    after = measure(browser, CURRENT, [10, 20, 50])
    browser.close()
print(json.dumps({"environment": "GitHub Actions ubuntu-24.04, Chromium headless, 390x844 CSS viewport, device scale factor 1; all scenes set to 3s; rAF 2.2s sample, JS heap reported when Chromium exposes performance.memory. Reference source is commit 9918fae; its V1-only 32-scene validator is raised to 64 in the temporary benchmark checkout so the unchanged reference renderer can be measured at 50 scenes.", "before": before, "after": after}, ensure_ascii=False))
