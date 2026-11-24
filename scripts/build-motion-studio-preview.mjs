import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inlinePreviewAssets } from "./motion-studio-preview-html.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "examples/motion-studio-lab");
const previewSlug = process.env.MOTION_STUDIO_PREVIEW_SLUG || "motion-studio-l5-android-preview";
const previewLabel = process.env.MOTION_STUDIO_PREVIEW_LABEL || "L5";
if (!/^[a-z0-9-]+$/u.test(previewSlug) || !/^L[0-9]+(?:-[A-Z][0-9]?)?$/u.test(previewLabel)) {
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

const html = inlinePreviewAssets(htmlSource, css, bundled.outputFiles[0].text);

if (html === htmlSource || /<script type="importmap">|type="module" src=\.\/studio\.js/u.test(html) || /from\s+["'](?:\.|@qarton)\//u.test(bundled.outputFiles[0].text)) {
  throw new Error("Could not produce a self-contained Motion Studio preview document.");
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "index.html"), html);
await writeFile(resolve(outputDirectory, "README.txt"), `QARTON Motion Studio ${previewLabel} — Android preview\n\n1. Download the ${previewLabel} Android preview ZIP from the successful GitHub Actions run attached to this Draft PR and extract it in Android Files.\n2. Tap index.html and open with Chrome. It is a single self-contained file and works offline from file://.\n3. The scene strip supports touch selection, add, duplicate, delete and left/right reorder. Edit the selected scene name and duration (3–60 seconds). The project is limited to 32 scenes and the sequence core enforces the total duration limit.\n4. Every scene has its own local timeline; the global timeline shows scene durations and uses direct Cuts. Play, Pause, Seek and Replay share the sequence clock. A seek exactly on a Cut selects the following scene at local time zero.\n5. The shared asset library tracks images, audio and character sprite references. An asset in use cannot be deleted. Asset bytes stay in local browser storage and are not embedded in JSON. On another device, re-link local media files.\n6. Existing single-scene project JSON still opens in its original format. Saving a multi-scene project creates a versioned sequence JSON file.\n7. Integrated export remains the existing single-scene L10 path; this preview does not add multi-scene export. The L5 video-only exporter is also preserved.\n\nThe preview requires no network after download. CI tests desktop and mobile Chromium behavior, including touch scene operations, and Node sequence/assets regressions. It does not establish behavior on a physical Android device; verify touch handling and offline storage on your phone.\n`);
console.log(`Built self-contained preview at ${resolve(outputDirectory, "index.html")}`);
