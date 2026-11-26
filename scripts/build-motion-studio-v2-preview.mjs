import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inlineMotionStudioV2Html } from "../examples/motion-studio-v2/standalone-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "examples/motion-studio-v2");
const commit = process.env.L14B_COMMIT || process.env.GITHUB_SHA || "";
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
const outDir = resolve(root, "dist/motion-studio-v2-l14b-android-preview");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "index.html"), output);
await writeFile(resolve(outDir, "qarton-motion-studio-v2.html"), output);
await writeFile(resolve(outDir, "README.txt"), `QARTON Motion Studio V2 — L14-B Android Preview\n\nOpen index.html with Chrome on Android. This is one self-contained HTML file and runs offline.\nThe visible Commit label identifies the exact published build.\n\nConnected to the existing Motion Studio sequence, camera, scene clock, asset registry, image decoder and renderer. Image add, replace and remove; independent scenes; camera motion; seek and playback are implemented. Audio, recording, save and export remain prototypes in this phase.\n`);
console.log(`Built standalone L14-B preview for ${commit.slice(0, 12)}`);
