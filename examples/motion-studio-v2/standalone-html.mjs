export function inlineMotionStudioV2Html(html, css, javascript, commit) {
  if (typeof html !== "string" || !/<html\b/iu.test(html) || !/<\/body>/iu.test(html)) {
    throw new TypeError("Motion Studio source HTML is missing.");
  }
  if (typeof css !== "string" || !css.includes(":root") || !css.includes(".studio") || css.length < 400) {
    throw new TypeError("Motion Studio CSS is missing or incomplete; standalone build stopped.");
  }
  if (typeof javascript !== "string" || !javascript.includes("createStudioV2Engine") ||
      !javascript.includes("createSceneClock") || javascript.length < 4000) {
    throw new TypeError("Motion Studio engine JavaScript is missing or incomplete; standalone build stopped.");
  }
  if (!/^[0-9a-f]{7,40}$/iu.test(commit)) throw new TypeError("A source commit id is required.");
  let result = html.replace(/<link\s+rel="stylesheet"\s+href="\.\/app\.css"\s*>/iu, `<style>\n${css}\n</style>`);
  result = result.replace(/<script\s+type="module"\s+src="\.\/app\.js"\s*>\s*<\/script>/iu,
    `<script>\n${javascript}\n</script>`);
  result = result.replace('data-commit="dev"', `data-commit="${commit}"`);
  const resourceTags = [...result.matchAll(/<(?:script|link)\b[^>]*>/giu)].map(match => match[0]);
  const unbundledResource = resourceTags.some(tag =>
    /<script\b[^>]*\bsrc\s*=/iu.test(tag) || /<link\b[^>]*\bhref\s*=/iu.test(tag) ||
    /(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu.test(tag));
  if (result === html || unbundledResource || /@import\s+url\(\s*["']?https?:\/\//iu.test(css) ||
      /url\(\s*["']?https?:\/\//iu.test(css)) {
    throw new Error("Standalone build still references an external resource.");
  }
  if (!result.includes(`data-commit="${commit}"`) || !result.includes("createStudioV2Engine")) {
    throw new Error("Standalone HTML is missing its commit or engine bundle.");
  }
  return result;
}
