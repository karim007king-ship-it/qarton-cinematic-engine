import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filePath = resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "chromium", "chrome", "chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_BIN to its executable path.");
}

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});

try {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/examples/browser-smoke.html?smoke=1`;
  const chrome = findChrome();
  const result = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-zygote",
    "--no-first-run",
    "--no-default-browser-check",
    "--virtual-time-budget=15000",
    "--dump-dom",
    url
  ], { encoding: "utf8", timeout: 45000, maxBuffer: 10 * 1024 * 1024 });

  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || "Headless browser exited unsuccessfully");
  assert.match(result.stdout, /data-smoke-result="passed"/, [
    "Integrated browser showcase did not pass its scene-transition and cleanup checks.",
    result.stdout.slice(-6000),
    result.stderr
  ].join("\n"));
  process.stdout.write("Browser smoke passed: scene transitions, character mounts, and runtime cleanup.\n");
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
}
