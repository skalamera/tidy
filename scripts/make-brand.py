#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""Build Tidy's brand assets from Stephen's source art in build/brand/ (macOS only: it uses iconutil).

usage: uv run scripts/make-brand.py

Reads build/brand/tidy-logo.svg (the "t" with sparkles on the teal tile) and
build/brand/tidy-wordmark.svg (the teal "tidy" wordmark). Writes:
  build/icon.icns                         the Mac app icon (electron-builder copies it into the bundle)
  src/renderer/src/assets/tidy-mark.png   the logo inside the app, 256 px
  src/renderer/src/wordmark.ts            the wordmark's glyph outlines, drawn as an inline SVG
The app's accent color (--accent in src/renderer/src/styles.css) is TEAL as well; keep the two in step.

The logo SVG is a design-tool export: five layers, each a color PNG shown through a luminance-mask
PNG with the same transform, clipped to a rectangle. Layer 1 is the teal tile; the others are the
three white sparkles and the white "t". The tile is one flat color (measured #146b64 with noise of
about 3 levels), so it is redrawn flat in TEAL rather than resampled. The script checks those facts
and stops if the art changes in a way it doesn't handle.

macOS 26 clips every app icon to one rounded shape, an 824 px body centered in a 1024 px canvas, and
draws an icon that doesn't fit that shape shrunk inside a gray tile. Scaled to the body, the art's
own tile contains the system shape everywhere and reaches past it only at the corners (about 18 px
on the diagonal at 1024), which macOS trims, so the icon keeps the art's silhouette. Tested on macOS
26.6: a plain square body was drawn inside the gray tile at every size. icon.icns holds only the 128,
256 and 512 pt images (1x and 2x): with 16 and 32 pt images included, macOS 26 draws icons inside a
gray tile at those sizes.
"""
import base64
import io
import math
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import NoReturn

import numpy as np
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
LOGO_SVG = ROOT / 'build/brand/tidy-logo.svg'
WORDMARK_SVG = ROOT / 'build/brand/tidy-wordmark.svg'
ICNS = ROOT / 'build/icon.icns'
MARK_PNG = ROOT / 'src/renderer/src/assets/tidy-mark.png'
WORDMARK_TS = ROOT / 'src/renderer/src/wordmark.ts'

TEAL = (0x14, 0x6A, 0x64)  # the brand teal; the wordmark files use it and the tile measures within 1 level
CANVAS, BODY = 1024, 824  # Apple's macOS icon grid
MARK_PX = 256
SS = 4  # draw at 4x, then average down
ICNS_POINT_SIZES = (128, 256, 512)  # each at 1x and 2x; see the docstring for why nothing smaller

SVG = '{http://www.w3.org/2000/svg}'
XLINK_HREF = '{http://www.w3.org/1999/xlink}href'

Box = tuple[float, float, float, float]
Placement = tuple[float, float, float]  # (a, e, f): user x = a * px + e, user y = a * py + f
Layer = tuple[Image.Image, Image.Image, Placement, Box]  # RGB artwork, L mask, placement, clip box


def fail(msg: str) -> NoReturn:
    sys.exit(f'make-brand: {msg}')


def attr(el: ET.Element, name: str) -> str:
    value = el.get(name)
    if value is None:
        fail(f'<{el.tag}> has no {name}')
    return value


def find(el: ET.Element, path: str) -> ET.Element:
    found = el.find(path)
    if found is None:
        fail(f'<{el.tag}> has no {path}')
    return found


def ref(value: str) -> str:
    m = re.search(r'#([^)]+)\)', value)
    if not m:
        fail(f'expected url(#id), got {value!r}')
    return m.group(1)


def placement(el: ET.Element) -> Placement:
    m = re.fullmatch(r'matrix\(([^)]*)\)', (el.get('transform') or '').strip())
    if not m:
        fail(f'expected a matrix() transform, got {el.get("transform")!r}')
    a, b, c, d, e, f = (float(v) for v in m.group(1).split(','))
    if b or c or a != d:
        fail(f'only uniform scale plus translate is handled, got {m.group(0)}')
    return a, e, f


def embedded_png(el: ET.Element) -> Image.Image:
    m = re.fullmatch(r'data:image/png;base64,(.+)', el.get(XLINK_HREF) or el.get('href') or '', re.S)
    if not m:
        fail('expected an embedded PNG')
    return Image.open(io.BytesIO(base64.b64decode(m.group(1))))


def clip_boxes(defs: ET.Element) -> dict[str, Box]:
    boxes = {}
    for cp in defs.findall(f'{SVG}clipPath'):
        shape = cp[0]
        if shape.tag == f'{SVG}rect':
            x, y, w, h = (float(attr(shape, k)) for k in ('x', 'y', 'width', 'height'))
            boxes[attr(cp, 'id')] = (x, y, x + w, y + h)
        else:
            nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', attr(shape, 'd'))]
            boxes[attr(cp, 'id')] = (min(nums[0::2]), min(nums[1::2]), max(nums[0::2]), max(nums[1::2]))
    return boxes


def logo_layers(svg: Path) -> list[Layer]:
    """Every layer, bottom to top."""
    root = ET.parse(svg).getroot()
    parents = {child: parent for parent in root.iter() for child in parent}
    defs = find(root, f'{SVG}defs')
    clips = clip_boxes(defs)
    masks = {attr(m, 'id'): find(m, f'.//{SVG}image') for m in defs.findall(f'{SVG}mask')}
    layers = []
    for img in root.iter(f'{SVG}image'):
        chain, p = [], parents.get(img)
        while p is not None:
            chain.append(p)
            p = parents.get(p)
        if defs in chain:
            continue
        place = placement(chain[0])
        for g in chain[1:]:
            if g.get('transform') and placement(g) != (1.0, 0.0, 0.0):
                fail('only the image itself may be transformed')
        mask_ids = [ref(attr(g, 'mask')) for g in chain if g.get('mask')]
        if len(mask_ids) != 1:
            fail(f'expected one mask per layer, found {len(mask_ids)}')
        mask_img = masks[mask_ids[0]]
        if placement(parents[mask_img]) != place:
            fail('a mask and its artwork are placed differently')
        box: Box = (-math.inf, -math.inf, math.inf, math.inf)
        for g in chain:
            if g.get('clip-path'):
                c = clips[ref(attr(g, 'clip-path'))]
                box = (max(box[0], c[0]), max(box[1], c[1]), min(box[2], c[2]), min(box[3], c[3]))
        layers.append((embedded_png(img).convert('RGB'), embedded_png(mask_img).convert('L'), place, box))
    if len(layers) != 5:
        fail(f'expected 5 layers (tile, 3 sparkles, "t"), found {len(layers)}')
    return layers


def check_art(layers: list[Layer]) -> tuple[float, float, float]:
    """Check what the redraw relies on, and return the tile's square (x0, y0, side) in user units."""
    color, mask, (a, e, f), _ = layers[0]
    m = np.asarray(mask, dtype=np.float32) / 255
    tile = np.asarray(color, dtype=np.float32)[m >= 0.99].mean(axis=0)
    if np.abs(tile - TEAL).max() > 4:
        fail(f'the tile is {np.rint(tile).tolist()}, not the brand teal {list(TEAL)}; update TEAL')
    ys, xs = np.nonzero(m >= 0.5)
    side = int(xs.max() + 1 - xs.min())
    if side != ys.max() + 1 - ys.min():
        fail('the tile is not square')
    for i, (color, mask, (a2, e2, f2), box) in enumerate(layers[1:], start=2):
        lm = np.asarray(mask, dtype=np.float32) / 255
        # Only the inside is checked: the artwork's antialiased edge is darker, and the redraw keeps it white.
        on = np.asarray(color, dtype=np.float32)[lm >= 0.99]
        if on.min() < 240:
            fail(f'layer {i} is not white inside its shape (min {on.min():.0f})')
        # The clip rectangles only trim empty margins, so the redraw ignores them.
        ly, lx = np.nonzero(lm > 2 / 255)
        left, right = a2 * lx.min() + e2, a2 * (lx.max() + 1) + e2
        top, bottom = a2 * ly.min() + f2, a2 * (ly.max() + 1) + f2
        if left < box[0] - 0.5 or top < box[1] - 0.5 or right > box[2] + 0.5 or bottom > box[3] + 0.5:
            fail(f'layer {i} reaches past its clip rectangle, so clipping would change it')
    return a * xs.min() + e, a * ys.min() + f, a * side


def draw(img: Image.Image, place: Placement, k: float, ox: float, oy: float, n: int) -> Image.Image:
    """`img` on an n x n canvas where user point (u, v) lands at ((u - ox) * k, (v - oy) * k) px."""
    a, e, f = place
    s = a * k
    if s < 1:  # shrink with a box filter first, so the final resample is at most about 2x
        r = int(1 / s)
        if r > 1:
            img = img.reduce(r)
            s *= r
    x0, y0 = (e - ox) * k, (f - oy) * k
    data = (1 / s, 0, -x0 / s, 0, 1 / s, -y0 / s)
    return img.transform((n, n), Image.Transform.AFFINE, data, resample=Image.Resampling.BICUBIC)


def render(layers: list[Layer], tile: tuple[float, float, float], px: int, body: int) -> Image.Image:
    """The logo at px x px, with the tile's side at `body` px and centered."""
    x0, y0, side = tile
    n = px * SS
    k = body * SS / side
    margin = (px - body) / 2 * side / body
    ox, oy = x0 - margin, y0 - margin
    glyphs = Image.new('L', (n, n), 0)
    for _, mask, place, _ in layers[1:]:
        glyphs = ImageChops.screen(glyphs, draw(mask, place, k, ox, oy, n))  # union of the coverages
    alpha = draw(layers[0][1], layers[0][2], k, ox, oy, n)  # the art's own rounded tile
    out = Image.composite(Image.new('RGB', (n, n), (255, 255, 255)), Image.new('RGB', (n, n), TEAL), glyphs)
    out.putalpha(alpha)
    return out.reduce(SS)


def write_icns(master: Image.Image) -> None:
    with tempfile.TemporaryDirectory() as d:
        iconset = Path(d) / 'icon.iconset'
        iconset.mkdir()
        for s in ICNS_POINT_SIZES:
            master.resize((s, s), Image.Resampling.LANCZOS).save(iconset / f'icon_{s}x{s}.png', optimize=True)
            master.resize((2 * s, 2 * s), Image.Resampling.LANCZOS).save(iconset / f'icon_{s}x{s}@2x.png', optimize=True)
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(ICNS)], check=True)


def wordmark(svg: Path) -> tuple[float, list[tuple[float, str]], Box]:
    """(baseline, [(x, path)], bounding box as x, y, width, height) for the four glyphs, in the art's units."""
    root = ET.parse(svg).getroot()
    baselines, glyphs, points = set(), [], []
    for g in root.iter(f'{SVG}g'):
        m = re.fullmatch(r'translate\((-?[\d.]+),\s*(-?[\d.]+)\)', g.get('transform') or '')
        if not m:
            continue
        x, y = float(m.group(1)), float(m.group(2))
        baselines.add(y)
        d = ' '.join(attr(find(g, f'.//{SVG}path'), 'd').split())
        if set(re.findall(r'[A-Za-z]', d)) - set('MLCZ'):
            fail('only absolute M, L, C and Z path commands are handled')
        nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', d)]
        points += [(x + px, y + py) for px, py in zip(nums[0::2], nums[1::2])]
        glyphs.append((x, d))
    if len(glyphs) != 4 or len(baselines) != 1:
        fail(f'expected 4 glyphs (t, i, d, y) on one baseline, found {len(glyphs)} on {len(baselines)}')
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    left, top = math.floor(min(xs) * 100) / 100, math.floor(min(ys) * 100) / 100
    right, bottom = math.ceil(max(xs) * 100) / 100, math.ceil(max(ys) * 100) / 100
    return baselines.pop(), glyphs, (left, top, round(right - left, 2), round(bottom - top, 2))


def write_wordmark_ts(baseline: float, glyphs: list[tuple[float, str]], box: Box) -> None:
    lines = [
        '// Generated by scripts/make-brand.py from build/brand/tidy-wordmark.svg. Run it again rather than editing this file.',
        '',
        "/** The \"tidy\" wordmark: four glyph outlines on one baseline, in the art's units, and their bounding box. */",
        'export const WORDMARK = {',
        f'  box: {{ x: {box[0]}, y: {box[1]}, width: {box[2]}, height: {box[3]} }},',
        f'  baseline: {baseline},',
        '  glyphs: [',
    ]
    for x, d in glyphs:
        lines += ['    {', f'      x: {x},', f"      d: '{d}',", '    },']
    lines += ['  ],', '} as const;', '']
    WORDMARK_TS.write_text('\n'.join(lines))


def main() -> None:
    if sys.platform != 'darwin':
        fail('needs macOS: icon.icns is written with iconutil')
    layers = logo_layers(LOGO_SVG)
    tile = check_art(layers)
    write_icns(render(layers, tile, CANVAS, BODY))
    MARK_PNG.parent.mkdir(parents=True, exist_ok=True)
    render(layers, tile, MARK_PX, MARK_PX).save(MARK_PNG, optimize=True)
    baseline, glyphs, box = wordmark(WORDMARK_SVG)
    write_wordmark_ts(baseline, glyphs, box)
    print(f'tile: side {tile[2]:.2f} units at ({tile[0]:.2f}, {tile[1]:.2f}); wordmark box {box}')
    for path in (ICNS, MARK_PNG, WORDMARK_TS):
        print(f'{path.relative_to(ROOT)}: {path.stat().st_size} bytes')


if __name__ == '__main__':
    main()
