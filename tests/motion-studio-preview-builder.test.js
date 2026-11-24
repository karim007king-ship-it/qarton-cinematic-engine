import assert from "node:assert/strict";
import test from "node:test";
import { inlinePreviewAssets } from "../scripts/motion-studio-preview-html.js";

test("offline preview inlining preserves replacement tokens in bundled JavaScript", () => {
  const source = `<!doctype html><head><link rel="stylesheet" href="./studio.css?v=test">
    <script type="importmap">{"imports":{}}</script></head><body>
    <script type="module" src="./studio.js?v=test"></script></body>`;
  const bundle = `const mime = /^[a-z0-9!#$&^_.+-]+$/; const marker = "$&"; const closeTag = "</script>";`;
  const html = inlinePreviewAssets(source, "body { color: #fff; }", bundle);
  assert.doesNotMatch(html, /<script\s+type="importmap"/iu);
  assert.doesNotMatch(html, /<script\s+type="module"/iu);
  assert.ok(html.includes("const mime = /^[a-z0-9!#$&^_.+-]+$/;"));
  assert.ok(html.includes('const marker = "$&";'));
  assert.ok(html.includes('const closeTag = "<\\/script>";'));
  assert.match(html, /<style>\s*body \{ color: #fff; \}\s*<\/style>/u);
});
