import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "examples/motion-studio-lab");
const outputDirectory = resolve(root, "dist/motion-studio-l5-android-preview");
const [htmlSource, css] = await Promise.all([
  readFile(resolve(sourceDirectory, "index.html"), "utf8"),
  readFile(resolve(sourceDirectory, "studio.css"), "utf8")
]);

const bundled = await build({
  entryPoints: [resolve(sourceDirectory, "studio.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  legalComments: "none",
  outfile: "motion-studio.js",
  alias: {
    "@qarton/cinematic-engine/motion-studio": resolve(root, "packages/motion-studio/index.js"),
    "@qarton/cinematic-engine/camera": resolve(root, "src/camera/camera-track.js"),
    "@qarton/cinematic-engine/motion": resolve(root, "src/motion/easing.js"),
    "@qarton/cinematic-engine/motion/timeline": resolve(root, "src/motion/timeline.js")
  }
});

let html = htmlSource
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>\s*/u, "\n")
  .replace(/<link rel="stylesheet" href="\.\/studio\.css[^"]*">/u, `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="\.\/studio\.js[^"]*"><\/script>/u,
    `<script>\n${bundled.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}\n</script>`);

if (html === htmlSource || /<script type="importmap">|type="module" src=\.\/studio\.js/u.test(html) || /from\s+["'](?:\.|@qarton)\//u.test(bundled.outputFiles[0].text)) {
  throw new Error("Could not produce a self-contained Motion Studio preview document.");
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "index.html"), html);
await writeFile(resolve(outputDirectory, "README.txt"), `QARTON Motion Studio L5 — Android preview\n\n1. Extract this ZIP in Android Files.\n2. Tap index.html and open with Chrome. The preview is a single self-contained file; do not use the repository's multi-file index.html with file://.\n3. Allow photo selection. In Motion Studio, choose a supported format, then set 3 seconds + Economy for the first export. Keep Chrome open in the foreground.\n4. Preview and save the result. If MP4 is rejected, use “Try WebM instead” and retry.\n\nThe standalone file was checked for file:// startup and secure-context APIs in Chromium CI. Android encoding, audio synchronization, downloads, and device memory still require a real HONOR 400 Pro test.\n`);
console.log(`Built self-contained preview at ${resolve(outputDirectory, "index.html")}`);
