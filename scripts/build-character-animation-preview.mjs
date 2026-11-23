import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const source = resolve(root, "examples/character-animation-lab");
const output = resolve(root, "dist/qarton-character-animation-l7a-android-preview");
const [html, css, sheet] = await Promise.all([
  readFile(resolve(source, "index.html"), "utf8"),
  readFile(resolve(source, "style.css"), "utf8"),
  readFile(resolve(source, "gesture-sheet.svg"))
]);
const result = await build({
  entryPoints: [resolve(source, "lab.js")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100"]
});
const bundle = result.outputFiles[0].text;
const sheetUrl = `data:image/svg+xml;base64,${sheet.toString("base64")}`;
const bundledHtml = html
  .replace('<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`)
  .replace('href="./gesture-sheet.svg"', `href="${sheetUrl}"`)
  .replace('<script type="module" src="./lab.js"></script>', `<script>${bundle}</script>`);
if (bundledHtml === html || bundledHtml.includes("type=\"module\"") || bundledHtml.includes("./style.css")) {
  throw new Error("Android preview bundling did not inline all page resources");
}
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "index.html"), bundledHtml);
await writeFile(resolve(output, "README.txt"), [
  "QARTON Character Animation L7-A Android preview",
  "",
  "Extract this folder on Android and open index.html in Chrome.",
  "It is a single self-contained file; it does not need a server or internet connection.",
  "Use the timeline to inspect deterministic samples, then test play, pause, replay and scene switching."
].join("\n"));
console.log(`Built offline Android preview: ${resolve(output, "index.html")}`);
