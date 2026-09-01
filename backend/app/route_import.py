"""Importeren van een route uit een geüpload GPX-bestand.

Voor stap 1 van "Community routes": een lid uploadt een GPX-bestand. Er is
bewust geen ondersteuning voor het importeren via een Strava- of Komoot-link:
beide diensten tonen routegegevens alleen aan ingelogde gebruikers (Strava's
routepagina is een client-side gerenderde shell zonder embedded data, Komoot
blokkeert zowel de onofficiële API als tourpagina's met 403), dus een kale
link kan hier server-side niet worden gelezen. In plaats daarvan kan de
gebruiker in stap 2 optioneel een Strava-link toevoegen die als losse
referentie bij de route komt te staan (`Route.strava_url`).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.routes_common import track_stats
from app.water import gpx_service
from app.water.geo import estimate_wind_direction

MAX_IMPORT_BYTES = 20 * 1024 * 1024
MAX_POINTS = 20_000


class RouteImportError(ValueError):
    """De route kon niet worden geïmporteerd; bericht is bedoeld voor de gebruiker."""


@dataclass
class ImportedRoute:
    name: str | None
    distance_km: float
    elevation_m: int
    coordinates: list[list[float]]
    wind_directions: list[str]


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

    if len(points) > MAX_POINTS:
        raise RouteImportError(
            f"Deze track heeft {len(points)} punten; het maximum is {MAX_POINTS}."
        )

    name = (parsed.name or "").strip() or suggested_name
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
