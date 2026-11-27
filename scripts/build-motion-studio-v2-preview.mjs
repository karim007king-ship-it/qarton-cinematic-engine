import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inlineMotionStudioV2Html } from "../examples/motion-studio-v2/standalone-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "examples/motion-studio-v2");
const commit = process.env.L14C1_COMMIT || process.env.L14B_COMMIT || process.env.GITHUB_SHA || "";
const [html, css] = await Promise.all([
  readFile(resolve(source, "index.html"), "utf8"),
  readFile(resolve(source, "app.css"), "utf8")
]);
const bundled = await build({
  entryPoints: [resolve(source, "app.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  legalComments: "none",
  outfile: "qarton-motion-studio-v2.js",
  alias: {
    "@qarton/cinematic-engine/motion-studio": resolve(root, "packages/motion-studio/index.js"),
    "@qarton/cinematic-engine/camera": resolve(root, "src/camera/camera-track.js"),
    "@qarton/cinematic-engine/motion": resolve(root, "src/motion/easing.js"),
    "@qarton/cinematic-engine/motion/timeline": resolve(root, "src/motion/timeline.js")
  }
});
const output = inlineMotionStudioV2Html(html, css, bundled.outputFiles[0].text, commit);
const outDir = resolve(root, "dist/motion-studio-v2-l14c1-android-preview");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "index.html"), output);
await writeFile(resolve(outDir, "qarton-motion-studio-v2.html"), output);
await writeFile(resolve(outDir, "README.txt"), `QARTON Motion Studio V2 — L14-C1 Android Preview\n\nOpen index.html with Chrome on Android. This is one self-contained HTML file and runs offline. The visible Commit label identifies the exact build.\n\nImage and scene editing, camera motion, shared-clock audio import and microphone recording are connected. Audio is accepted only after browser AudioContext decoding and a non-silent PCM signal check. MP3, WAV, AAC/M4A, OGG and WebM depend on the decoder available in the browser. AMR is attempted locally through that same decoder; Android Chromium commonly does not decode AMR, so failure keeps existing clips.\n\nDialogue, music and SFX tracks support gain/mute, move, trim and delete. Audio can be attached to one scene or span the whole sequence. Audio, projects and recordings are kept in memory for this standalone preview and are not saved across reloads. Video export remains out of scope. PCM retention stays within the existing 32 MiB budget.\n`);
console.log(`Built standalone L14-C1 preview for ${commit.slice(0, 12)}`);
