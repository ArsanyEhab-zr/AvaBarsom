#!/usr/bin/env python3
"""
Generate custom edition-badged logos, PWA icons, favicons, iOS icons, and OG share images
for the 3 church app editions (admin, servant, parent) from the official base church logo.
Uses Cairo + PangoCairo for HarfBuzz-shaped RTL Arabic typography and Pillow for LANCZOS sizing.
"""

import io
import math
from pathlib import Path

import cairo
import gi
from PIL import Image

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402


ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
BASE_LOGO_PATH = PUBLIC_DIR / "logo.png"
EDITIONS_OUT_DIR = PUBLIC_DIR / "editions"

CHURCH_NAME = "كنيسة الأنبا برسوم العريان بطهنشا"
SERVICE_SUBTITLE = "منظومة إدارة الخدمات ومدارس الأحد والمناهج"

GOLD_PRIMARY = (212 / 255, 175 / 255, 55 / 255)
GOLD_LIGHT = (243 / 255, 226 / 255, 169 / 255)
PARCHMENT_BG = (250, 247, 242)


def hex_to_rgb01(hex_color: str) -> tuple[float, float, float]:
    clean = hex_color.lstrip("#")
    return tuple(int(clean[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


EDITIONS = [
    {
        "id": "admin",
        "badge_text": "أدمن",
        "fill_hex": "#1B2A59",
        "dark_hex": "#111B3D",
        "light_hex": "#2A407F",
        "title": "تطبيق الأدمن والأمناء",
        "caption": "الأب الكاهن • أمين الخدمة العام • أمناء المراحل",
    },
    {
        "id": "servant",
        "badge_text": "خادم/ة",
        "fill_hex": "#0F4C3A",
        "dark_hex": "#093226",
        "light_hex": "#186E55",
        "title": "تطبيق الخادم والخادمة",
        "caption": "إدارة الأسرة • الحضور والافتقاد • المناهج والدرجات",
    },
    {
        "id": "parent",
        "badge_text": "ولي أمر",
        "fill_hex": "#6B1D2F",
        "dark_hex": "#4B121F",
        "light_hex": "#8D2840",
        "title": "بوابة ولي الأمر",
        "caption": "متابعة الأبناء • سجل الحضور والنقاط • دروس ومناهج الفصل",
    },
]


def draw_rounded_rect(ctx: cairo.Context, x: float, y: float, w: float, h: float, r: float) -> None:
    """Create a rounded rectangle sub-path on the active Cairo context."""
    r = min(r, w / 2.0, h / 2.0)
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2.0, 0.0)
    ctx.arc(x + w - r, y + h - r, r, 0.0, math.pi / 2.0)
    ctx.arc(x + r, y + h - r, r, math.pi / 2.0, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3.0 * math.pi / 2.0)
    ctx.close_path()


def draw_diamond(ctx: cairo.Context, cx: float, cy: float, radius: float) -> None:
    """Create an ornamental liturgical diamond point."""
    ctx.new_sub_path()
    ctx.move_to(cx, cy - radius)
    ctx.line_to(cx + radius, cy)
    ctx.line_to(cx, cy + radius)
    ctx.line_to(cx - radius, cy)
    ctx.close_path()


def create_pango_rtl_layout(
    ctx: cairo.Context,
    text: str,
    font_desc_str: str,
    max_width_px: int | None = None,
    align: Pango.Alignment = Pango.Alignment.CENTER,
) -> Pango.Layout:
    """Build a Pango layout configured for RTL Arabic ligature shaping."""
    layout = PangoCairo.create_layout(ctx)
    pctx = layout.get_context()
    pctx.set_base_dir(Pango.Direction.RTL)
    layout.set_auto_dir(True)
    desc = Pango.FontDescription(font_desc_str)
    layout.set_font_description(desc)
    layout.set_alignment(align)
    if max_width_px is not None:
        layout.set_width(max_width_px * Pango.SCALE)
        layout.set_wrap(Pango.WrapMode.WORD_CHAR)
    layout.set_text(text, -1)
    return layout


def render_badged_master_logo(base_rgba: Image.Image, edition: dict) -> Image.Image:
    """
    Composite the base church seal at 1024x1024 and overlay a crisp ornamental
    bottom pill badge (~23.5% height) so edition labels read cleanly even at 192px/favicon.
    """
    size = 1024
    # Slightly lift/scale inner logo upward (4%) so the bottom badge crowns the outer seal gracefully
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scaled_logo = base_rgba.resize((int(size * 0.94), int(size * 0.94)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(scaled_logo, (int(size * 0.03), int(size * 0.015)))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    buf.seek(0)
    surface = cairo.ImageSurface.create_from_png(buf)
    ctx = cairo.Context(surface)

    # Pill geometry: ~23.5% height spanning ~76% width near the lower bezel
    pill_h = 236.0
    pill_w = 786.0
    pill_x = (size - pill_w) / 2.0
    pill_y = size - pill_h - 32.0
    radius = pill_h / 2.0

    fill_rgb = hex_to_rgb01(edition["fill_hex"])
    dark_rgb = hex_to_rgb01(edition["dark_hex"])
    light_rgb = hex_to_rgb01(edition["light_hex"])

    # Soft dark ambient drop-shadow behind pill
    for spread, alpha in ((18.0, 0.20), (10.0, 0.28), (4.0, 0.35)):
        draw_rounded_rect(
            ctx,
            pill_x - spread * 0.35,
            pill_y + spread * 0.45,
            pill_w + spread * 0.7,
            pill_h + spread * 0.3,
            radius + spread * 0.3,
        )
        ctx.set_source_rgba(10 / 255, 14 / 255, 28 / 255, alpha)
        ctx.fill()

    # Outer gold ring around pill
    outer_pad = 10.0
    draw_rounded_rect(
        ctx,
        pill_x - outer_pad,
        pill_y - outer_pad,
        pill_w + outer_pad * 2,
        pill_h + outer_pad * 2,
        radius + outer_pad,
    )
    gold_grad = cairo.LinearGradient(pill_x, pill_y, pill_x + pill_w, pill_y + pill_h)
    gold_grad.add_color_stop_rgb(0.0, *GOLD_LIGHT)
    gold_grad.add_color_stop_rgb(0.5, *GOLD_PRIMARY)
    gold_grad.add_color_stop_rgb(1.0, *GOLD_LIGHT)
    ctx.set_source(gold_grad)
    ctx.fill()

    # Main pill body gradient
    draw_rounded_rect(ctx, pill_x, pill_y, pill_w, pill_h, radius)
    body_grad = cairo.LinearGradient(pill_x, pill_y, pill_x, pill_y + pill_h)
    body_grad.add_color_stop_rgb(0.0, *light_rgb)
    body_grad.add_color_stop_rgb(0.28, *fill_rgb)
    body_grad.add_color_stop_rgb(1.0, *dark_rgb)
    ctx.set_source(body_grad)
    ctx.fill()

    # Crisp inner hairline gold border
    inset = 12.0
    draw_rounded_rect(
        ctx,
        pill_x + inset,
        pill_y + inset,
        pill_w - inset * 2,
        pill_h - inset * 2,
        radius - inset,
    )
    ctx.set_source_rgba(*GOLD_LIGHT, 0.65)
    ctx.set_line_width(3.5)
    ctx.stroke()

    # Left and right ornamental gold diamonds
    diamond_offset_x = 74.0
    diamond_cy = pill_y + pill_h / 2.0
    ctx.set_source_rgba(*GOLD_LIGHT, 0.92)
    draw_diamond(ctx, pill_x + diamond_offset_x, diamond_cy, 15.0)
    ctx.fill()
    draw_diamond(ctx, pill_x + pill_w - diamond_offset_x, diamond_cy, 15.0)
    ctx.fill()

    # PangoCairo centered Arabic badge label
    badge_text = edition["badge_text"]
    font_size_pt = 98 if len(badge_text) <= 6 else 86
    layout = create_pango_rtl_layout(
        ctx,
        badge_text,
        f"Noto Kufi Arabic Extra Bold {font_size_pt}px",
        max_width_px=int(pill_w - 170),
        align=Pango.Alignment.CENTER,
    )
    _, logical = layout.get_pixel_extents()
    text_x = pill_x + (pill_w - logical.width) / 2.0 - logical.x
    text_y = pill_y + (pill_h - logical.height) / 2.0 - logical.y - 4.0

    # Subtle text shadow for legibility
    ctx.move_to(text_x, text_y + 5.0)
    ctx.set_source_rgba(0.0, 0.0, 0.0, 0.38)
    PangoCairo.show_layout(ctx, layout)

    # Pure crisp white foreground
    ctx.move_to(text_x, text_y)
    ctx.set_source_rgb(1.0, 1.0, 1.0)
    PangoCairo.show_layout(ctx, layout)

    out_buf = io.BytesIO()
    surface.write_to_png(out_buf)
    out_buf.seek(0)
    return Image.open(out_buf).convert("RGBA")


def render_edition_og_image(badged_logo_rgba: Image.Image, edition: dict) -> Image.Image:
    """Create a 1200x630 Royal Coptic Creamy Parchment social share card for the edition."""
    width, height = 1200, 630
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    ctx = cairo.Context(surface)

    # Warm creamy parchment radial gradient backdrop
    bg_grad = cairo.RadialGradient(width * 0.5, height * 0.45, 80, width * 0.5, height * 0.5, 760)
    bg_grad.add_color_stop_rgb(0.0, 253 / 255, 251 / 255, 247 / 255)
    bg_grad.add_color_stop_rgb(1.0, 240 / 255, 232 / 255, 214 / 255)
    ctx.set_source(bg_grad)
    ctx.rectangle(0, 0, width, height)
    ctx.fill()

    fill_rgb = hex_to_rgb01(edition["fill_hex"])
    # Subtle top accent bar matching edition color
    ctx.set_source_rgb(*fill_rgb)
    ctx.rectangle(0, 0, width, 16)
    ctx.fill()

    # Gold outer & inner frames
    ctx.set_source_rgba(*GOLD_PRIMARY, 0.85)
    ctx.set_line_width(4.0)
    draw_rounded_rect(ctx, 26, 32, width - 52, height - 58, 28)
    ctx.stroke()

    ctx.set_source_rgba(*GOLD_PRIMARY, 0.35)
    ctx.set_line_width(1.5)
    draw_rounded_rect(ctx, 40, 46, width - 80, height - 86, 20)
    ctx.stroke()

    # Edition badge tag pill on top-left of text block (RTL right-aligned column at left side)
    col_x = 76
    col_w = 570

    tag_w, tag_h = 330, 58
    tag_x = col_x + col_w - tag_w
    tag_y = 112
    draw_rounded_rect(ctx, tag_x, tag_y, tag_w, tag_h, 29)
    ctx.set_source_rgb(*fill_rgb)
    ctx.fill()
    ctx.set_source_rgb(*GOLD_PRIMARY)
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

    # Church Name title
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

    # Edition Caption
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

    # Gold divider line
    ctx.set_source_rgba(*GOLD_PRIMARY, 0.7)
    ctx.set_line_width(2.5)
    ctx.move_to(col_x + 120, 424)
    ctx.line_to(col_x + col_w, 424)
    ctx.stroke()

    # System service line
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

    # Composite base cairo card with Pillow badged logo on right side
    out_buf = io.BytesIO()
    surface.write_to_png(out_buf)
    out_buf.seek(0)
    card_img = Image.open(out_buf).convert("RGBA")

    logo_size = 430
    logo_resized = badged_logo_rgba.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x = width - logo_size - 78
    logo_y = (height - logo_size) // 2 + 6
    card_img.alpha_composite(logo_resized, (logo_x, logo_y))
    return card_img.convert("RGB")


def save_edition_icons(master_rgba: Image.Image, edition: dict) -> Path:
    """Save complete icon suite + og-image inside public/editions/<edition_id>/."""
    out_dir = EDITIONS_OUT_DIR / edition["id"]
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. logo.png & pwa-512x512.png (512x512 transparent RGBA)
    logo_512 = master_rgba.resize((512, 512), Image.Resampling.LANCZOS)
    logo_512.save(out_dir / "logo.png", format="PNG", optimize=True)
    logo_512.save(out_dir / "pwa-512x512.png", format="PNG", optimize=True)

    # 2. pwa-192x192.png
    logo_192 = master_rgba.resize((192, 192), Image.Resampling.LANCZOS)
    logo_192.save(out_dir / "pwa-192x192.png", format="PNG", optimize=True)

    # 3. apple-touch-icon.png (180x180 opaque Royal Parchment canvas for crisp iOS launcher display)
    apple_canvas = Image.new("RGBA", (180, 180), (*PARCHMENT_BG, 255))
    inner_icon = master_rgba.resize((164, 164), Image.Resampling.LANCZOS)
    apple_canvas.alpha_composite(inner_icon, (8, 8))
    apple_canvas.convert("RGB").save(out_dir / "apple-touch-icon.png", format="PNG", optimize=True)

    # 4. favicon.ico (multi-resolution 16, 32, 48)
    logo_512.save(
        out_dir / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    # 5. og-image.png (1200x630 banner)
    og_banner = render_edition_og_image(master_rgba, edition)
    og_banner.save(out_dir / "og-image.png", format="PNG", optimize=True)

    return out_dir


def main() -> None:
    if not BASE_LOGO_PATH.exists():
        raise FileNotFoundError(f"Base church logo not found: {BASE_LOGO_PATH}")

    base_rgba = Image.open(BASE_LOGO_PATH).convert("RGBA")
    for edition in EDITIONS:
        master_rgba = render_badged_master_logo(base_rgba, edition)
        out_dir = save_edition_icons(master_rgba, edition)
        print(f"[Generated] {edition['id']} ({edition['badge_text']}) -> {out_dir}")


if __name__ == "__main__":
    main()
