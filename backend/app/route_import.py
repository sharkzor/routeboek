"""Importeren van een route uit een geüpload GPX-bestand of een URL.

Voor stap 1 van "Community routes": een lid levert een GPX aan, of plakt een
link. Een link wordt alleen geaccepteerd als de inhoud die eronder vandaan
komt zelf een geldig GPX-bestand is (bijvoorbeeld een "exporteer als GPX"-link
met deelToken van Komoot, of een andere gehoste .gpx). Strava en Komoot
hebben zelf geen publieke, aanmeldingsvrije JSON/GPX-API meer voor gewone
tour/route-pagina's, dus een kale strava.com/komoot.com link kan hier niet
automatisch worden gelezen; de gebruiker krijgt dan een duidelijke melding om
in plaats daarvan de GPX te exporteren en te uploaden.

Belangrijk: dit endpoint haalt een door de gebruiker opgegeven URL *server-
side* op. Zonder voorzorgen is dat een SSRF-risico (een kwaadwillende zou een
interne dienst als http://routeboek-db:5432 of een cloud-metadata-endpoint
kunnen laten aanroepen). `_validate_public_url` weigert daarom alles behalve
http(s) naar een publiek, niet-lokaal IP-adres, en elke redirect-hop wordt
opnieuw gevalideerd.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

from app.config import get_settings
from app.routes_common import track_stats
from app.water import gpx_service
from app.water.geo import estimate_wind_direction

logger = logging.getLogger(__name__)

MAX_IMPORT_BYTES = 20 * 1024 * 1024
MAX_POINTS = 20_000
FETCH_TIMEOUT = 10
MAX_REDIRECTS = 5


class RouteImportError(ValueError):
    """De route kon niet worden geïmporteerd; bericht is bedoeld voor de gebruiker."""


@dataclass
class ImportedRoute:
    name: str | None
    distance_km: float
    elevation_m: int
    coordinates: list[list[float]]
    wind_directions: list[str]


def _points_to_result(points, name: str | None) -> ImportedRoute:
    if len(points) > MAX_POINTS:
        raise RouteImportError(
            f"Deze track heeft {len(points)} punten; het maximum is {MAX_POINTS}."
        )
    distance_km, elevation_m = track_stats(points)
    coordinates = [[round(p.lat, 6), round(p.lon, 6)] for p in points]
    wind = estimate_wind_direction([(p.lat, p.lon) for p in points])
    return ImportedRoute(
        name=name,
        distance_km=distance_km,
        elevation_m=elevation_m,
        coordinates=coordinates,
        wind_directions=[wind] if wind else [],
    )


def import_from_gpx_bytes(raw: bytes, suggested_name: str | None) -> ImportedRoute:
    if not raw:
        raise RouteImportError("Het GPX-bestand is leeg.")
    if len(raw) > MAX_IMPORT_BYTES:
        raise RouteImportError(
            f"Het bestand is te groot (maximaal {MAX_IMPORT_BYTES // (1024 * 1024)} MB)."
        )
    try:
        parsed = gpx_service.parse_gpx(raw)
        points = gpx_service.extract_route_points(parsed)
    except gpx_service.GpxError as exc:
        raise RouteImportError(str(exc)) from exc

    name = (parsed.name or "").strip() or suggested_name
    return _points_to_result(points, name)


def _is_public_ip(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _assert_public_host(hostname: str) -> None:
    """Weiger interne/lokale doelen: bescherming tegen SSRF."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        raise RouteImportError(f"Kan '{hostname}' niet vinden.") from exc
    if not infos:
        raise RouteImportError(f"Kan '{hostname}' niet vinden.")
    for info in infos:
        ip = info[4][0]
        if not _is_public_ip(ip):
            raise RouteImportError(
                "Deze link wijst naar een niet-toegestaan adres."
            )


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise RouteImportError("Gebruik een http(s)-link.")
    if not parsed.hostname:
        raise RouteImportError("Ongeldige link.")
    _assert_public_host(parsed.hostname)


def _safe_fetch(url: str) -> bytes:
    """Haal een URL op met SSRF-bescherming, een grootte- en redirect-limiet."""
    settings = get_settings()
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        _validate_url(current)
        try:
            response = requests.get(
                current,
                headers={"User-Agent": settings.user_agent},
                timeout=FETCH_TIMEOUT,
                stream=True,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise RouteImportError(f"Ophalen van de link is mislukt: {exc}") from exc

        if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise RouteImportError("De link geeft een ongeldige doorverwijzing.")
            current = requests.compat.urljoin(current, location)
            continue

        if response.status_code != 200:
            response.close()
            raise RouteImportError(
                f"De link gaf een fout terug (HTTP {response.status_code})."
            )

        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in response.iter_content(64 * 1024):
                total += len(chunk)
                if total > MAX_IMPORT_BYTES:
                    raise RouteImportError(
                        f"Het bestand achter de link is te groot (maximaal "
                        f"{MAX_IMPORT_BYTES // (1024 * 1024)} MB)."
                    )
                chunks.append(chunk)
        finally:
            response.close()
        return b"".join(chunks)

    raise RouteImportError("Te veel doorverwijzingen bij het ophalen van de link.")


def import_from_url(url: str) -> ImportedRoute:
    url = url.strip()
    if not url:
        raise RouteImportError("Vul een link in.")
    raw = _safe_fetch(url)
    try:
        return import_from_gpx_bytes(raw, suggested_name=None)
    except RouteImportError as exc:
        logger.info("Route-import via URL mislukt voor %s: %s", url, exc)
        raise RouteImportError(
            "Kon geen route uit deze link halen. Strava en Komoot geven de "
            "route alleen aan ingelogde gebruikers, dus een kale link werkt "
            "hier niet. Exporteer de route in de app als GPX-bestand "
            "('Exporteren'/'Downloaden als GPX') en upload dat bestand hier."
        ) from exc
