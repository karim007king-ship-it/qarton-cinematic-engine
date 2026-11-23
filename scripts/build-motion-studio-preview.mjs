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
await writeFile(resolve(outputDirectory, "README.txt"), `QARTON Motion Studio ${previewLabel} — Android preview\n\n1. Download the ${previewLabel} Android preview ZIP from the successful GitHub Actions run attached to this Draft PR and extract it in Android Files.\n2. Tap index.html and open with Chrome. It is a single self-contained file; the editor can start from file:// without a computer.\n3. Choose a photo, duration, aspect ratio and Fit/Fill. Camera, character, dialogue mouth cues, audio playback and visual effects use one scene timebase. Use their Timeline lanes to seek and edit.\n4. In “مسارات المؤثرات المرئية”, add Fade, Dissolve, Vignette, Letterbox, Shake, Flash or Tint. Select a clip to edit its timing, easing and From/To channels. Effect values hold their final state after the clip ends; set an end value to zero or delete the clip to remove it. Escape cancels a drag and restores the original start time.\n5. In “مسارات الصوت”, choose a local MP3, M4A/AAC, WAV, OGG or WebM file up to 20 MiB. Select Dialogue, Music or SFX and add the file at the playhead. Drag a clip or edit its start, duration and volume. Add dialogue mouth cues manually by choosing العربية الفصحى or التونسية and a Viseme at the playhead; no speech recognition or automatic lip-sync is generated. Set track and master volume.\n6. Save JSON to keep project tracks and audio asset metadata. Audio bytes are not embedded. When reopening, reselect each linked local audio file from the phone; the app matches its filename/type/size and reconnects the saved asset identifier. Legacy projects remain supported.\n7. For integrated export, choose a scene range up to 60 seconds, select 480p/720p/1080p, pick MP4/WebM or Auto, and choose whether to mix audio. Re-select local audio files after opening a saved project, then run the device capability probe for the exact quality and format. Start export only when the probe confirms support; keep Chrome in the foreground until progress completes. Preview and save the result. The original L5 video-only exporter remains available separately.\n\nThis one-file preview runs from file:// in Chrome and needs no network after download. CI exercises MediaRecorder and Web Audio and checks audio/video marker drift by decoding the recorded WebM. It does not establish HONOR 400 Pro codec support, Android touch behavior, sustained memory use, or saved-file playback; those still require a real phone test. Authored dialogue Viseme cues use the same scene timestamp in preview and export. Audio assets remain local and are not embedded in project JSON. This is L10-B; no L11 work is included.\n`);
console.log(`Built self-contained preview at ${resolve(outputDirectory, "index.html")}`);
