#!/usr/bin/env python3
"""Build transparent face atlases from the checked-in original portraits."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

LAB = Path(__file__).resolve().parents[1] / "examples/cinematic-runtime-lab"
# Pixel landmarks in the original portraits. Left/right refer to the image.
# Eye coordinates: first corner, second corner, height above and below.
# Brow coordinates: ends + upper and lower clearance.
RIGS = {
    "layla": {
        "neck": [(430, 198), (459, 205), (488, 221), (518, 238), (550, 226), (650, 226)],
        "pivot": (498, 220), "mouth": (550, 170, 17, 7),
        "eyes": [(501, 113, 557, 119, 12, 10), (566, 125, 589, 126, 10, 10)],
        "brows": [(510, 96, 556, 104, 8, 5), (568, 114, 583, 109, 5, 4)],
    },
    "nour": {
        "neck": [(365, 232), (438, 220), (471, 224), (501, 249), (519, 254), (565, 237), (670, 228)],
        "pivot": (509, 238), "mouth": (554, 168, 17, 8),
        "eyes": [(502, 112, 541, 118, 8, 7), (566, 125, 579, 120, 6, 7)],
        "brows": [(502, 97, 558, 104, 8, 6), (566, 109, 580, 106, 5, 5)],
    },
    "salim": {
        "neck": [(375, 202), (441, 198), (483, 213), (509, 233), (545, 220), (655, 216)],
        "pivot": (515, 219), "mouth": (556, 155, 17, 7),
        "eyes": [(524, 110, 560, 114, 7, 6), (577, 113, 588, 109, 5, 7)],
        "brows": [(521, 98, 568, 103, 9, 4), (582, 102, 593, 99, 5, 4)],
    },
    "youssef": {
        "neck": [(357, 187), (437, 188), (472, 205), (514, 206), (546, 193), (650, 192)],
        "pivot": (486, 199), "mouth": (541, 150, 18, 7),
        "eyes": [(509, 100, 539, 104, 7, 6), (556, 113, 572, 107, 7, 6)],
        "brows": [(501, 89, 548, 96, 7, 5), (551, 99, 573, 98, 5, 6)],
    },
}


def diffuse(image, mask):
    """Fill the marked feature with surrounding skin, keeping the boundary."""
    values = np.asarray(image.convert("RGB"), dtype=np.float32)
    result = values.copy()
    inside = np.asarray(mask) > 0
    result[inside] = values[~inside].mean(axis=0)
    for _ in range(180):
        average = (result[:-2, 1:-1] + result[2:, 1:-1]
                   + result[1:-1, :-2] + result[1:-1, 2:]) * .25
        np.copyto(result[1:-1, 1:-1], average, where=inside[1:-1, 1:-1, None])
    return Image.fromarray(np.uint8(np.clip(result, 0, 255))).convert("RGBA")


def patch(image, bounds, polygon, skin_strip=None):
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    mask = mask.crop(bounds)
    original = image.crop(bounds)
    clean = diffuse(original, mask)
    if skin_strip:
        # Pupils and lashes sit against inked edges. Use the cheek ramp below
        # the eye to fill the interior without pulling dark ink into the lid.
        sx1, sx2, sy = skin_strip
        strip = np.asarray(image.crop((sx1, sy, sx2, sy+4)))[:, :, :3]
        color = np.median(strip.reshape(-1, 3), axis=0)
        pixels = np.asarray(clean).copy()
        ramp = np.linspace(-9, 4, clean.height)[:, None, None]
        pixels[:, :, :3] = np.clip(color[None, None, :] + ramp, 0, 255).astype(np.uint8)
        clean = Image.fromarray(pixels)
    alpha = ImageChops.multiply(mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.35)), original.getchannel("A"))
    original.putalpha(alpha)
    clean.putalpha(alpha)
    return original, clean


def painted(base, paint):
    scale = 4
    ink = Image.new("RGBA", (base.width * scale, base.height * scale))
    paint(ImageDraw.Draw(ink), scale)
    return Image.alpha_composite(base, ink.resize(base.size, Image.Resampling.LANCZOS))


def eye_or_brow(image, spec, lid):
    x1, y1, x2, y2, upper, lower = spec
    bounds = (x1 - 6, min(y1, y2) - upper - 6, x2 + 6, max(y1, y2) + lower + 6)
    polygon = [(x1 - 1, y1 - upper*.35), (x1 + (x2-x1)*.28, y1-upper),
               (x2-2, y2-upper*.7), (x2+1, y2), (x2-1, y2+lower*.7),
               (x1+(x2-x1)*.58, y1+lower), (x1+2, y1+lower*.45)]
    strip = (x1+(x2-x1)//3, x1+max(4, (x2-x1)*2//3), max(y1, y2)+lower+5) if lid else None
    original, clean = patch(image, bounds, polygon, strip)
    if not lid:
        return bounds, original, clean, clean

    def paint(draw, scale):
        points = []
        for step in range(21):
            t = step / 20
            x = x1 + (x2-x1)*t - bounds[0]
            y = y1 + (y2-y1)*t + 10*t*(1-t) - bounds[1]
            points.append((x*scale, y*scale))
        draw.line(points, fill=(58, 32, 26, 255), width=2*scale, joint="curve")

    return bounds, original, painted(clean, paint), clean


def mouth_parts(image, spec):
    x, y, w, h = spec
    bounds = (x-w-7, y-h-8, x+w+7, y+h+9)
    polygon = [(x-w-3, y-6), (x-6, y-h-2), (x+w+2, y-6),
               (x+w+1, y+3), (x+6, y+h+4), (x-9, y+h+2), (x-w-3, y+1)]
    original, clean = patch(image, bounds, polygon)
    yield "closed", bounds, original, clean
    for variant, (width, height) in {
        "open": (.73, .81), "round": (.41, .77), "wide": (.97, .31), "teeth": (.76, .56)
    }.items():
        mouth_ink = image.getpixel((x, y))[:3]
        outline = tuple(int(c * .62) for c in mouth_ink)
        def paint(draw, scale):
            cx, cy = (x-bounds[0])*scale, (y-bounds[1]+1)*scale
            a, b = w*width*scale, h*height*scale
            box = (cx-a, cy-b, cx+a, cy+b)
            draw.ellipse(box, fill=(73, 35, 32), outline=outline, width=scale)
            if variant == "teeth":
                draw.chord((cx-a*.91, cy-b*.88, cx+a*.91, cy+b*.55),
                           187, 354, fill=(236, 206, 173))
            elif variant != "wide":
                draw.ellipse((cx-a*.49, cy+b*.28, cx+a*.49, cy+b*.90), fill=(160, 80, 72))
        yield variant, bounds, painted(clean, paint), clean


def build(name):
    config = RIGS[name]
    image = Image.open(LAB / "assets/characters" / f"{name}.webp").convert("RGBA")
    clean = image.copy()
    features = []
    for variant, bounds, tile, fill in mouth_parts(image, config["mouth"]):
        if variant == "closed":
            clean.alpha_composite(fill, bounds[:2])
        features.append(("mouth", variant, bounds, tile))
    for side, eye, brow in zip(("left", "right"), config["eyes"], config["brows"]):
        bounds, tile, lid, fill = eye_or_brow(image, eye, True)
        # The eyelid tile replaces the original eyelash and iris in the base.
        clean.alpha_composite(fill, bounds[:2])
        features += [(f"eye_{side}", "neutral", bounds, tile), (f"eye_{side}", "closed", bounds, lid)]
        bounds, tile, _, fill = eye_or_brow(image, brow, False)
        clean.alpha_composite(fill, bounds[:2])
        features.append((f"brow_{side}", "neutral", bounds, tile))
        for expression, offset in (("afraid", -2), ("surprised", -3), ("thinking", -1),
                                   ("determined", 2), ("angry", 2), ("happy", -1), ("sad", -2)):
            if side == "right" and expression == "thinking":
                offset = 1
            features.append((f"brow_{side}", expression,
                             (bounds[0], bounds[1]+offset, bounds[2], bounds[3]+offset), tile))

    # Keep a narrow static overlap beneath the neck pivot for small rotations.
    width, height = image.size
    neck = [(0, config["neck"][0][1]), *config["neck"], (width, config["neck"][-1][1])]
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon([(0, 0), (width, 0), *reversed(neck)], fill=255)
    body_mask = Image.new("L", image.size, 255)
    ImageDraw.Draw(body_mask).polygon([(0, 0), (width, 0),
                                      *((x, y-11) for x, y in reversed(neck))], fill=0)
    def masked(source, mask):
        part = source.copy()
        part.putalpha(ImageChops.multiply(source.getchannel("A"), mask))
        return part

    body = masked(image, body_mask)
    head = masked(clean, mask.filter(ImageFilter.GaussianBlur(1.1)))
    body_bounds, head_bounds = body.getbbox(), head.getbbox()
    parts = [("body", "neutral", body_bounds, body.crop(body_bounds)),
             ("head", "neutral", head_bounds, head.crop(head_bounds)), *features]
    atlas = Image.new("RGBA", (width, height + 250))
    layers = []
    left, top, row_height = 2, 2, 0
    packed = {}
    for z, (role, variant, bounds, tile) in enumerate(parts):
        tile_key = (tile.size, tile.tobytes())
        if tile_key not in packed:
            if left + tile.width + 2 > atlas.width:
                left, top, row_height = 2, top + row_height + 4, 0
            if top + tile.height + 2 > atlas.height:
                raise ValueError(f"Atlas overflows for {name}")
            atlas.paste(tile, (left, top))
            packed[tile_key] = (left, top)
            left += tile.width + 4
            row_height = max(row_height, tile.height)
        sx, sy = packed[tile_key]
        x1, y1, x2, y2 = bounds
        px, py = config["pivot"] if role == "head" else ((x1+x2)/2, (y1+y2)/2)
        layers.append({
            "role": role, "assetId": f"{name}-face-atlas", "variant": variant, "view": "front",
            "z": z, "layout": {"x": px/width, "y": py/height, "width": (x2-x1)/width,
                               "height": (y2-y1)/height, "pivotX": (px-x1)/(x2-x1),
                               "pivotY": (py-y1)/(y2-y1)},
            "sourceRect": {"x": sx, "y": sy, "width": tile.width, "height": tile.height}
        })

    atlas.crop((0, 0, atlas.width, top+row_height+2)).save(
        LAB / "assets/characters" / f"{name}-face-atlas.webp", quality=93, alpha_quality=100, method=6)
    return layers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("characters", nargs="*", choices=list(RIGS), default=None)
    names = parser.parse_args().characters or list(RIGS)
    rigs = {name: build(name) for name in names}
    manifest = LAB / "original-face-rigs.js"
    prefix = "// Generated by scripts/build-original-face-rigs.py.\nexport default "
    if manifest.exists() and len(names) != len(RIGS):
        existing = json.loads(manifest.read_text().removeprefix(prefix).removesuffix(";\n"))
        existing.update(rigs)
        rigs = existing
    manifest.write_text(prefix + json.dumps(rigs, indent=2) + ";\n")


if __name__ == "__main__":
    main()
