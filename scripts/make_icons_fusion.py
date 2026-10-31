"""Generates the three theme icons for CacheSweep.

One icon per UI theme so the window, taskbar, tray and favicon always match the
user's choice:

    orange      赤橙 · 暖橙主题   deep ember accent
    grape       碧提 · 青提主题   cyan-green accent
    sugarcane   青蔗 · 钢灰主题   steel accent

All three share the same sci-fi silhouette (an open hexagonal circuit frame
around a sweeping cache ring); only the accent hue and a small core motif
change, so the set reads as one family.

Requires Pillow. Usage:

    python make_icons_fusion.py <output_dir>

Writes per theme: <name>.png (512), <name>-256.png, <name>.ico, plus
icon-ladder.png comparing all three at shell sizes.
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 1024
S = SIZE / 512.0

THEMES = {
    "orange": {
        "accent": (255, 122, 48),
        "bright": (255, 186, 110),
        "chip_top": (22, 16, 12),
        "chip_bot": (10, 7, 5),
    },
    "grape": {
        "accent": (64, 224, 200),
        "bright": (150, 255, 235),
        "chip_top": (10, 22, 24),
        "chip_bot": (4, 9, 11),
    },
    "sugarcane": {
        "accent": (176, 194, 212),
        "bright": (228, 238, 248),
        "chip_top": (16, 20, 26),
        "chip_bot": (7, 9, 13),
    },
}


def sc(v):
    return v * S


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def chip(pal, radius_ratio=0.15):
    """Dark tech chip with a faint accent wash in the upper left."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    body = Image.new("RGBA", (SIZE, SIZE))
    d = ImageDraw.Draw(body)
    for y in range(SIZE):
        d.line([(0, y), (SIZE, y)],
               fill=lerp(pal["chip_top"], pal["chip_bot"], y / (SIZE - 1)) + (255,))

    wash = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(wash).polygon(
        [(0, 0), (SIZE * 0.66, 0), (0, SIZE * 0.6)],
        fill=pal["accent"] + (24,),
    )
    body = Image.alpha_composite(body, wash.filter(ImageFilter.GaussianBlur(sc(40))))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * radius_ratio), fill=255
    )
    img.paste(body, (0, 0), mask)
    return img


def glow(img, center, radius, color, strength=80):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    for i in range(18, 0, -1):
        t = i / 18
        r = radius * t
        a = int(strength * (1 - t) ** 2.2)
        if a > 0:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return Image.alpha_composite(img, layer)


def draw_frame(img, cx, cy, r, pal):
    """Open hexagonal circuit frame: the shared sci-fi silhouette."""
    d = ImageDraw.Draw(img)
    pts = [(cx + r * math.cos(math.radians(-90 + i * 60)),
            cy + r * math.sin(math.radians(-90 + i * 60))) for i in range(6)]

    width = int(sc(9))
    for i in range(6):
        if i in (1, 4):          # two edges open: circuit / scanning feel
            continue
        d.line([pts[i], pts[(i + 1) % 6]], fill=pal["accent"] + (245,),
               width=width, joint="curve")

    for i in range(6):
        if i in (1, 4):
            continue
        x, y = pts[i]
        rr = sc(8)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=pal["bright"] + (255,))
    return img


def draw_sweep(img, cx, cy, r, pal):
    """Gauge ring with a gap plus a leading dot: the 'sweeping' motion."""
    d = ImageDraw.Draw(img)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=-56, end=238,
          fill=pal["accent"] + (235,), width=int(sc(11)))

    ang = math.radians(-56)
    hx, hy = cx + r * math.cos(ang), cy + r * math.sin(ang)
    hr = sc(13)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=pal["bright"] + (255,))
    return img


def core_orange(img, cx, cy, r, pal):
    """Citrus segment, kept small so the frame stays dominant."""
    d = ImageDraw.Draw(img)
    pts = [(cx + r * math.cos(math.radians(-90 + i * 120)),
            cy + r * math.sin(math.radians(-90 + i * 120))) for i in range(3)]
    d.polygon(pts, fill=pal["accent"] + (235,))
    for x, y in pts:
        d.line([(cx, cy), (x, y)], fill=pal["chip_top"] + (120,), width=int(sc(4)))
    d.ellipse([cx - sc(7), cy - sc(7), cx + sc(7), cy + sc(7)],
              fill=pal["bright"] + (255,))
    return img


def core_grape(img, cx, cy, pal):
    """Tight cluster of berries."""
    d = ImageDraw.Draw(img)
    radius = sc(15)
    step = sc(27)
    cluster = [(-1, 0), (1, 0), (0, -1), (0, 1), (0, 0), (-0.5, 1.5), (0.5, 1.5)]
    for dx, dy in cluster:
        x = cx + dx * step
        y = cy + dy * step * 0.82
        d.ellipse([x - radius, y - radius, x + radius, y + radius],
                  fill=pal["accent"] + (240,))
        d.ellipse([x - radius * 0.55, y - radius * 0.55,
                   x - radius * 0.08, y - radius * 0.08],
                  fill=pal["bright"] + (200,))
    return img


def core_sugarcane(img, cx, cy, r, pal):
    """Three bars with node joints on the middle one."""
    d = ImageDraw.Draw(img)
    for i, (half_w, off) in enumerate(((0.62, -0.45), (0.5, 0.0), (0.62, 0.45))):
        y = cy + off * r
        x0, x1 = cx - r * half_w, cx + r * half_w
        d.rectangle([x0, y - sc(9), x1, y + sc(9)], fill=pal["accent"] + (240,))
        if i == 1:
            for j in (0.33, 0.66):
                nx = x0 + (x1 - x0) * j
                d.line([(nx, y - sc(9)), (nx, y + sc(9))],
                       fill=pal["chip_top"] + (150,), width=int(sc(4)))
    return img


def build(kind):
    pal = THEMES[kind]
    cx = cy = SIZE / 2

    img = chip(pal)
    img = glow(img, (cx, cy), SIZE * 0.38, pal["accent"], 62)

    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    halo = draw_frame(halo, cx, cy, sc(158), pal)
    halo = draw_sweep(halo, cx, cy, sc(104), pal)
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(sc(15))))

    img = draw_frame(img, cx, cy, sc(158), pal)
    img = draw_sweep(img, cx, cy, sc(104), pal)

    core = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if kind == "orange":
        core = core_orange(core, cx, cy, sc(44), pal)
    elif kind == "grape":
        core = core_grape(core, cx, cy, pal)
    else:
        core = core_sugarcane(core, cx, cy, sc(46), pal)
    return Image.alpha_composite(img, core)


def make_ico(master, path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    master.resize((256, 256), Image.LANCZOS).save(
        path, format="ICO", sizes=[(s, s) for s in sizes]
    )


if __name__ == "__main__":
    ladder = {}
    for kind in ("orange", "grape", "sugarcane"):
        big = build(kind)
        big.resize((512, 512), Image.LANCZOS).save(OUT / f"{kind}.png")
        big.resize((256, 256), Image.LANCZOS).save(OUT / f"{kind}-256.png")
        make_ico(big, OUT / f"{kind}.ico")
        ladder[kind] = big
        print("wrote", kind)

    pad, row = 16, 132
    sizes = [16, 24, 32, 48, 64, 96, 128]
    label_w = 160
    width = label_w + sum(sizes) + pad * len(sizes) + pad
    sheet = Image.new("RGBA", (width, row * 3 + 16), (30, 32, 36, 255))
    d = ImageDraw.Draw(sheet)
    for r, (kind, big) in enumerate(ladder.items()):
        y = 8 + r * row
        d.text((14, y + 58), kind.encode("ascii"), fill=(228, 233, 241, 255))
        x = label_w
        for s in sizes:
            f = big.resize((s, s), Image.LANCZOS)
            sheet.paste(f, (x + (sizes[-1] - s) // 2, y + (row - s) // 2), f)
            x += s + pad
    sheet.save(OUT / "icon-ladder.png")
    print("wrote icon-ladder.png")
