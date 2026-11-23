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
await writeFile(resolve(outputDirectory, "README.txt"), `QARTON Motion Studio ${previewLabel} — Android preview\n\n1. Download the ${previewLabel} Android preview ZIP from the successful GitHub Actions run attached to this Draft PR and extract it in Android Files.\n2. Tap index.html and open with Chrome. It is a single self-contained file; the editor can start from file:// without a computer.\n3. Choose a photo, duration, aspect ratio and Fit/Fill. Camera, character, dialogue mouth cues, audio playback and visual effects use one scene timebase. Use their Timeline lanes to seek and edit.\n4. In “مسارات المؤثرات المرئية”, add Fade, Dissolve, Vignette, Letterbox, Shake, Flash or Tint. Select a clip to edit its timing, easing and From/To channels. Effect values hold their final state after the clip ends; set an end value to zero or delete the clip to remove it. Escape cancels a drag and restores the original start time.\n5. In “مسارات الصوت”, choose a local MP3, M4A/AAC, WAV, OGG or WebM file up to 20 MiB. Select Dialogue, Music or SFX and add the file at the playhead. Drag a clip or edit its start, duration and volume. Add dialogue mouth cues manually by choosing العربية الفصحى or التونسية and a Viseme at the playhead; no speech recognition or automatic lip-sync is generated. Set track and master volume.\n6. Save JSON to keep project tracks and audio asset metadata. Audio bytes are not embedded. When reopening, reselect each linked local audio file from the phone; the app matches its filename/type/size and reconnects the saved asset identifier. Legacy projects remain supported.\n7. To test video export, choose WebM or MP4 when MediaRecorder reports support, use 3 seconds + Economy first, optionally enable the existing test pulse, and keep Chrome in the foreground. Preview and save the result.\n\nThis one-file preview can open via file:// in Chrome. CI checks browser behavior and export, but HONOR 400 Pro codec/container support, touch feel, local audio decode/latency, audio synchronization, memory pressure, and saved-file playback still require a real phone test. Audio tracks are not muxed into exported video; authored dialogue Viseme cues animate the character mouth in both preview and exported frames. This L9-B integration is based on the L8-B Motion Studio branch and composes with the separate L9-A effects core without changing those PRs.\n`);
console.log(`Built self-contained preview at ${resolve(outputDirectory, "index.html")}`);
