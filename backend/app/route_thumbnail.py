"""Kaartminiatuur met echte OSM-achtergrond voor routes zonder eigen kaartbestand.

Alle routes die niet via de oude routeboek.cc-scrape zijn binnengekomen (dus:
community-routes en door admins via GPX toegevoegde routes) hebben geen
`Route.map_file` — er is nooit een kaartafbeelding voor gescreenshot. Zonder
achtergrond zag het overzicht/ritten alleen een rode lijn op een grijs vlak
(zie eerdere versie van dit bestand), wat verwarrend oogt naast de echte
kaartjes van de officiële routes.

Dit bestand rendert daarom een kleine PNG met een echte OpenStreetMap-
achtergrond:

1. Bepaal de bounding box van de route en kies de grootste zoom die nog past
   binnen het doelformaat (`_pick_zoom`), net als een "fit bounds" op een
   normale kaart.
2. Download de benodigde 256×256 OSM-tegels (met caching, zie hieronder) en
   plak ze op een canvas.
3. Snijd het canvas bij tot het gewenste formaat en teken de route als rode
   lijn erover heen.

**Tegel-caching is verplicht**, niet optioneel: de OSM-tile-usage-policy
staat geen herhaald automatisch ophalen van dezelfde tegel toe, en onze
club-routes liggen bovendien allemaal dicht bij elkaar (Nederland), dus
tegels worden sowieso vaak hergebruikt tussen routes. Tegels blijven daarom
`TILE_CACHE_TTL_S` op schijf staan onder `cache_dir/osm_tiles/`. Het
uiteindelijke gecomponeerde plaatje wordt zelf ook gecachet onder
`cache_dir/route_maps/`, gesleuteld op een hash van de coördinaten, zodat een
herhaald verzoek voor dezelfde route niet steeds opnieuw hoeft te
tekenen/downloaden.
"""

from __future__ import annotations

import hashlib
import logging
import math
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageDraw

from app.config import get_settings

logger = logging.getLogger(__name__)

WIDTH = 320
HEIGHT = 200
PADDING = 24
TILE_SIZE = 256
MIN_ZOOM = 4
MAX_ZOOM = 17
TILE_SERVERS = ("a", "b", "c")
TILE_CACHE_TTL_S = 30 * 24 * 3600  # OSM-tegels veranderen zelden; 30 dagen is ruim genoeg.
FETCH_TIMEOUT = 8


def _lonlat_to_pixel(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    """Wereldpixelcoördinaat (Web Mercator) van een lat/lon op een gegeven zoom."""
    n = 2**zoom
    x = (lon + 180.0) / 360.0 * n * TILE_SIZE
    lat_rad = math.radians(max(min(lat, 85.05112878), -85.05112878))
    y = (
        (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi)
        / 2.0
        * n
        * TILE_SIZE
    )
    return x, y


def _pick_zoom(points: list[tuple[float, float]]) -> int:
    """Grootste zoomniveau waarbij de route (plus padding) nog in het canvas past."""
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    target_w = WIDTH - 2 * PADDING
    target_h = HEIGHT - 2 * PADDING
    for zoom in range(MAX_ZOOM, MIN_ZOOM - 1, -1):
        xs = [_lonlat_to_pixel(lat, lon, zoom)[0] for lat, lon in zip(lats, lons)]
        ys = [_lonlat_to_pixel(lat, lon, zoom)[1] for lat, lon in zip(lats, lons)]
        span_x = max(xs) - min(xs)
        span_y = max(ys) - min(ys)
        if span_x <= target_w and span_y <= target_h:
            return zoom
    return MIN_ZOOM


def _tile_cache_path(zoom: int, x: int, y: int) -> Path:
    return get_settings().cache_dir / "osm_tiles" / str(zoom) / str(x) / f"{y}.png"


def _fetch_tile(zoom: int, x: int, y: int) -> Image.Image | None:
    """Haal één 256x256 OSM-tegel op, met een lokale cache van 30 dagen."""
    n = 2**zoom
    x, y = x % n, y % n  # de wereld is rond; negatieve/te-hoge indices wikkelen om
    path = _tile_cache_path(zoom, x, y)
    if path.exists() and time.time() - path.stat().st_mtime < TILE_CACHE_TTL_S:
        try:
            return Image.open(path).convert("RGB")
        except OSError:
            pass  # corrupte cache, gewoon opnieuw downloaden

    settings = get_settings()
    server = TILE_SERVERS[(x + y) % len(TILE_SERVERS)]
    url = f"https://{server}.tile.openstreetmap.org/{zoom}/{x}/{y}.png"
    try:
        response = requests.get(
            url, timeout=FETCH_TIMEOUT, headers={"User-Agent": settings.user_agent}
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Kon OSM-tegel %s niet ophalen: %s", url, exc)
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    try:
        return Image.open(path).convert("RGB")
    except OSError:
        return None


def _thumbnail_cache_path(coordinates: list[list[float]]) -> Path:
    digest = hashlib.sha1(repr(coordinates).encode("utf-8")).hexdigest()[:20]
    return get_settings().cache_dir / "route_maps" / f"{digest}.png"


def render_route_thumbnail_png(coordinates: list[list[float]]) -> bytes:
    points = [
        (lat, lon) for lat, lon in coordinates if lat is not None and lon is not None
    ]
    if len(points) < 2:
        return _fallback_png()

    cache_path = _thumbnail_cache_path(coordinates)
    if cache_path.exists():
        return cache_path.read_bytes()

    zoom = _pick_zoom(points)
    xs = [_lonlat_to_pixel(lat, lon, zoom)[0] for lat, lon in points]
    ys = [_lonlat_to_pixel(lat, lon, zoom)[1] for lat, lon in points]
    center_x = (min(xs) + max(xs)) / 2
    center_y = (min(ys) + max(ys)) / 2
    box_left = center_x - WIDTH / 2
    box_top = center_y - HEIGHT / 2

    tile_x_min = math.floor(box_left / TILE_SIZE)
    tile_x_max = math.floor((box_left + WIDTH) / TILE_SIZE)
    tile_y_min = math.floor(box_top / TILE_SIZE)
    tile_y_max = math.floor((box_top + HEIGHT) / TILE_SIZE)

    canvas_w = (tile_x_max - tile_x_min + 1) * TILE_SIZE
    canvas_h = (tile_y_max - tile_y_min + 1) * TILE_SIZE
    canvas = Image.new("RGB", (canvas_w, canvas_h), "#e9ecef")

    for tx in range(tile_x_min, tile_x_max + 1):
        for ty in range(tile_y_min, tile_y_max + 1):
            tile = _fetch_tile(zoom, tx, ty)
            if tile is not None:
                canvas.paste(tile, ((tx - tile_x_min) * TILE_SIZE, (ty - tile_y_min) * TILE_SIZE))

    crop_left = round(box_left - tile_x_min * TILE_SIZE)
    crop_top = round(box_top - tile_y_min * TILE_SIZE)
    image = canvas.crop((crop_left, crop_top, crop_left + WIDTH, crop_top + HEIGHT))

    draw = ImageDraw.Draw(image)
    line = [
        (x - box_left, y - box_top)
        for x, y in (_lonlat_to_pixel(lat, lon, zoom) for lat, lon in points)
    ]
    if len(line) >= 2:
        draw.line(line, fill="#e03131", width=3, joint="curve")
        radius = 4
        for x, y in (line[0], line[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="#e03131")

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(cache_path, format="PNG")
    return cache_path.read_bytes()


def _fallback_png() -> bytes:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#e9ecef")
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
