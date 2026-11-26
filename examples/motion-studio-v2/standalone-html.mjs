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
  let markup = html.replace(/<link\s+rel="stylesheet"\s+href="\.\/app\.css"\s*>/iu, `<style>\n${css}\n</style>`);
  markup = markup.replace(/<script\s+type="module"\s+src="\.\/app\.js"\s*>\s*<\/script>/iu, "");
  const externalMarkupResource = /<(?:script|link|img|iframe|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu.test(markup) ||
    /<(?:script|link|img|iframe|audio|video|source)\b[^>]*\b(?:src|href)\s*=/iu.test(markup);
  const safeJavascript = javascript.replace(/<\/script/giu, "<\\/script");
  let result = markup.replace("</body>", `<script>\n${safeJavascript}\n</script>\n</body>`);
  result = result.replace('data-commit="dev"', `data-commit="${commit}"`);
  if (result === html || externalMarkupResource || /@import\s+url\(\s*["']?https?:\/\//iu.test(css) ||
      /url\(\s*["']?https?:\/\//iu.test(css)) {
    throw new Error("Standalone build still references an external resource.");
  }
  if (!result.includes(`data-commit="${commit}"`) || !result.includes("createStudioV2Engine")) {
    throw new Error("Standalone HTML is missing its commit or engine bundle.");
  }
  return result;
}
