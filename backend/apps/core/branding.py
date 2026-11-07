"""App icons drawn from SiteSettings, so the installed app always matches the admin's brand."""
import hashlib
import io
import logging
import re

from django.core.cache import cache
from PIL import Image, ImageDraw, ImageFont, ImageOps

from apps.media_library.storage import get_storage

log = logging.getLogger(__name__)
DEFAULT_COLOR = "#4F46E5"
HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
# name: (pixels, share of the canvas the mark fills, rounded corners).
# Maskable icons keep the mark inside the safe zone. iOS applies its own mask and needs an opaque image.
ICONS = {
    "icon-192": (192, 1.0, True),
    "icon-512": (512, 1.0, True),
    "maskable-512": (512, 0.72, False),
    "apple-touch": (180, 0.86, False),
}


def brand_version(cfg):
    """Changes whenever an icon would look different, which is what busts browser caches."""
    source = "|".join((cfg.logo or cfg.favicon, cfg.primary_color, cfg.site_name))
    return hashlib.sha256(source.encode()).hexdigest()[:10]


def icon_urls(cfg):
    version = brand_version(cfg)
    return {name.replace("-", "_"): f"/api/v1/site/icons/{name}.png?v={version}" for name in ICONS}


def parse_color(value):
    hex_value = value if HEX_COLOR.fullmatch(value) else DEFAULT_COLOR
    return tuple(int(hex_value[i:i + 2], 16) for i in (1, 3, 5))


def initial(name):
    """The default font is Latin only, so anything else gets a plain tile rather than a missing-glyph box."""
    letter = name.strip().upper()[:1]
    return letter if letter.isascii() and letter.isalnum() else ""


def text_on(color):
    """Same rule as readableOn() in the frontend layout, so the icon matches the in-page logo mark."""
    r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in (v / 255 for v in color)]
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return (255, 255, 255) if 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 else (17, 17, 19)


def load_logo(cfg):
    key = cfg.logo or cfg.favicon
    if not key:
        return None
    try:
        with Image.open(io.BytesIO(get_storage().read_bytes(key, public=True))) as raw:
            return raw.convert("RGBA")
    except Exception:  # storage or decode failure: a lettered icon beats a broken one
        log.warning("Could not load brand image %s", key, exc_info=True)
        return None


def render(cfg, name, logo=None):
    size, fill, rounded = ICONS[name]
    color = parse_color(cfg.primary_color)
    canvas = Image.new("RGBA", (size, size), (*color, 255))
    inner = round(size * fill)
    if logo is not None:
        mark = ImageOps.contain(logo, (inner, inner), Image.Resampling.LANCZOS)
        canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    elif letter := initial(cfg.site_name):
        font = ImageFont.load_default(size=round(inner * 0.6))
        ImageDraw.Draw(canvas).text((size / 2, size / 2), letter, font=font, fill=text_on(color), anchor="mm")
    if rounded:
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4, size * 4), radius=size, fill=255)
        canvas.putalpha(mask.resize((size, size), Image.Resampling.LANCZOS))
    out = io.BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


def icon_png(cfg, name):
    key = f"brand-icon:{brand_version(cfg)}:{name}"
    data = cache.get(key)
    if data is None:
        logo = load_logo(cfg)
        data = render(cfg, name, logo)
        # A storage blip must not pin the lettered stand-in for a whole day.
        if logo is not None or not (cfg.logo or cfg.favicon):
            cache.set(key, data, 86400)
    return data
