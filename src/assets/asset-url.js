/**
 * Validate host-resolved asset URLs before assigning them to DOM media nodes.
 * Relative paths, HTTP(S), blob:, and data: URLs remain supported.
 */
export function assertSafeAssetUrl(value, key = "asset") {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(\`Asset resolver returned no URL for "\${key}"\`);
  }
  const url = value.trim();
  const hasControlCharacter = [...url].some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  const scheme = url.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  const hasAllowedScheme = !scheme ||
    scheme === "blob" ||
    scheme === "data" ||
    ((scheme === "http" || scheme === "https") && /^https?:\/\//i.test(url));

  if (hasControlCharacter || url.includes("\\") || url.startsWith("//") || !hasAllowedScheme) {
    throw new TypeError(\`Asset resolver returned an unsafe URL for "\${key}"\`);
  }
  return url;
}
