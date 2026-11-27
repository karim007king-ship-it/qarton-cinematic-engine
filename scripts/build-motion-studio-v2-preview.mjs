import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inlineMotionStudioV2Html } from "../examples/motion-studio-v2/standalone-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "examples/motion-studio-v2");
const commit = process.env.L14C2_COMMIT || process.env.L14B_COMMIT || process.env.GITHUB_SHA || "";
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
  loader: { ".png": "dataurl", ".webp": "dataurl" },
  outfile: "qarton-motion-studio-v2.js",
  alias: {
    "@qarton/cinematic-engine/motion-studio": resolve(root, "packages/motion-studio/index.js"),
    "@qarton/cinematic-engine/camera": resolve(root, "src/camera/camera-track.js"),
    "@qarton/cinematic-engine/motion": resolve(root, "src/motion/easing.js"),
    "@qarton/cinematic-engine/motion/timeline": resolve(root, "src/motion/timeline.js")
  }
});
const output = inlineMotionStudioV2Html(html, css, bundled.outputFiles[0].text, commit);
const outDir = resolve(root, "dist/motion-studio-v2-l14c2-android-preview");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "index.html"), output);
await writeFile(resolve(outDir, "qarton-motion-studio-v2.html"), output);
await writeFile(resolve(outDir, "README.txt"), `QARTON Motion Studio V2 — L14-C2 Android Preview\n\nOpen index.html on Android Chrome or in the local WebView. This single-file standalone preview runs offline and uses the displayed source commit. Text-driven characters, Tunisian and Modern Standard Arabic dialogue, expressions, breathing, blinking, gestures, multi-character scenes, shared-clock playback, seek, pause and replay are included. No microphone permission, AudioContext, or audio file is used by this build. Imported still images are optional.\n\nThis is a preview build: project persistence and video export are not enabled.\n`);
console.log(`Built standalone L14-C2 preview for ${commit.slice(0, 12)}`);
