import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "examples/browser-smoke.html" : pathname.slice(1);
    const target = resolve(root, relative);
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, { "content-type": mime[extname(target)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:" + address.port + "/examples/browser-smoke.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Scene dawn active"), null, { timeout: 15000 });

  const initial = await page.evaluate(() => ({
    backgroundLayers: document.querySelectorAll(".qarton-scene img").length,
    characters: document.querySelector("#character-layer")?.children.length ?? 0
  }));
  assert.equal(initial.backgroundLayers, 2, "dawn scene should mount both background layers");
  assert.equal(initial.characters, 2, "both character rigs should mount");

  await page.locator("#scene-two").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Scene dusk active"), null, { timeout: 15000 });
  assert.equal(await page.locator(".qarton-scene img").count(), 2, "dusk scene should mount both background layers");

  await page.locator("#audio").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Audio cues started"), null, { timeout: 5000 });

  await page.locator("#destroy").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.startsWith("Destroyed:"), null, { timeout: 10000 });
  assert.deepEqual(pageErrors, [], "showcase should not throw uncaught browser errors");

  process.stdout.write("Browser showcase passed: initial scene, layered backgrounds, two character rigs, scene transition, gesture-started audio, teardown; 0 page errors.\n");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
