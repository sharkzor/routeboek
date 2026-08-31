"""Orkestratie: van een route naar een GPX met drinkwaterpunten.

Overgenomen uit de gpx-waterpunten applicatie en aangepast zodat de bron een
route uit het routeboek is in plaats van een upload.

Alle routes van de club liggen in Nederland, dus is drinkwaterpunten.nl de
enige bron; er is geen OSM/Overpass-alternatief (meer) nodig.
"""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path

from app.config import get_settings
from app.water import gpx_service, route_service, waterpoints_nl
from app.water.types import RouteStats, WaterPoint

logger = logging.getLogger(__name__)


class WaterError(RuntimeError):
    """Waterpunten konden niet worden bepaald."""


def output_path(job_id: str) -> Path:
    return get_settings().tmp_dir / f"{job_id}.gpx"


def cleanup_jobs(max_age_seconds: int = 6 * 3600) -> None:
    """Ruim tijdelijke downloads op die niemand meer ophaalt."""
    settings = get_settings()
    settings.ensure_dirs()
    cutoff = time.time() - max_age_seconds
    for path in settings.tmp_dir.glob("*.gpx"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            logger.debug("Kon %s niet opruimen", path)


def safe_filename(name: str, suffix: str = "-water") -> str:
    """Maak een veilige downloadnaam van een routenaam."""
    stem = Path(name or "route").stem or "route"
    safe = "".join(c if (c.isalnum() or c in "-_ ") else "-" for c in stem).strip()
    safe = "-".join(filter(None, safe.replace(" ", "-").split("-")))[:80]
    return f"{safe or 'route'}{suffix}.gpx"


def add_water_points(
    raw_gpx: bytes,
    route_name: str,
    radius_m: int | None = None,
) -> tuple[str, str, str, RouteStats, list[WaterPoint]]:
    """Voeg drinkwaterpunten toe aan een GPX.

    Geeft (job_id, bestandsnaam, bron, statistiek, punten).
    """
    settings = get_settings()
    settings.ensure_dirs()
    radius = radius_m or settings.default_radius_m

    gpx = gpx_service.parse_gpx(raw_gpx)
    route_points = gpx_service.extract_route_points(gpx)
    coords = [(p.lat, p.lon) for p in route_points]
    logger.info(
        "Route '%s': %d punten, radius=%d m",
        route_name,
        len(coords),
        radius,
    )

    try:
        candidates = waterpoints_nl.load_water_points_near(coords, radius + 1000)
    except Exception as exc:
        raise WaterError(f"Drinkwaterpunten ophalen mislukt: {exc}") from exc

    index = route_service.RouteIndex(route_points)
    matched = route_service.attach_to_route(index, candidates, radius)
    matched = route_service.deduplicate(matched, index.projection)

    has_elevation = any(p.ele is not None for p in route_points)
    stats = route_service.build_stats(index, matched, has_elevation)

    job_id = uuid.uuid4().hex
    output_path(job_id).write_text(
        gpx_service.build_output_gpx(gpx, matched), encoding="utf-8"
    )
    cleanup_jobs()

    return job_id, safe_filename(route_name), waterpoints_nl.SOURCE_NAME, stats, matched


def build_gpx_from_coordinates(name: str, coordinates: list[list[float]]) -> str:
    """Maak een GPX-track uit opgeslagen coordinaten.

    Nodig voor routes waarvan het originele GPX-bestand ontbreekt.
    """
    import gpxpy.gpx

    gpx = gpxpy.gpx.GPX()
    gpx.creator = "routeboek-stampers"
    gpx.name = name
    track = gpxpy.gpx.GPXTrack(name=name)
    segment = gpxpy.gpx.GPXTrackSegment()
    segment.points = [
        gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon) for lat, lon in coordinates
    ]
    track.segments.append(segment)
    gpx.tracks.append(track)
    return gpx.to_xml(version="1.1")
