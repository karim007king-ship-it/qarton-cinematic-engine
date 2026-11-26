import test from "node:test";
import assert from "node:assert/strict";
import { inlineMotionStudioV2Html } from "../examples/motion-studio-v2/standalone-html.mjs";
const html = '<html data-commit="dev"><head><link rel="stylesheet" href="./app.css"></head><body><script type="module" src="./app.js"></script></body></html>';
const css = ':root{} .studio{}' + 'x'.repeat(500);
const js = 'createStudioV2Engine createSceneClock' + 'x'.repeat(5000);

test("inlines the styles, engine and exact commit into one offline file", () => {
  const result = inlineMotionStudioV2Html(html, css, js, "abcdef1234567890");
  assert.match(result, /<style>/u);
  assert.match(result, /data-commit="abcdef1234567890"/u);
  assert.match(result, /createStudioV2Engine/u);
  assert.doesNotMatch(result, /app\.css|app\.js/u);
});

test("fails the build when CSS is missing", () => {
  assert.throws(() => inlineMotionStudioV2Html(html, "", js, "abcdef1234567"), /CSS/u);
});

test("fails the build when engine JavaScript is missing", () => {
  assert.throws(() => inlineMotionStudioV2Html(html, css, "", "abcdef1234567"), /JavaScript/u);
});

test("rejects actual external script and stylesheet references", () => {
  const external = html.replace("</head>", '<script src="https://example.invalid/app.js"></script></head>');
  assert.throws(() => inlineMotionStudioV2Html(external, css, js, "abcdef1234567"), /external resource/u);
});
