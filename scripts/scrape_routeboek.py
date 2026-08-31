"""Haalt alle routes van de Maximus Stampers clubpagina op routeboek.cc op.

De bronsite is een ASP.NET WebForms applicatie. De routelijst zelf staat volledig
in de HTML van de clubpagina. Eigenschappen zoals windrichting staan niet in de
HTML, maar zijn wel af te leiden door het filterformulier via een postback te
posten en te kijken welke routes overblijven.

Resultaat:
  data/seed/routes.json   metadata van alle routes
  data/media/gpx|tcx|maps media bestanden
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://routeboek.cc"
CLUB_URL = f"{BASE}/club/stampers"
PREFIX = "ctl00$ctl00$ctl00$cpContentContainer$cpContentContainer$cpContentContainer$"

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "data" / "seed"
MEDIA_DIR = ROOT / "data" / "media"

WIND_FIELDS = {"N": "cbNoord", "O": "cbOost", "Z": "cbZuid", "W": "cbWest"}
CATEGORY_FIELDS = {
    "beginners": "cbBeginners",
    "high_pace": "cbHighPace",
    "tourist": "cbTourist",
}
ROUTE_TYPES = {"0": "road", "1": "road_gravel", "2": "gravel"}

ROUTE_ITEM_RE = re.compile(
    r'route_(?P<id>\d+)"\s+class="routeitem">(?P<body>.*?)(?=<div id="[^"]*route_\d+"\s+class="routeitem">|\Z)',
    re.S,
)
COORD_RE = re.compile(r"\{\s*lat:\s*(-?\d+(?:\.\d+)?),\s*lng:\s*(-?\d+(?:\.\d+)?)\s*\}")


NUMBER_RE = re.compile(r"(\d+(?:[.,]\d+)?)")


def nl_float(value: str) -> float | None:
    """Eerste getal uit een stukje tekst, met Nederlandse komma. '... 42,6 km' -> 42.6"""
    match = NUMBER_RE.search(value or "")
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


class Scraper:
    def __init__(self, delay: float = 0.3):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = (
            "Mozilla/5.0 (X11; Linux x86_64) routeboek-migratie/1.0"
        )
        self.delay = delay

    # ------------------------------------------------------------------ http

    def get(self, url: str) -> str:
        for attempt in range(4):
            try:
                resp = self.session.get(url, timeout=60)
                resp.raise_for_status()
                return resp.text
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        raise RuntimeError("unreachable")

    @staticmethod
    def _hidden(html: str, name: str) -> str:
        match = re.search(rf'id="{name}" value="([^"]*)"', html)
        return match.group(1) if match else ""

    def filtered_route_ids(self, **filters: str) -> set[int]:
        """Post het filterformulier en geeft de overgebleven route-ids terug."""
        page = self.get(CLUB_URL)
        data = {
            "__EVENTTARGET": PREFIX + "lnkSubmit",
            "__EVENTARGUMENT": "",
            "__VIEWSTATE": self._hidden(page, "__VIEWSTATE"),
            "__VIEWSTATEGENERATOR": self._hidden(page, "__VIEWSTATEGENERATOR"),
            "__EVENTVALIDATION": self._hidden(page, "__EVENTVALIDATION"),
            PREFIX + "ddlSorting": "Kasc",
            PREFIX + "txtSearch": "",
            PREFIX + "txtKmMin": "0",
            PREFIX + "txtKmMax": "999",
            PREFIX + "rblRouteType": "99",
            PREFIX + "rblBeoordeling": "0",
        }
        for key, value in filters.items():
            data[PREFIX + key] = value

        resp = self.session.post(CLUB_URL, data=data, timeout=60)
        resp.raise_for_status()
        time.sleep(self.delay)
        return {int(m.group("id")) for m in ROUTE_ITEM_RE.finditer(resp.text)}

    # ------------------------------------------------------------- overzicht

    def parse_overview(self, html: str) -> dict[int, dict]:
        routes: dict[int, dict] = {}
        for match in ROUTE_ITEM_RE.finditer(html):
            route_id = int(match.group("id"))
            frag = BeautifulSoup(match.group("body"), "lxml")

            link = frag.find("a", href=True)
            if link is None:
                continue
            slug = link["href"].rstrip("/").rsplit("/", 1)[-1]

            img = frag.find("img", class_="map")
            map_src = img["src"].split("?")[0].rsplit("/", 1)[-1] if img else None

            bike = frag.find("span", class_="bikeicon")
            bike_classes = [c for c in (bike.get("class") if bike else []) if c != "bikeicon"]

            distance = elevation = None
            for span in frag.find_all("span", class_="dataitem"):
                classes = span.get("class", [])
                # De span bevat ook een icoon-span met tekst; alleen eigen tekst tellen.
                text = " ".join(
                    t for t in span.find_all(string=True, recursive=True)
                    if t.parent.name != "span" or "material-symbols-outlined" not in (t.parent.get("class") or [])
                )
                if "distance" in classes:
                    distance = nl_float(text)
                elif "hoogte" in classes:
                    elevation = nl_float(text)

            stars = frag.find("div", class_="stars")
            rating = None
            if stars and stars.has_attr("style"):
                width = re.search(r"width:\s*(\d+)px", stars["style"])
                if width:
                    rating = round(int(width.group(1)) / 20, 2)

            routes[route_id] = {
                "source_id": route_id,
                "slug": slug,
                "name": link.get_text(strip=True),
                "distance_km": distance,
                "elevation_m": int(elevation) if elevation is not None else None,
                "rating": rating,
                "map_image": map_src,
                "bike_icon": bike_classes[0] if bike_classes else None,
                "wind_directions": [],
                "categories": [],
                "route_type": None,
            }
        return routes

    # --------------------------------------------------------------- details

    def parse_detail(self, slug: str) -> dict:
        html = self.get(f"{CLUB_URL}/route/{slug}")
        soup = BeautifulSoup(html, "lxml")

        def by_suffix(suffix: str):
            return soup.find(id=lambda v: bool(v) and v.endswith(suffix))

        description_el = by_suffix("_lblDescription")
        description = ""
        if description_el:
            description = description_el.decode_contents().strip()

        def href_of(suffix: str) -> str | None:
            el = by_suffix(suffix)
            if el and el.has_attr("href"):
                return urljoin(f"{CLUB_URL}/route/{slug}", el["href"])
            return None

        coords = [
            [round(float(lat), 6), round(float(lng), 6)]
            for lat, lng in COORD_RE.findall(html)
        ]

        detail = {
            "description_html": description,
            "strava_url": href_of("_lnkStrava"),
            "gpx_url": href_of("_lnkGPX"),
            "tcx_url": href_of("_lnkTCX"),
            "coordinates": coords,
        }

        votes = by_suffix("_lblNumberOfVotes")
        if votes:
            number = re.search(r"(\d+)", votes.get_text())
            detail["rating_count"] = int(number.group(1)) if number else 0

        time.sleep(self.delay)
        return detail

    # ----------------------------------------------------------------- media

    def download(self, url: str, target: Path) -> bool:
        if target.exists() and target.stat().st_size > 0:
            return True
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            resp = self.session.get(url, timeout=120)
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"  ! download mislukt {url}: {exc}", file=sys.stderr)
            return False
        target.write_bytes(resp.content)
        return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-media", action="store_true")
    parser.add_argument("--delay", type=float, default=0.3)
    args = parser.parse_args()

    scraper = Scraper(delay=args.delay)
    SEED_DIR.mkdir(parents=True, exist_ok=True)

    print("Overzichtspagina ophalen ...")
    routes = scraper.parse_overview(scraper.get(CLUB_URL))
    print(f"  {len(routes)} routes gevonden")

    print("Windrichtingen afleiden via filter-postbacks ...")
    for code, field in WIND_FIELDS.items():
        ids = scraper.filtered_route_ids(**{field: "on"})
        for route_id in ids & routes.keys():
            routes[route_id]["wind_directions"].append(code)
        print(f"  wind {code}: {len(ids)}")

    print("Categorieen afleiden ...")
    for name, field in CATEGORY_FIELDS.items():
        ids = scraper.filtered_route_ids(**{field: "on"})
        for route_id in ids & routes.keys():
            routes[route_id]["categories"].append(name)
        print(f"  {name}: {len(ids)}")

    print("Routetypes afleiden ...")
    for value, name in ROUTE_TYPES.items():
        ids = scraper.filtered_route_ids(rblRouteType=value)
        for route_id in ids & routes.keys():
            routes[route_id]["route_type"] = name
        print(f"  {name}: {len(ids)}")

    ordered = sorted(routes.values(), key=lambda r: r["source_id"])

    print(f"Detailpagina's ophalen ({len(ordered)}) ...")
    with ThreadPoolExecutor(max_workers=4) as pool:
        details = list(pool.map(lambda r: scraper.parse_detail(r["slug"]), ordered))
    for route, detail in zip(ordered, details):
        route.update(detail)
        print(f"  {route['slug']}: {len(detail['coordinates'])} punten")

    if not args.skip_media:
        print("Media downloaden ...")

        def fetch(route: dict) -> None:
            slug = route["slug"]
            for kind, key in (("gpx", "gpx_url"), ("tcx", "tcx_url")):
                url = route.get(key)
                if not url:
                    continue
                target = MEDIA_DIR / kind / f"{slug}.{kind}"
                if scraper.download(url, target):
                    route[f"{kind}_file"] = f"{kind}/{slug}.{kind}"
                    route[f"{kind}_original_name"] = unquote(url.rsplit("/", 1)[-1])
            if route.get("map_image"):
                url = f"{BASE}/media/routes/{route['map_image']}"
                target = MEDIA_DIR / "maps" / f"{slug}.png"
                if scraper.download(url, target):
                    route["map_file"] = f"maps/{slug}.png"

        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(fetch, ordered))

    out = SEED_DIR / "routes.json"
    out.write_text(
        json.dumps({"club": "Maximus Stampers", "routes": ordered}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"Klaar: {len(ordered)} routes -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
