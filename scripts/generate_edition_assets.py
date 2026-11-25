#!/usr/bin/env python3
"""
Generate pure full-size (97% canvas) 32-bit RGBA transparent circular cutout icons
for all 3 church app editions (admin, servant, parent) plus default root assets.
Zero square backgrounds, zero maskable padding, 100% transparent outside the circle.
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

GOLD_LIGHT = (254 / 255, 243 / 255, 199 / 255)
ROYAL_GOLD = (217 / 255, 119 / 255, 6 / 255)
GOLD_BRIGHT = (251 / 255, 191 / 255, 36 / 255)

EDITIONS = [
    {
        "id": "admin",
        "badge_text": "أدمن",
        "ribbon_top": "#1E293B",
        "ribbon_bot": "#090E1A",
        "border_hex": "#FBBF24",
        "fill_hex": "#1B2A59",
        "title": "تطبيق الأدمن والأمناء",
        "caption": "الأب الكاهن • أمين الخدمة العام • أمناء المراحل",
    },
    {
        "id": "servant",
        "badge_text": "الخدام",
        "ribbon_top": "#10B981",
        "ribbon_bot": "#047857",
        "border_hex": "#FBBF24",
        "fill_hex": "#059669",
        "title": "تطبيق الخادم والخادمة",
        "caption": "إدارة الأسرة • الحضور والافتقاد • المناهج والدرجات",
    },
    {
        "id": "parent",
        "badge_text": "ولي الأمر",
        "ribbon_top": "#38BDF8",
        "ribbon_bot": "#0369A1",
        "border_hex": "#FBBF24",
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
    Extract ONLY the circular church logo itself from assets/icon.png (1024x1024),
    tightly trimmed to its outer circular rim with 100% pure transparency outside.
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
        alpha_img = Image.fromarray((fg.astype(np.uint8) * 255), mode="L")
        alpha_soft = alpha_img.filter(ImageFilter.GaussianBlur(radius=1.0))
        alpha_arr = np.array(alpha_soft, dtype=np.float32)
        alpha_arr = np.where(fg, np.clip((alpha_arr - 90.0) / 165.0 * 255.0, 0.0, 255.0), 0.0)
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

    alpha_ch = cropped.getchannel("A")
    rgb = cropped.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(1.12)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.06)
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


def render_fullsize_cutout_icon(clean_emblem: Image.Image, edition: dict | None) -> Image.Image:
    """
    Pure Full-Size Cutout Logo (1024x1024 RGBA):
    - 97% edge-to-edge circular church logo (~994px of 1024px, ~496px of 512px)
    - 100% pure transparent (Alpha = 0) outside the circle — ZERO boxes, ZERO halos/padding
    - Sleek micro-pill at bottom edge (y = 87%..97%) without shrinking the 97% logo behind it
    """
    size = 1024
    emblem_dim = int(round(size * 0.97))  # 994px (~97% edge-to-edge)
    offset = (size - emblem_dim) // 2

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scaled_emblem = clean_emblem.resize((emblem_dim, emblem_dim), Image.Resampling.LANCZOS)
    canvas.alpha_composite(scaled_emblem, (offset, offset))

    if edition is None:
        return canvas

    # Tiny sleek micro-pill at y = 87%..97% (height = 98px, width = 340..390px)
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    buf.seek(0)
    surface = cairo.ImageSurface.create_from_png(buf)
    ctx = cairo.Context(surface)

    pill_h = 98.0
    pill_w = 340.0 if len(edition["badge_text"]) <= 6 else 400.0
    pill_x = (size - pill_w) / 2.0
    pill_y = size * 0.875
    radius = pill_h / 2.0

    # Subtle ambient drop shadow
    draw_rounded_rect(ctx, pill_x - 2.0, pill_y + 4.0, pill_w + 4.0, pill_h + 2.0, radius + 2.0)
    ctx.set_source_rgba(0.0, 0.0, 0.0, 0.35)
    ctx.fill()

    # Crisp gold rim around micro-pill
    pad = 5.0
    draw_rounded_rect(ctx, pill_x - pad, pill_y - pad, pill_w + pad * 2, pill_h + pad * 2, radius + pad)
    border_rgb = hex_to_rgb01(edition["border_hex"])
    gold_grad = cairo.LinearGradient(pill_x, pill_y, pill_x + pill_w, pill_y + pill_h)
    gold_grad.add_color_stop_rgb(0.0, *ROYAL_GOLD)
    gold_grad.add_color_stop_rgb(0.5, *border_rgb)
    gold_grad.add_color_stop_rgb(1.0, *ROYAL_GOLD)
    ctx.set_source(gold_grad)
    ctx.fill()

    # Rich gradient core
    draw_rounded_rect(ctx, pill_x, pill_y, pill_w, pill_h, radius)
    core_grad = cairo.LinearGradient(pill_x, pill_y, pill_x, pill_y + pill_h)
    core_grad.add_color_stop_rgb(0.0, *hex_to_rgb01(edition["ribbon_top"]))
    core_grad.add_color_stop_rgb(1.0, *hex_to_rgb01(edition["ribbon_bot"]))
    ctx.set_source(core_grad)
    ctx.fill()

    # Crisp Arabic label inside micro-pill
    font_px = 54 if len(edition["badge_text"]) <= 6 else 46
    layout = create_pango_rtl_layout(
        ctx,
        edition["badge_text"],
        f"Noto Kufi Arabic Extra Bold {font_px}px",
        max_width_px=int(pill_w - 36),
        align=Pango.Alignment.CENTER,
    )
    _, logical = layout.get_pixel_extents()
    tx = pill_x + (pill_w - logical.width) / 2.0 - logical.x
    ty = pill_y + (pill_h - logical.height) / 2.0 - logical.y - 2.0

    ctx.move_to(tx, ty + 2.5)
    ctx.set_source_rgba(0.0, 0.0, 0.0, 0.4)
    PangoCairo.show_layout(ctx, layout)

    ctx.move_to(tx, ty)
    ctx.set_source_rgb(1.0, 1.0, 1.0)
    PangoCairo.show_layout(ctx, layout)

    out_buf = io.BytesIO()
    surface.write_to_png(out_buf)
    out_buf.seek(0)
    return Image.open(out_buf).convert("RGBA")


def render_edition_og_image(cutout_logo_rgba: Image.Image, edition: dict) -> Image.Image:
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
    logo_resized = cutout_logo_rgba.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x = width - logo_size - 74
    logo_y = (height - logo_size) // 2 + 4
    card_img.alpha_composite(logo_resized, (logo_x, logo_y))
    return card_img.convert("RGB")


def save_icon_suite(out_dir: Path, cutout_1024: Image.Image, edition: dict | None = None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # Remove any legacy maskable files so Android Chrome always uses the full-size transparent cutout
    for old_maskable in ("pwa-maskable-192x192.png", "pwa-maskable-512x512.png"):
        p = out_dir / old_maskable
        if p.exists():
            p.unlink()

    # Pure 97% transparent cutout 32-bit RGBA PNGs (purpose: "any" ONLY)
    cutout_512 = cutout_1024.resize((512, 512), Image.Resampling.LANCZOS)
    cutout_192 = cutout_1024.resize((192, 192), Image.Resampling.LANCZOS)
    cutout_512.save(out_dir / "logo.png", format="PNG", optimize=True)
    cutout_512.save(out_dir / "pwa-512x512.png", format="PNG", optimize=True)
    cutout_192.save(out_dir / "pwa-192x192.png", format="PNG", optimize=True)

    # iOS Apple Touch Icon (180x180 opaque parchment base + 94% logo; iOS fills alpha with black otherwise)
    apple_canvas = Image.new("RGBA", (180, 180), (250, 247, 242, 255))
    inner = cutout_1024.resize((172, 172), Image.Resampling.LANCZOS)
    apple_canvas.alpha_composite(inner, (4, 4))
    apple_canvas.convert("RGB").save(out_dir / "apple-touch-icon.png", format="PNG", optimize=True)

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

    # 1. Default root public/ icons (97% pure cutout)
    default_cutout = render_fullsize_cutout_icon(clean_emblem, None)
    save_icon_suite(PUBLIC_DIR, default_cutout, edition=None)
    default_cutout.resize((512, 512), Image.Resampling.LANCZOS).save(PUBLIC_DIR / "icon.png", format="PNG", optimize=True)
    print(f"[Generated] default root icons (97% cutout) -> {PUBLIC_DIR}")

    # 2. All 3 editions (admin, servant, parent)
    for edition in EDITIONS:
        cutout_1024 = render_fullsize_cutout_icon(clean_emblem, edition)
        out_dir = EDITIONS_OUT_DIR / edition["id"]
        save_icon_suite(out_dir, cutout_1024, edition=edition)
        print(f"[Generated] {edition['id']} ({edition['badge_text']}, 97% cutout) -> {out_dir}")


if __name__ == "__main__":
    main()
