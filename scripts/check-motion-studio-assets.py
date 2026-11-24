from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

server = ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{server.server_port}/package.json")
        page.evaluate("""async () => {
          const {openAssetStorage} = await import('/packages/motion-studio/asset-storage.js');
          const s = await openAssetStorage();
          await s.put('project-a','image',new Blob(['abcd'],{type:'image/png'}));
          await s.put('project-b','image',new Blob(['efgh'],{type:'image/png'}));
          s.close();
        }""")
        page.reload()
        page.evaluate("""async () => {
          const {openAssetStorage} = await import('/packages/motion-studio/asset-storage.js');
          const s = await openAssetStorage();
          const a = await s.get('project-a','image');
          if (a.type !== 'image/png' || await a.text() !== 'abcd') throw Error('Restore failed');
          const c = new AbortController(); c.abort();
          let cancelled = false;
          try { await s.remove('project-a','image',{signal:c.signal}); }
          catch(e) { cancelled = e.name === 'AbortError'; }
          if (!cancelled || !(await s.get('project-a','image'))) throw Error('Cancellation failed');
          await s.remove('project-a','image');
          if (await s.get('project-a','image') !== null) throw Error('Deletion failed');
          if (await (await s.get('project-b','image')).text() !== 'efgh') throw Error('Isolation failed');
          s.close();
        }""")
        browser.close()
        print("IndexedDB restore, isolation, cancellation and deletion passed")
finally:
    server.shutdown()
