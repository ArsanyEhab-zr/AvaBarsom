#!/usr/bin/env python3
"""
Generate cinematic, joyful, 32-bit RGBA PWA & App icons for all 3 church editions
(admin, servant, parent) plus default root assets from the high-res master logo.

Outputs per edition (public/editions/<id>/):
  - logo.png (512x512 true transparent circular cutout + curved metallic ribbon)
  - pwa-512x512.png & pwa-192x192.png (purpose: "any" — 100% transparent outside emblem)
  - pwa-maskable-512x512.png & pwa-maskable-192x192.png (purpose: "maskable" — full-bleed radial sunburst + 64% safe-zone emblem)
  - apple-touch-icon.png (180x180 full-bleed luminous iOS icon)
  - favicon.ico (multi-size 16, 32, 48 from transparent cutout)
  - og-image.png (1200x630 social share card)
"""

import io
import math
from collections import deque
from pathlib import Path

import cairo
import gi
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402


ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
ASSETS_ICON_PATH = ROOT_DIR / "assets" / "icon.png"
BASE_LOGO_PATH = PUBLIC_DIR / "logo.png"
EDITIONS_OUT_DIR = PUBLIC_DIR / "editions"

CHURCH_NAME = "كنيسة الأنبا برسوم العريان بطهنشا"
SERVICE_SUBTITLE = "منظومة إدارة الخدمات ومدارس الأحد والمناهج"

GOLD_PRIMARY = (245 / 255, 158 / 255, 11 / 255)   # #F59E0B
GOLD_BRIGHT = (251 / 255, 191 / 255, 36 / 255)    # #FBBF24
GOLD_LIGHT = (254 / 255, 243 / 255, 199 / 255)    # #FEF3C7
GOLD_DEEP = (180 / 255, 83 / 255, 9 / 255)        # #B45309
ROYAL_GOLD = (217 / 255, 119 / 255, 6 / 255)      # #D97706

EDITIONS = [
    {
        "id": "admin",
        "badge_text": "أدمن",
        "ribbon_top": "#1E293B",
        "ribbon_mid": "#0F172A",
        "ribbon_bot": "#090E1A",
        "border_start": "#D97706",
        "border_end": "#FBBF24",
        "sunburst_outer": "#E0B354",
        "sunburst_tint": "#1B2A59",
        "fill_hex": "#1B2A59",
        "title": "تطبيق الأدمن والأمناء",
        "caption": "الأب الكاهن • أمين الخدمة العام • أمناء المراحل",
    },
    {
        "id": "servant",
        "badge_text": "الخدام",
        "ribbon_top": "#10B981",
        "ribbon_mid": "#059669",
        "ribbon_bot": "#047857",
        "border_start": "#FBBF24",
        "border_end": "#D97706",
        "sunburst_outer": "#D8C98D",
        "sunburst_tint": "#059669",
        "fill_hex": "#059669",
        "title": "تطبيق الخادم والخادمة",
        "caption": "إدارة الأسرة • الحضور والافتقاد • المناهج والدرجات",
    },
    {
        "id": "parent",
        "badge_text": "ولي الأمر",
        "ribbon_top": "#38BDF8",
        "ribbon_mid": "#0284C7",
        "ribbon_bot": "#0369A1",
        "border_start": "#FBBF24",
        "border_end": "#D97706",
        "sunburst_outer": "#DFC57B",
        "sunburst_tint": "#0284C7",
        "fill_hex": "#0284C7",
        "title": "بوابة ولي الأمر",
        "caption": "متابعة الأبناء • سجل الحضور والنقاط • دروس ومناهج الفصل",
    },
]


def hex_to_rgb01(hex_color: str) -> tuple[float, float, float]:
    clean = hex_color.lstrip("#")
    return tuple(int(clean[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def extract_clean_emblem_1024() -> Image.Image:
    """
    Extract a razor-sharp, true-transparent 1024x1024 circular cutout from
    assets/icon.png (1024x1024 master) using corner flood-fill + anti-aliased
    edge feathering and color defringing, then subtly enhance vibrance/contrast.
    """
    if ASSETS_ICON_PATH.exists():
        src = Image.open(ASSETS_ICON_PATH).convert("RGB")
        arr = np.array(src)
        h, w, _ = arr.shape
        bg = arr[0, 0].astype(np.int16)

        diff = np.abs(arr.astype(np.int16) - bg).max(axis=2)
        is_bg = diff <= 20

        visited = np.zeros((h, w), dtype=bool)
        q: deque[tuple[int, int]] = deque()
        for sy, sx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
            if is_bg[sy, sx] and not visited[sy, sx]:
                visited[sy, sx] = True
                q.append((sy, sx))

        while q:
            y, x = q.popleft()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))

        fg = ~visited
        # Smooth anti-aliased alpha edge on outer rim
        alpha_img = Image.fromarray((fg.astype(np.uint8) * 255), mode="L")
        alpha_soft = alpha_img.filter(ImageFilter.GaussianBlur(radius=1.15))
        alpha_arr = np.array(alpha_soft, dtype=np.float32)
        # Keep interior solid (erode 2px inward to guarantee alpha=255 inside seal)
        alpha_arr = np.where(fg, np.clip((alpha_arr - 90.0) / 165.0 * 255.0, 0.0, 255.0), 0.0)
        # Hard-zero strictly exterior pixels beyond 2px from foreground
        fg_dilated = np.array(alpha_img.filter(ImageFilter.MaxFilter(5))) > 0
        alpha_arr[~fg_dilated] = 0.0

        rgba = np.dstack([arr, alpha_arr.astype(np.uint8)])
        cutout = Image.fromarray(rgba, mode="RGBA")

        ys, xs = np.where(alpha_arr > 25)
        crop_box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        cropped = cutout.crop(crop_box)
    else:
        cropped = Image.open(BASE_LOGO_PATH).convert("RGBA")
        alpha = np.array(cropped)[:, :, 3]
        ys, xs = np.where(alpha > 20)
        if len(xs) and len(ys):
            cropped = cropped.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    # Subtly enhance vibrance & contrast on RGB channels while preserving exact alpha
    alpha_ch = cropped.getchannel("A")
    rgb = cropped.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(1.14)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.06)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.02)
    enhanced = rgb.convert("RGBA")
    enhanced.putalpha(alpha_ch)
    return enhanced


def draw_rounded_rect(ctx: cairo.Context, x: float, y: float, w: float, h: float, r: float) -> None:
    r = min(r, w / 2.0, h / 2.0)
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2.0, 0.0)
    ctx.arc(x + w - r, y + h - r, r, 0.0, math.pi / 2.0)
    ctx.arc(x + r, y + h - r, r, math.pi / 2.0, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3.0 * math.pi / 2.0)
    ctx.close_path()


def create_pango_rtl_layout(
    ctx: cairo.Context,
    text: str,
    font_desc_str: str,
    max_width_px: int | None = None,
    align: Pango.Alignment = Pango.Alignment.CENTER,
) -> Pango.Layout:
    layout = PangoCairo.create_layout(ctx)
    pctx = layout.get_context()
    pctx.set_base_dir(Pango.Direction.RTL)
    layout.set_auto_dir(True)
    layout.set_font_description(Pango.FontDescription(font_desc_str))
    layout.set_alignment(align)
    if max_width_px is not None:
        layout.set_width(max_width_px * Pango.SCALE)
        layout.set_wrap(Pango.WrapMode.WORD_CHAR)
    layout.set_text(text, -1)
    return layout


def build_ribbon_arc_path(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    r_inner: float,
    r_outer: float,
    half_angle_deg: float,
    cap_radius: float,
) -> None:
    """
    Build a smooth, pill-ended curved annular ribbon hugging the bottom arc
    centered at 90 deg (bottom of circle), strictly bounded within r_outer.
    """
    a1 = math.radians(90.0 - half_angle_deg)
    a2 = math.radians(90.0 + half_angle_deg)
    r_mid = (r_inner + r_outer) / 2.0
    cap_r = min(cap_radius, (r_outer - r_inner) / 2.0)

    # Angular inset so rounded end-caps remain within [a1, a2]
    d_theta = cap_r / r_mid
    ia1 = a1 + d_theta
    ia2 = a2 - d_theta

    ctx.new_sub_path()
    # Outer arc from ia1 (bottom-right) to ia2 (bottom-left)
    ctx.arc(cx, cy, r_outer, ia1, ia2)
    # Left rounded end-cap centered at (r_mid, ia2)
    lx = cx + r_mid * math.cos(ia2)
    ly = cy + r_mid * math.sin(ia2)
    ctx.arc(lx, ly, cap_r, ia2, ia2 + math.pi)
    # Inner arc back from ia2 to ia1
    ctx.arc_negative(cx, cy, r_inner, ia2, ia1)
    # Right rounded end-cap centered at (r_mid, ia1)
    rx = cx + r_mid * math.cos(ia1)
    ry = cy + r_mid * math.sin(ia1)
    ctx.arc(rx, ry, cap_r, ia1 + math.pi, ia1 + 2.0 * math.pi)
    ctx.close_path()


def render_curved_arabic_text(
    text: str,
    canvas_size: int,
    cx: float,
    cy: float,
    r_text: float,
    font_size_px: int,
) -> Image.Image:
    """
    Render crisp HarfBuzz-shaped RTL Arabic text with PangoCairo onto a strip,
    then gently curve-warp it along the circular arc of radius r_text centered at (cx, cy)
    so ligatures remain 100% intact while following the curved metallic ribbon.
    """
    strip_w = 720
    strip_h = 220
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, strip_w, strip_h)
    ctx = cairo.Context(surface)

    layout = create_pango_rtl_layout(
        ctx,
        text,
        f"Noto Kufi Arabic Extra Bold {font_size_px}px",
        max_width_px=strip_w - 40,
        align=Pango.Alignment.CENTER,
    )
    _, logical = layout.get_pixel_extents()
    tx = (strip_w - logical.width) / 2.0 - logical.x
    ty = (strip_h - logical.height) / 2.0 - logical.y

    # Subtle drop shadow
    ctx.move_to(tx, ty + 4.5)
    ctx.set_source_rgba(0.0, 0.0, 0.0, 0.45)
    PangoCairo.show_layout(ctx, layout)

    # Pure crisp white lettering
    ctx.move_to(tx, ty)
    ctx.set_source_rgb(1.0, 1.0, 1.0)
    PangoCairo.show_layout(ctx, layout)

    buf = io.BytesIO()
    surface.write_to_png(buf)
    buf.seek(0)
    strip_arr = np.array(Image.open(buf).convert("RGBA"), dtype=np.float32)

    out = np.zeros((canvas_size, canvas_size, 4), dtype=np.float32)
    # Map target region around bottom arc onto straight strip using polar coords
    y_min = max(0, int(cy + r_text - strip_h))
    y_max = min(canvas_size, int(cy + r_text + strip_h))
    x_min = max(0, int(cx - strip_w * 0.55))
    x_max = min(canvas_size, int(cx + strip_w * 0.55))

    yy, xx = np.mgrid[y_min:y_max, x_min:x_max].astype(np.float32)
    dx = xx - cx
    dy = yy - cy
    rr = np.sqrt(dx * dx + dy * dy)
    # Angle relative to straight down (90 deg): positive to the right, negative to the left
    theta = np.arctan2(dx, dy)

    src_x = strip_w * 0.5 + theta * r_text
    src_y = strip_h * 0.5 + (rr - r_text)

    valid = (src_x >= 0) & (src_x < strip_w - 1) & (src_y >= 0) & (src_y < strip_h - 1) & (dy > 0)
    sx0 = np.clip(np.floor(src_x).astype(np.int32), 0, strip_w - 2)
    sy0 = np.clip(np.floor(src_y).astype(np.int32), 0, strip_h - 2)
    fx = (src_x - sx0)[..., None]
    fy = (src_y - sy0)[..., None]

    c00 = strip_arr[sy0, sx0]
    c10 = strip_arr[sy0, sx0 + 1]
    c01 = strip_arr[sy0 + 1, sx0]
    c11 = strip_arr[sy0 + 1, sx0 + 1]
    sampled = (
        c00 * (1.0 - fx) * (1.0 - fy)
        + c10 * fx * (1.0 - fy)
        + c01 * (1.0 - fx) * fy
        + c11 * fx * fy
    )
    sampled[~valid] = 0.0
    out[y_min:y_max, x_min:x_max] = np.clip(sampled, 0.0, 255.0)
    return Image.fromarray(out.astype(np.uint8), mode="RGBA")


def render_cutout_edition_icon(clean_emblem: Image.Image, edition: dict | None) -> Image.Image:
    """
    Icon Set A (1024x1024 RGBA):
    - 100% transparent (Alpha = 0) outside the circular emblem & soft golden rim glow
    - Vibrant church emblem sized at 84% of canvas (diameter 860px, radius 430px)
    - Curved metallic-gradient ribbon arc hugging the lower circle curve (100% inside r <= 426)
    """
    size = 1024
    cx = cy = size / 2.0
    emblem_diameter = int(round(size * 0.84))  # 860px
    emblem_r = emblem_diameter / 2.0           # 430px

    # 1. Warm golden outer rim glow on pure transparent canvas (fades to Alpha=0 before edges)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surface)

    glow_grad = cairo.RadialGradient(cx, cy, emblem_r - 12.0, cx, cy, emblem_r + 56.0)
    glow_grad.add_color_stop_rgba(0.0, *GOLD_BRIGHT, 0.55)
    glow_grad.add_color_stop_rgba(0.35, *GOLD_PRIMARY, 0.32)
    glow_grad.add_color_stop_rgba(0.75, *GOLD_BRIGHT, 0.09)
    glow_grad.add_color_stop_rgba(1.0, *GOLD_PRIMARY, 0.0)
    ctx.set_source(glow_grad)
    ctx.arc(cx, cy, emblem_r + 56.0, 0.0, 2.0 * math.pi)
    ctx.fill()

    # Crisp thin luminous gold rim right around the circular seal edge
    ctx.arc(cx, cy, emblem_r + 1.5, 0.0, 2.0 * math.pi)
    ctx.set_source_rgba(*GOLD_BRIGHT, 0.85)
    ctx.set_line_width(4.0)
    ctx.stroke()

    glow_buf = io.BytesIO()
    surface.write_to_png(glow_buf)
    glow_buf.seek(0)
    canvas = Image.open(glow_buf).convert("RGBA")

    # 2. Composite centered circular emblem (84% of canvas)
    scaled_emblem = clean_emblem.resize((emblem_diameter, emblem_diameter), Image.Resampling.LANCZOS)
    offset = (size - emblem_diameter) // 2
    canvas.alpha_composite(scaled_emblem, (offset, offset))

    if edition is None:
        return canvas

    # 3. Curved metallic-gradient ribbon arc strictly inside emblem_r (r <= 425)
    rib_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    rctx = cairo.Context(rib_surface)

    # Clip strictly to the circular emblem boundary so nothing can ever stick out
    rctx.arc(cx, cy, emblem_r - 1.0, 0.0, 2.0 * math.pi)
    rctx.clip()

    r_inner = 324.0
    r_outer = 424.0
    r_mid = (r_inner + r_outer) / 2.0
    half_angle = 36.0 if len(edition["badge_text"]) <= 6 else 41.0

    # Soft ambient drop-shadow behind curved ribbon
    for spread, alpha in ((14.0, 0.24), (7.0, 0.34)):
        build_ribbon_arc_path(rctx, cx, cy + 4.0, r_inner - spread * 0.5, r_outer + spread * 0.4, half_angle + 1.5, (r_outer - r_inner) / 2.0 + spread * 0.4)
        rctx.set_source_rgba(8 / 255, 12 / 255, 24 / 255, alpha)
        rctx.fill()

    # Outer metallic gold border rim
    border_pad = 7.0
    build_ribbon_arc_path(
        rctx,
        cx,
        cy,
        r_inner - border_pad,
        r_outer + border_pad,
        half_angle + 1.0,
        (r_outer - r_inner) / 2.0 + border_pad,
    )
    b_start = hex_to_rgb01(edition["border_start"])
    b_end = hex_to_rgb01(edition["border_end"])
    gold_border_grad = cairo.LinearGradient(cx - 260, cy + r_inner, cx + 260, cy + r_outer)
    gold_border_grad.add_color_stop_rgb(0.0, *b_start)
    gold_border_grad.add_color_stop_rgb(0.35, *GOLD_LIGHT)
    gold_border_grad.add_color_stop_rgb(0.65, *b_end)
    gold_border_grad.add_color_stop_rgb(1.0, *b_start)
    rctx.set_source(gold_border_grad)
    rctx.fill()

    # Main rich edition ribbon core
    build_ribbon_arc_path(rctx, cx, cy, r_inner, r_outer, half_angle, (r_outer - r_inner) / 2.0)
    core_grad = cairo.LinearGradient(cx, cy + r_inner, cx, cy + r_outer)
    core_grad.add_color_stop_rgb(0.0, *hex_to_rgb01(edition["ribbon_top"]))
    core_grad.add_color_stop_rgb(0.45, *hex_to_rgb01(edition["ribbon_mid"]))
    core_grad.add_color_stop_rgb(1.0, *hex_to_rgb01(edition["ribbon_bot"]))
    rctx.set_source(core_grad)
    rctx.fill()

    # Subtle glossy specular highlight along upper edge of the ribbon
    build_ribbon_arc_path(rctx, cx, cy, r_inner + 6.0, r_inner + 32.0, half_angle - 4.0, 12.0)
    spec_grad = cairo.LinearGradient(cx, cy + r_inner, cx, cy + r_inner + 34.0)
    spec_grad.add_color_stop_rgba(0.0, 1.0, 1.0, 1.0, 0.24)
    spec_grad.add_color_stop_rgba(1.0, 1.0, 1.0, 1.0, 0.0)
    rctx.set_source(spec_grad)
    rctx.fill()

    # Delicate inner gold hairline inside the ribbon
    build_ribbon_arc_path(rctx, cx, cy, r_inner + 8.0, r_outer - 8.0, half_angle - 1.2, (r_outer - r_inner) / 2.0 - 8.0)
    rctx.set_source_rgba(*GOLD_LIGHT, 0.55)
    rctx.set_line_width(2.5)
    rctx.stroke()

    # Ornamental gold dots flanking the curved label
    for sign in (-1.0, 1.0):
        ang = math.radians(90.0 + sign * (half_angle - 8.5))
        dx = cx + r_mid * math.cos(ang)
        dy = cy + r_mid * math.sin(ang)
        rctx.arc(dx, dy, 6.5, 0.0, 2.0 * math.pi)
        rctx.set_source_rgba(*GOLD_LIGHT, 0.95)
        rctx.fill()

    rib_buf = io.BytesIO()
    rib_surface.write_to_png(rib_buf)
    rib_buf.seek(0)
    ribbon_img = Image.open(rib_buf).convert("RGBA")
    canvas.alpha_composite(ribbon_img, (0, 0))

    # 4. Curved HarfBuzz-shaped Arabic typography along the arc
    font_px = 78 if len(edition["badge_text"]) <= 6 else 64
    curved_text_img = render_curved_arabic_text(
        edition["badge_text"],
        canvas_size=size,
        cx=cx,
        cy=cy,
        r_text=r_mid - 1.0,
        font_size_px=font_px,
    )
    canvas.alpha_composite(curved_text_img, (0, 0))
    return canvas


def render_maskable_edition_icon(cutout_1024: Image.Image, edition: dict | None, safe_scale: float = 0.76) -> Image.Image:
    """
    Icon Set B (1024x1024 RGBA, opaque full-bleed):
    - Cinematic warm ivory-gold radial sunburst/spotlight backdrop (zero black edges)
    - Scales the transparent cutout emblem strictly inside Android's 64-66% safe zone
      so circle/squircle/teardrop launcher masks NEVER clip the crest or Arabic ribbon!
    """
    size = 1024
    cx = cy = size / 2.0
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surface)

    # Full-bleed warm luminous radial spotlight (#FFFBEB -> #FEF3C7 -> #F59E0B warm halo)
    bg_grad = cairo.RadialGradient(cx, cy, 40.0, cx, cy, size * 0.74)
    bg_grad.add_color_stop_rgb(0.0, 1.0, 251 / 255, 235 / 255)   # #FFFBEB
    bg_grad.add_color_stop_rgb(0.42, 254 / 255, 243 / 255, 199 / 255)  # #FEF3C7
    bg_grad.add_color_stop_rgb(0.78, 253 / 255, 224 / 255, 138 / 255)  # warm sunlit gold
    outer_rgb = hex_to_rgb01(edition["sunburst_outer"]) if edition else (245 / 255, 158 / 255, 11 / 255)
    bg_grad.add_color_stop_rgb(1.0, *outer_rgb)
    ctx.set_source(bg_grad)
    ctx.rectangle(0, 0, size, size)
    ctx.fill()

    # Subtle cinematic sunburst rays radiating from center
    num_rays = 24
    ray_step = (2.0 * math.pi) / num_rays
    for i in range(num_rays):
        if i % 2 != 0:
            continue
        a_start = i * ray_step
        a_end = a_start + ray_step * 0.45
        ctx.new_sub_path()
        ctx.move_to(cx, cy)
        ctx.arc(cx, cy, size * 0.85, a_start, a_end)
        ctx.close_path()
        ray_grad = cairo.RadialGradient(cx, cy, 80.0, cx, cy, size * 0.72)
        ray_grad.add_color_stop_rgba(0.0, 1.0, 1.0, 1.0, 0.28)
        ray_grad.add_color_stop_rgba(1.0, 1.0, 1.0, 1.0, 0.0)
        ctx.set_source(ray_grad)
        ctx.fill()

    # Soft golden halo behind safe-zone emblem
    halo = cairo.RadialGradient(cx, cy, 180.0, cx, cy, 410.0)
    halo.add_color_stop_rgba(0.0, 1.0, 1.0, 1.0, 0.72)
    halo.add_color_stop_rgba(0.65, *GOLD_BRIGHT, 0.25)
    halo.add_color_stop_rgba(1.0, *GOLD_PRIMARY, 0.0)
    ctx.set_source(halo)
    ctx.arc(cx, cy, 410.0, 0.0, 2.0 * math.pi)
    ctx.fill()

    # Subtle outer edition-colored corner vignette for rich depth
    if edition:
        tint = hex_to_rgb01(edition["sunburst_tint"])
        vig = cairo.RadialGradient(cx, cy, size * 0.36, cx, cy, size * 0.78)
        vig.add_color_stop_rgba(0.0, *tint, 0.0)
        vig.add_color_stop_rgba(1.0, *tint, 0.22)
        ctx.set_source(vig)
        ctx.rectangle(0, 0, size, size)
        ctx.fill()

    buf = io.BytesIO()
    surface.write_to_png(buf)
    buf.seek(0)
    backdrop = Image.open(buf).convert("RGBA")

    # Scale cutout_1024 to safe_scale (0.76 -> emblem circle diameter = 0.76 * 0.84 = 63.84% of canvas!)
    target_dim = int(round(size * safe_scale))
    scaled_cutout = cutout_1024.resize((target_dim, target_dim), Image.Resampling.LANCZOS)
    pos = (size - target_dim) // 2
    backdrop.alpha_composite(scaled_cutout, (pos, pos))
    return backdrop


def render_edition_og_image(badged_logo_rgba: Image.Image, edition: dict) -> Image.Image:
    """Create a 1200x630 Royal Coptic Creamy Parchment social share card for the edition."""
    width, height = 1200, 630
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    ctx = cairo.Context(surface)

    bg_grad = cairo.RadialGradient(width * 0.5, height * 0.45, 80, width * 0.5, height * 0.5, 760)
    bg_grad.add_color_stop_rgb(0.0, 253 / 255, 251 / 255, 247 / 255)
    bg_grad.add_color_stop_rgb(1.0, 240 / 255, 232 / 255, 214 / 255)
    ctx.set_source(bg_grad)
    ctx.rectangle(0, 0, width, height)
    ctx.fill()

    fill_rgb = hex_to_rgb01(edition["fill_hex"])
    ctx.set_source_rgb(*fill_rgb)
    ctx.rectangle(0, 0, width, 16)
    ctx.fill()

    ctx.set_source_rgba(*ROYAL_GOLD, 0.85)
    ctx.set_line_width(4.0)
    draw_rounded_rect(ctx, 26, 32, width - 52, height - 58, 28)
    ctx.stroke()

    ctx.set_source_rgba(*ROYAL_GOLD, 0.35)
    ctx.set_line_width(1.5)
    draw_rounded_rect(ctx, 40, 46, width - 80, height - 86, 20)
    ctx.stroke()

    col_x = 76
    col_w = 570

    tag_w, tag_h = 330, 58
    tag_x = col_x + col_w - tag_w
    tag_y = 112
    draw_rounded_rect(ctx, tag_x, tag_y, tag_w, tag_h, 29)
    ctx.set_source_rgb(*fill_rgb)
    ctx.fill()
    ctx.set_source_rgb(*ROYAL_GOLD)
    ctx.set_line_width(2.5)
    draw_rounded_rect(ctx, tag_x, tag_y, tag_w, tag_h, 29)
    ctx.stroke()

    tag_layout = create_pango_rtl_layout(
        ctx,
        edition["title"],
        "Noto Kufi Arabic Extra Bold 24px",
        max_width_px=int(tag_w - 24),
        align=Pango.Alignment.CENTER,
    )
    _, tag_log = tag_layout.get_pixel_extents()
    ctx.move_to(
        tag_x + (tag_w - tag_log.width) / 2.0 - tag_log.x,
        tag_y + (tag_h - tag_log.height) / 2.0 - tag_log.y - 2,
    )
    ctx.set_source_rgb(1, 1, 1)
    PangoCairo.show_layout(ctx, tag_layout)

    church_layout = create_pango_rtl_layout(
        ctx,
        CHURCH_NAME,
        "Noto Kufi Arabic Extra Bold 46px",
        max_width_px=col_w,
        align=Pango.Alignment.RIGHT,
    )
    ctx.move_to(col_x, 202)
    ctx.set_source_rgb(27 / 255, 42 / 255, 89 / 255)
    PangoCairo.show_layout(ctx, church_layout)

    cap_layout = create_pango_rtl_layout(
        ctx,
        edition["caption"],
        "Noto Kufi Arabic Semi Bold 25px",
        max_width_px=col_w,
        align=Pango.Alignment.RIGHT,
    )
    ctx.move_to(col_x, 344)
    ctx.set_source_rgb(*fill_rgb)
    PangoCairo.show_layout(ctx, cap_layout)

    ctx.set_source_rgba(*ROYAL_GOLD, 0.7)
    ctx.set_line_width(2.5)
    ctx.move_to(col_x + 120, 424)
    ctx.line_to(col_x + col_w, 424)
    ctx.stroke()

    svc_layout = create_pango_rtl_layout(
        ctx,
        SERVICE_SUBTITLE,
        "Noto Naskh Arabic Semi Bold 25px",
        max_width_px=col_w,
        align=Pango.Alignment.RIGHT,
    )
    ctx.move_to(col_x, 452)
    ctx.set_source_rgb(90 / 255, 82 / 255, 67 / 255)
    PangoCairo.show_layout(ctx, svc_layout)

    out_buf = io.BytesIO()
    surface.write_to_png(out_buf)
    out_buf.seek(0)
    card_img = Image.open(out_buf).convert("RGBA")

    logo_size = 440
    logo_resized = badged_logo_rgba.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x = width - logo_size - 74
    logo_y = (height - logo_size) // 2 + 4
    card_img.alpha_composite(logo_resized, (logo_x, logo_y))
    return card_img.convert("RGB")


def save_icon_suite(
    out_dir: Path,
    cutout_1024: Image.Image,
    maskable_1024: Image.Image,
    apple_1024: Image.Image,
    edition: dict | None = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # Set A: True Cutout Transparent 32-bit RGBA PNGs (purpose: "any")
    cutout_512 = cutout_1024.resize((512, 512), Image.Resampling.LANCZOS)
    cutout_192 = cutout_1024.resize((192, 192), Image.Resampling.LANCZOS)
    cutout_512.save(out_dir / "logo.png", format="PNG", optimize=True)
    cutout_512.save(out_dir / "pwa-512x512.png", format="PNG", optimize=True)
    cutout_192.save(out_dir / "pwa-192x192.png", format="PNG", optimize=True)

    # Set B: Android Adaptive Maskable 32-bit RGBA PNGs (purpose: "maskable")
    mask_512 = maskable_1024.resize((512, 512), Image.Resampling.LANCZOS)
    mask_192 = maskable_1024.resize((192, 192), Image.Resampling.LANCZOS)
    mask_512.save(out_dir / "pwa-maskable-512x512.png", format="PNG", optimize=True)
    mask_192.save(out_dir / "pwa-maskable-192x192.png", format="PNG", optimize=True)

    # iOS Apple Touch Icon (180x180 luminous sunburst background)
    apple_180 = apple_1024.resize((180, 180), Image.Resampling.LANCZOS)
    apple_180.convert("RGB").save(out_dir / "apple-touch-icon.png", format="PNG", optimize=True)

    # Multi-size favicon.ico from true transparent cutout
    cutout_512.save(
        out_dir / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    if edition is not None:
        og_banner = render_edition_og_image(cutout_1024, edition)
        og_banner.save(out_dir / "og-image.png", format="PNG", optimize=True)


def main() -> None:
    if not ASSETS_ICON_PATH.exists() and not BASE_LOGO_PATH.exists():
        raise FileNotFoundError(f"Master church logo not found at {ASSETS_ICON_PATH} or {BASE_LOGO_PATH}")

    clean_emblem = extract_clean_emblem_1024()

    # 1. Regenerate default root public/ icons (used when VITE_APP_EDITION=all)
    default_cutout = render_cutout_edition_icon(clean_emblem, None)
    default_maskable = render_maskable_edition_icon(default_cutout, None, safe_scale=0.76)
    default_apple = render_maskable_edition_icon(default_cutout, None, safe_scale=0.92)
    save_icon_suite(PUBLIC_DIR, default_cutout, default_maskable, default_apple, edition=None)
    default_cutout.resize((512, 512), Image.Resampling.LANCZOS).save(PUBLIC_DIR / "icon.png", format="PNG", optimize=True)
    print(f"[Generated] default root icons -> {PUBLIC_DIR}")

    # 2. Regenerate all 3 edition suites (admin, servant, parent)
    for edition in EDITIONS:
        cutout_1024 = render_cutout_edition_icon(clean_emblem, edition)
        maskable_1024 = render_maskable_edition_icon(cutout_1024, edition, safe_scale=0.76)
        apple_1024 = render_maskable_edition_icon(cutout_1024, edition, safe_scale=0.92)
        out_dir = EDITIONS_OUT_DIR / edition["id"]
        save_icon_suite(out_dir, cutout_1024, maskable_1024, apple_1024, edition=edition)
        print(f"[Generated] {edition['id']} ({edition['badge_text']}) -> {out_dir}")


if __name__ == "__main__":
    main()
