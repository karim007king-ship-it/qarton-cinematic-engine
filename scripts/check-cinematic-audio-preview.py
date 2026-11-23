from pathlib import Path
from os import environ
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from shutil import which
from threading import Thread
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
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

    handler = partial(SimpleHTTPRequestHandler, directory=str(root.parent))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        source_url = f"http://127.0.0.1:{server.server_port}/{root.name}/examples/cinematic-audio-lab/"
        page.goto(source_url, wait_until="load")
        result = page.evaluate("""async (repo) => {
          const { compileCinematicAudioProject, createCinematicAudioPlayer } =
            await import(`/${repo}/src/audio/cinematic-audio-core.js`);
          const assert = (ok, message) => { if (!ok) throw new Error(message); };
          const twoTracks = compileCinematicAudioProject({ durationMs: 2000, tracks: [
            { id: 'dialogue', type: 'dialogue', clips: [{ id: 'line', asset: 'line', startMs: 0, durationMs: 1500, language: 'ar' }] },
            { id: 'music', type: 'music', clips: [{ id: 'bed', asset: 'bed', startMs: 0, durationMs: 2000, loop: true }] }
          ] });
          let failBed = true;
          const started = [], stopped = [];
          const partial = createCinematicAudioPlayer(twoTracks, {
            play: (asset, options) => {
              if (asset === 'bed' && failBed) throw new Error('second voice start failed');
              const voice = { asset, id: options.id }; started.push(voice); return voice;
            },
            stop: voice => stopped.push(voice.id)
          });
          let playError = '';
          try { partial.play(); } catch (error) { playError = error.message; }
          assert(partial.state === 'paused' && partial.timeMs === 0 && partial.activeVoiceCount === 0,
            'partial multi-clip Play must roll back and clean the first voice');
          assert(stopped.length === 1 && playError.includes('second voice'), 'partial Play failure was not surfaced');
          failBed = false; partial.play(); assert(partial.activeVoiceCount === 2, 'Play retry did not start both clips');
          partial.destroy();

          let now = 0, canStop = false;
          const stopPlayer = createCinematicAudioPlayer(compileCinematicAudioProject({ durationMs: 1500, tracks: [
            { id: 'music', type: 'music', clips: [{ id: 'stop-bed', asset: 'stop-bed', startMs: 0, durationMs: 1500, loop: true }] }
          ] }), {
            now: () => now, play: () => ({ id: 'voice' }),
            stop: () => { if (!canStop) throw new Error('injected stop failure'); }
          });
          stopPlayer.play(); now = 120; stopPlayer.tick(); now = 200;
          try { stopPlayer.pause(); } catch { /* expected: stop and rollback cleanup both fail */ }
          assert(stopPlayer.state === 'error' && stopPlayer.timeMs === 200 && stopPlayer.activeVoiceCount === 1,
            'Stop failure must freeze the pause time and retain ownership for cleanup');
          canStop = true; stopPlayer.recover();
          assert(stopPlayer.state === 'paused' && stopPlayer.activeVoiceCount === 0 && stopPlayer.timeMs === 200,
            'recover() did not finish cleanup at the committed time');
          stopPlayer.destroy();

          let failLine = false, seekNow = 0;
          const seekPlayer = createCinematicAudioPlayer(twoTracks, {
            now: () => seekNow,
            play: (asset, options) => {
              if (asset === 'line' && failLine) throw new Error('injected seek start failure');
              return { asset, id: options.id };
            }, stop: () => {}
          });
          seekPlayer.play(); seekNow = 100; seekPlayer.tick(); failLine = true;
          let seekError = '';
          try { seekPlayer.seek(700); } catch (error) { seekError = error.message; }
          assert(seekPlayer.state === 'paused' && seekPlayer.timeMs === 100 && seekPlayer.activeVoiceCount === 0,
            'failed Seek must roll back and stop its partial restart');
          assert(seekError.includes('seek start'), 'Seek adapter failure was not surfaced');
          failLine = false; seekPlayer.seek(700); seekPlayer.play();
          assert(seekPlayer.state === 'playing' && seekPlayer.timeMs === 700, 'Seek retry did not resume at its target');
          seekPlayer.destroy();
          return { playError, seekError, partialCleanup: stopped.length, recoveredStop: true, rolledBackSeek: true };
        }""", root.name)
        assert "second voice" in result["playError"]
        assert "seek start" in result["seekError"]
        assert result["recoveredStop"] and result["rolledBackSeek"]
        server.shutdown()
    browser.close()
print("Chromium Android preview and adapter-failure checks passed")
