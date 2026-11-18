import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeAssetUrl } from "../src/assets/asset-url.js";

test("accepts relative and supported media URLs", () => {
  for (const url of [
    "/assets/hero.webp",
    "./assets/hero.webp",
    "https://cdn.example.test/hero.webp",
    "blob:https://app.example.test/asset-id",
    "data:image/png;base64,AAAA"
  ]) {
    assert.equal(assertSafeAssetUrl(url), url);
  }
});

test("rejects executable, local-file, protocol-relative and malformed URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "VbScRiPt:alert(1)",
    "file:///etc/passwd",
    "//cdn.example.test/hero.webp",
    "/assets\\hero.webp",
    "\\\\cdn.example.test\\hero.webp",
    "/assets/hero\n.webp",
    "  "
  ]) {
    assert.throws(() => assertSafeAssetUrl(url), TypeError, url);
  }
});

test("normalizes surrounding whitespace without changing the URL", () => {
  assert.equal(assertSafeAssetUrl("  /assets/hero.webp  "), "/assets/hero.webp");
});
