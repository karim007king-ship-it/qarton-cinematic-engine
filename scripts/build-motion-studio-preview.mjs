import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "examples/motion-studio-lab");
const previewSlug = process.env.MOTION_STUDIO_PREVIEW_SLUG || "motion-studio-l5-android-preview";
const previewLabel = process.env.MOTION_STUDIO_PREVIEW_LABEL || "L5";
if (!/^[a-z0-9-]+$/u.test(previewSlug) || !/^L[0-9]+(?:-[A-Z])?$/u.test(previewLabel)) {
  throw new Error("Invalid Motion Studio preview slug or label");
}
const outputDirectory = resolve(root, "dist", previewSlug);
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
await writeFile(resolve(outputDirectory, "README.txt"), `QARTON Motion Studio ${previewLabel} — Android preview\n\n1. Download this branch's ${previewLabel} Android preview ZIP from its successful GitHub Actions run and extract it in Android Files.\n2. Tap index.html and open with Chrome. The preview is a single self-contained file; do not use the repository's multi-file index.html with file://.\n3. Allow photo selection. Set the project duration, choose the aspect ratio and Fit/Fill, then use the Timeline below the Canvas. Tap the track to seek, tap ＋ to add a key at the playhead, tap a diamond to select it, drag it horizontally to move it, edit X/Y/Zoom/Rotation, and delete only the selected key.\n4. To test export, choose WebM or MP4 when the device reports support, set 3 seconds + Economy first, optionally enable test audio, and keep Chrome in the foreground. Preview and save the result. If MP4 is rejected, use “Try WebM instead” and retry.\n\nThis one-file artifact can be opened from file:// in Chrome and was checked in desktop/touch Chromium CI. Android MediaRecorder behavior, touch feel, audio synchronization, saved-file opening, and device memory still require a real HONOR 400 Pro test.\n`);
console.log(`Built self-contained preview at ${resolve(outputDirectory, "index.html")}`);
