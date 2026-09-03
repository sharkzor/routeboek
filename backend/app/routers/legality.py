"""Een route controleren op paden waar fietsen niet (zonder meer) mag.

De controle draait op de lokale wegenkaart en duurt nog een halve seconde tot
enkele seconden bij de langste routes. Dat past ruim binnen één verzoek, maar
de opzet met een achtergrondtaak (`POST` start, de frontend polt met `GET`)
blijft staan: hij kost weinig, houdt de langste routes buiten de time-out van
de reverse proxy, en levert meteen de voortgangsmelding op die de gebruiker
toch al te zien krijgt.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.routers.routes import _media_path, get_route_or_404
from app.schemas import LegalityReportOut, LegalitySegmentOut, LegalityStatusOut
from app.services import legality, osm_index
from app.water.gpx_service import GpxError, extract_route_points, parse_gpx

router = APIRouter(prefix="/api/routes", tags=["legality"])


def _route_points(db: Session, route_id: int) -> list[tuple[float, float]]:
    """De fijnste beschikbare geometrie: liever de GPX dan de opgeslagen punten."""
    route = get_route_or_404(db, route_id)
    path = _media_path(route.gpx_file)
    if path is not None:
        try:
            points = extract_route_points(parse_gpx(path.read_bytes()))
        except GpxError:
            points = []
        if len(points) >= 2:
            return [(p.lat, p.lon) for p in points]
    if route.coordinates and len(route.coordinates) >= 2:
        return [(float(c[0]), float(c[1])) for c in route.coordinates]
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Voor deze route is geen geometrie beschikbaar.",
    )


def _to_out(report: legality.Report) -> LegalityReportOut:
    return LegalityReportOut(
        total_distance_km=report.total_distance_km,
        forbidden_count=report.forbidden_count,
        warning_count=report.warning_count,
        checked_at=datetime.fromtimestamp(report.checked_at, tz=timezone.utc),
        source=report.source,
        segments=[
            LegalitySegmentOut(
                severity=s.severity,
                code=s.code,
                label=s.label,
                way_id=s.way_id,
                way_name=s.way_name,
                highway=s.highway,
                start_km=s.start_km,
                end_km=s.end_km,
                length_m=s.length_m,
                coordinates=[[lat, lon] for lat, lon in s.coordinates],
            )
            for s in report.segments
        ],
    )


def _error_text(detail: str | None) -> str:
    """Vertaal een storing naar iets waar de gebruiker wat mee kan."""
    if not osm_index.status().available:
        return (
            "De wegenkaart is nog niet ingeladen, dus deze controle kan nog niet "
            "worden uitgevoerd. Een beheerder kan de kaart ophalen via Beheer."
        )
    return (
        "De controle is niet gelukt. Probeer het opnieuw; blijft het misgaan, "
        "meld het dan bij een beheerder."
    )


def _status(key: str) -> LegalityStatusOut:
    job = legality.get_job(key)
    if job is not None and job.status == "running":
        return LegalityStatusOut(
            status="running", progress=job.progress, message=job.message
        )
    if job is not None and job.status == "error":
        return LegalityStatusOut(
            status="error",
            progress=job.progress,
            error=_error_text(job.error),
        )
    report = legality.load_cached(key)
    if report is not None:
        return LegalityStatusOut(
            status="done", progress=1.0, report=_to_out(report)
        )
    return LegalityStatusOut(status="idle")


@router.post("/{route_id}/legality", response_model=LegalityStatusOut)
def start_check(
    route_id: int,
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> LegalityStatusOut:
    points = _route_points(db, route_id)
    key = legality.coordinates_key(points)
    if not refresh:
        current = _status(key)
        if current.status in ("done", "running"):
            return current
    legality.start(key, points)
    return _status(key)


@router.get("/{route_id}/legality", response_model=LegalityStatusOut)
def check_status(
    route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> LegalityStatusOut:
    points = _route_points(db, route_id)
    return _status(legality.coordinates_key(points))
