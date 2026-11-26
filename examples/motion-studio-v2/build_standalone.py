from __future__ import annotations

import argparse
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HTML_LINK = '<link rel="stylesheet" href="./app.css">'
JS_LINK = '<script defer src="./app.js"></script>'
DOCUMENT_TAG = '<html lang="ar" dir="rtl" data-commit="dev">'


class BuildError(ValueError):
    pass


def build_bundle(html: str, css: str, js: str, commit_sha: str) -> str:
    commit_sha = commit_sha.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{7,40}", commit_sha):
        raise BuildError("A 7 to 40 character hexadecimal source commit is required.")
    if len(css.strip()) < 1000 or ".studio" not in css or "--bg:" not in css:
        raise BuildError("Stylesheet is missing or does not contain the Motion Studio design.")
    required_js = (
        'document.documentElement.dataset.prototypeReady = "true"',
        '#playButton',
        '#chooseImageButton',
        '#addSceneButton',
    )
    if len(js.strip()) < 1000 or any(marker not in js for marker in required_js):
        raise BuildError("JavaScript is missing or the prototype interaction handlers are incomplete.")
    if html.count(HTML_LINK) != 1 or html.count(JS_LINK) != 1:
        raise BuildError("Expected exactly one local stylesheet and script source reference.")
    if html.count(DOCUMENT_TAG) != 1:
        raise BuildError("Expected one RTL document root with the development commit marker.")
    if "</style" in css.lower() or "</script" in js.lower():
        raise BuildError("A source asset contains an unsafe closing inline tag.")
    if re.search(r"url\(\s*['\"]?(?!data:|blob:|#)[^)]+\)", css, re.IGNORECASE):
        raise BuildError("External CSS URL dependencies are not allowed in the standalone build.")

    bundled = html.replace(
        HTML_LINK,
        '<style id="motionStudioV2Style">\n' + css + '\n</style>',
    ).replace(
        JS_LINK,
        '<script id="motionStudioV2Script">\n' + js + '\n</script>',
    ).replace(
        DOCUMENT_TAG,
        '<html lang="ar" dir="rtl" data-commit="' + commit_sha + '">',
    )
    bundled = bundled.replace('title="Commit source">Commit dev', 'title="Commit ' + commit_sha + '">Commit ' + commit_sha[:7])
    if HTML_LINK in bundled or JS_LINK in bundled:
        raise BuildError("External source files were not fully inlined.")
    if not re.search(r"<style id=\"motionStudioV2Style\">[\s\S]{1000,}</style>", bundled):
        raise BuildError("Bundled CSS is missing.")
    if not re.search(r"<script id=\"motionStudioV2Script\">[\s\S]{1000,}</script>", bundled):
        raise BuildError("Bundled JavaScript is missing.")
    if re.search(r"<(?:link|script)\b[^>]*(?:href|src)=['\"](?:https?:)?//", bundled, re.IGNORECASE):
        raise BuildError("The standalone HTML still references an external stylesheet or script.")
    return bundled


def resolve_commit(argument: str | None) -> str:
    candidate = argument or os.environ.get("GITHUB_SHA")
    if not candidate:
        try:
            candidate = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
            ).strip()
        except (OSError, subprocess.CalledProcessError):
            candidate = "e28b7a6"
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the offline standalone QARTON Motion Studio V2 HTML.")
    parser.add_argument("--commit", help="Full source commit SHA to show in the interface.")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "qarton-motion-studio-v2.html")
    parser.add_argument("--html", type=Path, default=ROOT / "index.html")
    parser.add_argument("--css", type=Path, default=ROOT / "app.css")
    parser.add_argument("--js", type=Path, default=ROOT / "app.js")
    args = parser.parse_args()
    try:
        html = args.html.read_text(encoding="utf-8")
        css = args.css.read_text(encoding="utf-8")
        js = args.js.read_text(encoding="utf-8")
        output = build_bundle(html, css, js, resolve_commit(args.commit))
    except (OSError, BuildError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8")
    print(f"Built {args.output} with commit {resolve_commit(args.commit)[:7]}")


if __name__ == "__main__":
    main()
