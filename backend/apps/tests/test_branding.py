"""Brand settings come from the database and reach every surface, including the installed app."""
import io
from unittest import mock

import pytest
from PIL import Image

from apps.core import branding
from apps.core.models import SiteSettings
from apps.media_library.storage import get_storage

SETTINGS = "/api/v1/admin/settings/site/"


def site(**fields):
    obj = SiteSettings.objects.get_or_create(pk=1)[0]
    for key, value in fields.items():
        setattr(obj, key, value)
    obj.save()
    return obj


def store_logo(color=(10, 200, 30, 255), key="public/covers/logo.webp"):
    out = io.BytesIO()
    Image.new("RGBA", (400, 200), color).save(out, "WEBP", lossless=True)
    get_storage().put_bytes(key, out.getvalue(), "image/webp", public=True)
    return key


def icon(client, name):
    response = client.get(f"/api/v1/site/icons/{name}.png")
    assert response.status_code == 200
    assert response["Content-Type"] == "image/png"
    return Image.open(io.BytesIO(response.content)).convert("RGBA")


@pytest.mark.parametrize("name,size", [("icon-192", 192), ("icon-512", 512), ("maskable-512", 512), ("apple-touch", 180)])
def test_icons_have_the_declared_size(client, name, size):
    assert icon(client, name).size == (size, size)


def test_unknown_icon_is_404(client):
    assert client.get("/api/v1/site/icons/icon-9999.png").status_code == 404


def test_icon_background_follows_the_primary_color(client):
    site(primary_color="#0D9488", site_name="Shule")
    assert icon(client, "maskable-512").getpixel((4, 4)) == (13, 148, 136, 255)


def test_icon_uses_the_uploaded_logo(client):
    site(logo=store_logo(), primary_color="#000000")
    assert icon(client, "icon-512").getpixel((256, 256))[:3] == pytest.approx((10, 200, 30), abs=3)


def test_any_icon_has_round_corners_but_apple_icon_is_opaque(client):
    site(site_name="Shule")
    assert icon(client, "icon-192").getpixel((0, 0))[3] == 0
    assert icon(client, "apple-touch").getpixel((0, 0))[3] == 255


def test_missing_logo_file_still_gives_an_icon_and_is_not_cached(client):
    site(logo="public/covers/gone.webp", primary_color="#0D9488")
    assert icon(client, "icon-192").size == (192, 192)
    store_logo(key="public/covers/gone.webp")
    assert icon(client, "icon-512").getpixel((256, 256))[:3] == pytest.approx((10, 200, 30), abs=3)
    assert icon(client, "icon-192").getpixel((96, 96))[:3] == pytest.approx((10, 200, 30), abs=3)


def test_rendered_icons_are_cached(client):
    site(logo=store_logo())
    with mock.patch.object(branding, "render", wraps=branding.render) as render:
        icon(client, "icon-192")
        icon(client, "icon-192")
    assert render.call_count == 1


@pytest.mark.parametrize("change", [{"primary_color": "#0D9488"}, {"site_name": "Shule"}, {"logo": "public/covers/x.webp"}])
def test_icon_urls_change_with_the_brand(client, change):
    before = client.get("/api/v1/site/").json()["icons"]
    site(**change)
    after = client.get("/api/v1/site/").json()["icons"]
    assert set(after) == {"icon_192", "icon_512", "maskable_512", "apple_touch"}
    assert before["icon_192"] != after["icon_192"]


@pytest.mark.parametrize("color,text", [((13, 148, 136), (17, 17, 19)), ((79, 70, 229), (255, 255, 255)),
                                        ((255, 255, 255), (17, 17, 19)), ((0, 0, 0), (255, 255, 255))])
def test_letter_color_matches_the_frontend_rule(color, text):
    assert branding.text_on(color) == text


@pytest.mark.parametrize("name,letter", [(" shule", "S"), ("7 Masomo", "7"), ("مدرسة", ""), ("", "")])
def test_initial(name, letter):
    assert branding.initial(name) == letter


def test_bad_stored_color_falls_back(client):
    site(primary_color="#abc")
    assert icon(client, "maskable-512").getpixel((4, 4))[:3] == (79, 70, 229)


def test_admin_saves_brand_and_public_site_reflects_it(client, admin):
    client.login_as(admin)
    key = store_logo()
    body = {"site_name": "Shule", "primary_color": "#0D9488", "logo": key}
    assert client.patch(SETTINGS, body, format="json").status_code == 200
    public = client.get("/api/v1/site/").json()
    assert (public["site_name"], public["primary_color"]) == ("Shule", "#0D9488")
    assert public["logo_url"].endswith("logo.webp")


def test_admin_can_remove_the_logo(client, admin):
    site(logo=store_logo())
    client.login_as(admin)
    assert client.patch(SETTINGS, {"logo": ""}, format="json").status_code == 200
    assert client.get("/api/v1/site/").json()["logo_url"] == ""


@pytest.mark.parametrize("value", ["red", "#abc", "#4F46E5FF", "#GGGGGG", "#000000;}", ""])
def test_primary_color_is_validated(client, admin, value):
    client.login_as(admin)
    assert client.patch(SETTINGS, {"primary_color": value}, format="json").status_code == 400


@pytest.mark.parametrize("field", ["logo", "favicon"])
@pytest.mark.parametrize("value", ["documents/secret.pdf", "public/../documents/secret.pdf"])
def test_brand_images_must_be_public(client, admin, field, value):
    client.login_as(admin)
    assert client.patch(SETTINGS, {field: value}, format="json").status_code == 400


def test_brand_stays_visible_during_maintenance(client):
    key = store_logo()
    site(logo=key, maintenance_mode=True)
    assert client.get(f"/api/v1/media/public/{key}").status_code == 200
    assert client.get("/api/v1/site/icons/icon-192.png").status_code == 200
