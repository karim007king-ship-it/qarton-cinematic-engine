import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
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
    if (spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) return candidate;
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_BIN to its executable path.");
}

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const profile = await mkdtemp(resolve(tmpdir(), "qarton-chrome-"));
let browser;
let socket;
let nextId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port: httpPort } = server.address();
  const chrome = findChrome();
  browser = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" });

  const activePortFile = resolve(profile, "DevToolsActivePort");
  let portInfo;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      portInfo = (await readFile(activePortFile, "utf8")).trim().split("\n");
      break;
    } catch {
      if (browser.exitCode !== null) throw new Error("Chrome exited before opening its DevTools endpoint");
      await delay(100);
    }
  }
  assert.ok(portInfo?.[0] && portInfo?.[1], "Chrome DevTools endpoint did not become ready");
  const debugPort = Number(portInfo[0]);
  const browserSocket = new WebSocket(`ws://127.0.0.1:${debugPort}${portInfo[1]}`);
  socket = browserSocket;
  await new Promise((resolveOpen, rejectOpen) => {
    browserSocket.addEventListener("open", resolveOpen, { once: true });
    browserSocket.addEventListener("error", rejectOpen, { once: true });
  });
  browserSocket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) command.reject(new Error(message.error.message));
    else command.resolve(message.result);
  });
  browserSocket.addEventListener("close", () => {
    for (const command of pending.values()) command.reject(new Error("Chrome DevTools connection closed"));
    pending.clear();
  });

  const target = await send("Target.createTarget", {
    url: `http://127.0.0.1:${httpPort}/examples/browser-smoke.html?smoke=1`
  });
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;

  let result = null;
  let status = "";
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const evaluated = await send("Runtime.evaluate", {
      expression: "document.documentElement?.dataset.smokeResult ?? null",
      returnByValue: true
    }, sessionId);
    result = evaluated.result?.value ?? null;
    if (result) break;
    const statusResult = await send("Runtime.evaluate", {
      expression: "document.querySelector('#status')?.textContent ?? 'page not ready'",
      returnByValue: true
    }, sessionId);
    status = statusResult.result?.value ?? "";
    await delay(200);
  }

  assert.equal(result, "passed", `Chromium showcase smoke failed. Page status: ${status}`);
  process.stdout.write("Chromium smoke passed: image decoding, repeated scene transitions, stable character count, and DOM cleanup.\n");
} finally {
  try { socket?.close(); } catch {}
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolveExit => browser.once("exit", resolveExit));
    browser.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (browser.exitCode === null) {
      const killed = new Promise(resolveExit => browser.once("exit", resolveExit));
      browser.kill("SIGKILL");
      await killed;
    }
  }
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
