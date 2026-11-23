import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const source = resolve(root,"examples/visual-effects-lab");
const output = resolve(root,"dist/cinematic-visual-effects-l9a");
const [html,css] = await Promise.all([
  readFile(resolve(source,"index.html"),"utf8"),
  readFile(resolve(source,"lab.css"),"utf8")
]);
const bundle = await build({entryPoints:[resolve(source,"lab.js")],bundle:true,write:false,format:"iife",platform:"browser",target:["chrome100"],legalComments:"none"});
let document = html.replace(/\s*<link rel="stylesheet" href="\.\/lab\.css">\s*/u,`\n<style>${css}</style>\n`)
  .replace(/<script type="module" src="\.\/lab\.js"><\/script>/u,`<script>${bundle.outputFiles[0].text.replace(/<\/script/giu,"<\\/script")}</script>`);
if (document === html || /type="module" src=\.\/lab\.js|href="\.\/lab\.css/u.test(document)) throw new Error("Preview bundle is not self-contained");
await mkdir(output,{recursive:true});
await writeFile(resolve(output,"index.html"),document);
await writeFile(resolve(output,"README.txt"),"QARTON L9-A Cinematic Visual Effects Preview\n\nExtract this ZIP in Android Files and open index.html with Chrome. The standalone page uses Canvas 2D, works offline, and includes play, pause, seek and replay.\n\nThe preview uses one 390×690 canvas (~1.03 MiB raw pixel storage) and no persistent offscreen buffers. WebView/Chrome performance depends on the phone and other active apps.\n");
console.log(`Built standalone Android preview: ${resolve(output,"index.html")}`);
