#!/usr/bin/env python3
"""Generate Git Fox Tab PNG icons."""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

BG = (249, 115, 22, 255)      # orange
FG = (27, 31, 36, 255)        # dark
ACC = (255, 255, 255, 255)


def rounded(draw, size, r):
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)


def draw_branch(draw, size):
    # a git-branch style motif scaled to the icon
    s = size
    cx = s * 0.34
    cy_top = s * 0.30
    cy_bot = s * 0.70
    r_node = max(2, int(s * 0.085))
    w_line = max(2, int(s * 0.07))

    # vertical line
    draw.line([cx, cy_top, cx, cy_bot], fill=FG, width=w_line)
    # curved branch line to the right node
    rx = s * 0.66
    draw.line([cx, cy_top, rx, cy_top], fill=FG, width=w_line)
    draw.line([rx, cy_top, rx, cy_bot], fill=FG, width=w_line)
    # nodes
    draw.ellipse([cx - r_node, cy_top - r_node, cx + r_node, cy_top + r_node], fill=ACC)
    draw.ellipse([cx - r_node, cy_bot - r_node, cx + r_node, cy_bot + r_node], fill=ACC)
    draw.ellipse([rx - r_node, cy_top - r_node, rx + r_node, cy_top + r_node], fill=ACC)


for size in (48, 96, 128):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rounded(d, size, max(4, size // 6))
    draw_branch(d, size)
    img.save(os.path.join(OUT, f"icon-{size}.png"))

# also write an SVG source
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#f97316"/>
  <g fill="none" stroke="#1b1f24" stroke-width="9" stroke-linecap="round">
    <line x1="44" y1="38" x2="44" y2="90"/>
    <line x1="44" y1="38" x2="84" y2="38"/>
    <line x1="84" y1="38" x2="84" y2="90"/>
  </g>
  <g fill="#ffffff">
    <circle cx="44" cy="38" r="11"/>
    <circle cx="44" cy="90" r="11"/>
    <circle cx="84" cy="38" r="11"/>
  </g>
</svg>
'''
with open(os.path.join(OUT, "icon.svg"), "w") as f:
    f.write(svg)

print("icons generated in", OUT)
