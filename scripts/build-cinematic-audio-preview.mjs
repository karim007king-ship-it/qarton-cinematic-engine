import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const source = resolve(root, "examples/cinematic-audio-lab");
const output = resolve(root, "dist/cinematic-audio-l8a-android-preview");
await mkdir(output, { recursive: true });
const html = await readFile(resolve(source, "index.html"), "utf8");
const css = await readFile(resolve(source, "style.css"), "utf8");
const bundle = await build({
  entryPoints: [resolve(source, "lab.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome100"],
  write: false
});
const js = bundle.outputFiles[0].text;
const inline = html
  .replace('<link rel="stylesheet" href="./style.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./lab.js"></script>', `<script type="module">\n${js}\n</script>`);
if (inline.includes("src=\"./lab.js\"") || inline.includes("href=\"./style.css\"")) {
  throw new Error("Standalone preview still references an external lab asset");
}
await writeFile(resolve(output, "index.html"), inline);
await writeFile(resolve(output, "README.txt"), [
  "QARTON L8-A Android preview",
  "Extract this ZIP in Android Files and open index.html with Chrome.",
  "Tap تشغيل once to enable Web Audio, then try pause, replay, seeking and the volume controls.",
  "The synthetic sound is a test tone; Arabic viseme/phoneme cues are manually prepared.",
  "No external JavaScript, CSS, image, or audio file is required."
].join("\n"));
console.log(`Built standalone preview: ${output}`);
