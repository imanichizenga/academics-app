"""TipTap JSON to safe HTML.

Output is built from an allow-list of node and mark types, so unknown input renders as nothing, and
then passes through nh3 as a second independent layer. Stored XSS needs both to fail.
"""
import html
import math
import re

import nh3
from django.utils.text import slugify

SAFE_COLOR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., %]+\)|var\(--[a-z0-9-]+\))$")
SAFE_URL = re.compile(r"^(https?://|mailto:|/|#)", re.I)
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
ALLOWED_TAGS = {
    "p", "h2", "h3", "h4", "strong", "em", "u", "s", "mark", "code", "pre", "a", "span", "br", "hr", "ul", "ol",
    "li", "blockquote", "div", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "input",
    "label",
}
ALLOWED_ATTRS = {
    "*": {"class", "id"},
    "a": {"href", "data-file-link", "data-asset-id", "data-filename", "data-size", "target"},
    "img": {"src", "alt", "loading", "data-asset-id", "width", "height"},
    "span": {"style"},
    "mark": {"style"},
    "pre": {"data-language"},
    "code": {"data-language"},
    "div": {"data-embed", "data-asset-id", "data-youtube-id", "data-filename", "data-size", "data-kind", "data-variant",
            "data-duration", "data-page-count"},
    "figure": {"data-align"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    "input": {"type", "checked", "disabled"},
    "li": {"data-checked"},
    "ul": {"data-type"},
}


def esc(value):
    return html.escape(str(value or ""), quote=True)


def plain_text(node):
    if isinstance(node, list):
        return " ".join(filter(None, (plain_text(n) for n in node)))
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    return plain_text(node.get("content") or [])


def collect_asset_ids(doc):
    """Every asset referenced by nodes (images, embeds) and marks (fileLink)."""
    found = set()

    def walk(node):
        if isinstance(node, dict):
            attrs = node.get("attrs") or {}
            if attrs.get("assetId"):
                found.add(str(attrs["assetId"]))
            for mark in node.get("marks") or []:
                if mark.get("type") == "fileLink" and (mark.get("attrs") or {}).get("assetId"):
                    found.add(str(mark["attrs"]["assetId"]))
            walk(node.get("content") or [])
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(doc)
    return found


class Renderer:
    def __init__(self, assets=None):
        self.assets = assets or {}
        self.heading_ids = {}

    def text(self, node):
        out = esc(node.get("text", ""))
        for mark in reversed(node.get("marks") or []):
            out = self.mark(mark, out)
        return out

    def mark(self, mark, inner):
        kind, attrs = mark.get("type"), mark.get("attrs") or {}
        simple = {"bold": "strong", "italic": "em", "underline": "u", "strike": "s", "code": "code"}
        if kind in simple:
            return f"<{simple[kind]}>{inner}</{simple[kind]}>"
        if kind == "highlight":
            color = attrs.get("color")
            style = f' style="background-color:{esc(color)}"' if color and SAFE_COLOR.match(color) else ""
            return f"<mark{style}>{inner}</mark>"
        if kind == "textStyle":
            color = attrs.get("color")
            if color and SAFE_COLOR.match(color):
                return f'<span style="color:{esc(color)}">{inner}</span>'
            return inner
        if kind == "link":
            href = attrs.get("href") or ""
            if not SAFE_URL.match(href):
                return inner
            return f'<a href="{esc(href)}" target="_blank">{inner}</a>'
        if kind == "fileLink":
            asset = self.assets.get(str(attrs.get("assetId")))
            if asset is None:
                return inner
            return (
                f'<a class="file-link" href="/api/v1/media/{asset.pk}/download/" data-file-link="true" '
                f'data-asset-id="{asset.pk}" data-filename="{esc(asset.original_filename)}" '
                f'data-size="{asset.size}">{inner}</a>'
            )
        return inner

    def children(self, node):
        return "".join(self.node(c) for c in node.get("content") or [])

    def embed(self, kind, asset_id, extra=""):
        asset = self.assets.get(str(asset_id))
        if asset is None:
            return ""
        return (
            f'<div class="embed" data-embed="{kind}" data-asset-id="{asset.pk}" '
            f'data-filename="{esc(asset.original_filename)}" data-size="{asset.size}" data-kind="{esc(asset.kind)}"'
            f' data-duration="{asset.duration or 0}" data-page-count="{asset.page_count or 0}"{extra}></div>'
        )

    def node(self, node):  # noqa: C901 - a flat dispatch reads better split over helpers
        if not isinstance(node, dict):
            return ""
        kind, attrs = node.get("type"), node.get("attrs") or {}
        if kind == "text":
            return self.text(node)
        if kind == "paragraph":
            return f"<p>{self.children(node)}</p>"
        if kind == "heading":
            level = min(max(int(attrs.get("level") or 2), 2), 4)
            base = slugify(plain_text(node))[:60] or "section"
            seen = self.heading_ids.get(base, 0)
            self.heading_ids[base] = seen + 1
            hid = base if not seen else f"{base}-{seen + 1}"
            return f'<h{level} id="{hid}">{self.children(node)}</h{level}>'
        if kind in ("bulletList", "orderedList"):
            tag = "ul" if kind == "bulletList" else "ol"
            return f"<{tag}>{self.children(node)}</{tag}>"
        if kind == "listItem":
            return f"<li>{self.children(node)}</li>"
        if kind == "taskList":
            return f'<ul data-type="taskList">{self.children(node)}</ul>'
        if kind == "taskItem":
            checked = bool(attrs.get("checked"))
            box = f'<input type="checkbox" disabled{" checked" if checked else ""}>'
            return f'<li data-checked="{str(checked).lower()}"><label>{box}</label><div>{self.children(node)}</div></li>'
        if kind == "blockquote":
            return f"<blockquote>{self.children(node)}</blockquote>"
        if kind == "codeBlock":
            lang = re.sub(r"[^a-z0-9+#-]", "", str(attrs.get("language") or "").lower())
            code = "".join(esc(c.get("text", "")) for c in node.get("content") or [])
            return f'<pre data-language="{lang}"><code>{code}</code></pre>'
        if kind == "horizontalRule":
            return "<hr>"
        if kind == "hardBreak":
            return "<br>"
        if kind == "table":
            return f'<div class="table-wrap"><table><tbody>{self.children(node)}</tbody></table></div>'
        if kind == "tableRow":
            return f"<tr>{self.children(node)}</tr>"
        if kind in ("tableCell", "tableHeader"):
            tag = "th" if kind == "tableHeader" else "td"
            span = ""
            for name, key in (("colspan", "colspan"), ("rowspan", "rowspan")):
                value = int(attrs.get(key) or 1)
                span += f' {name}="{value}"' if value > 1 else ""
            return f"<{tag}{span}>{self.children(node)}</{tag}>"
        if kind == "callout":
            variant = attrs.get("variant") if attrs.get("variant") in ("info", "warning", "tip") else "info"
            return f'<div class="callout" data-variant="{variant}">{self.children(node)}</div>'
        if kind == "image":
            return self.image(attrs)
        if kind == "videoEmbed":
            if attrs.get("youtubeId") and YOUTUBE_ID.match(str(attrs["youtubeId"])):
                return f'<div class="embed" data-embed="youtube" data-youtube-id="{esc(attrs["youtubeId"])}"></div>'
            return self.embed("video", attrs.get("assetId"))
        if kind == "audioEmbed":
            return self.embed("audio", attrs.get("assetId"))
        if kind == "pdfEmbed":
            return self.embed("pdf", attrs.get("assetId"))
        if kind == "fileCard":
            return self.embed("file", attrs.get("assetId"))
        return self.children(node) if kind == "doc" else ""

    def image(self, attrs):
        asset = self.assets.get(str(attrs.get("assetId")))
        if asset is None:
            return ""
        align = attrs.get("align") if attrs.get("align") in ("center", "wide", "left", "right") else "center"
        caption = attrs.get("caption")
        cap = f"<figcaption>{esc(caption)}</figcaption>" if caption else ""
        size = f' width="{asset.width}" height="{asset.height}"' if asset.width and asset.height else ""
        return (
            f'<figure data-align="{align}"><img src="/api/v1/media/{asset.pk}/view/?w=960" '
            f'alt="{esc(attrs.get("alt"))}" loading="lazy"{size}>{cap}</figure>'
        )


def load_assets(doc):
    from apps.media_library.models import MediaAsset

    ids = [i for i in collect_asset_ids(doc) if re.fullmatch(r"[0-9a-fA-F-]{36}", i)]
    return {str(a.pk): a for a in MediaAsset.objects.filter(pk__in=ids)} if ids else {}


def sanitize(markup):
    return nh3.clean(
        markup,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer nofollow",
        filter_style_properties={"color", "background-color"},
    )


def render_html(doc, limit_blocks=None):
    if not isinstance(doc, dict) or not doc.get("content"):
        return ""
    blocks = doc["content"] if limit_blocks is None else doc["content"][:limit_blocks]
    renderer = Renderer(load_assets({"content": blocks}))
    return sanitize("".join(renderer.node(b) for b in blocks))


def count_words(doc):
    return len(re.findall(r"\w+", plain_text(doc)))


def reading_minutes(words):
    return max(1, math.ceil(words / 220)) if words else 0
