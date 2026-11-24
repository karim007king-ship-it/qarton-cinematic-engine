export function inlinePreviewAssets(htmlSource, css, bundleText) {
  return htmlSource
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>\s*/u, "\n")
    .replace(/<link rel="stylesheet" href="\.\/studio\.css[^"]*">/u, () => `<style>\n${css}\n</style>`)
    .replace(/<script type="module" src="\.\/studio\.js[^"]*"><\/script>/u,
      () => `<script>\n${bundleText.replace(/<\/script/giu, "<\\/script")}\n</script>`);
}
