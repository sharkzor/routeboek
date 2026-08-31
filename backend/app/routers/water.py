"""Drinkwaterpunten toevoegen aan de GPX van een route.

De zware verwerking (Overpass, drinkwaterpunten.nl, shapely) is blokkerende
code; de endpoints zijn daarom synchroon en draaien in de threadpool van FastAPI.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import User
from app.routers.routes import _media_path, get_route_or_404
from app.schemas import WaterPointOut, WaterResult, WaterStats
from app.water import processing
from app.water.gpx_service import GpxError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/water", tags=["water"])


@router.post("/routes/{route_id}", response_model=WaterResult)
def add_water_points(
    route_id: int,
    radius_m: int = Query(default=0, ge=0, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> WaterResult:
    settings = get_settings()
    route = get_route_or_404(db, route_id)

    path = _media_path(route.gpx_file)
    if path is not None:
        raw = path.read_bytes()
    elif route.coordinates:
        raw = processing.build_gpx_from_coordinates(
            route.name, route.coordinates
        ).encode("utf-8")
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voor deze route is geen GPX beschikbaar.",
        )

    try:
        job_id, filename, used_source, stats, points = processing.add_water_points(
            raw,
            route.name,
            radius_m=radius_m or settings.default_radius_m,
        )
    except GpxError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except processing.WaterError as exc:
        logger.warning("Waterpunten voor route %s mislukt: %s", route.slug, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="De drinkwaterbron is nu niet bereikbaar. Probeer het later opnieuw.",
        ) from exc

    return WaterResult(
        job_id=job_id,
        filename=filename,
        source=used_source,
        radius_m=radius_m or settings.default_radius_m,
        stats=WaterStats(
            total_distance_km=stats.total_distance_km,
            water_point_count=stats.water_point_count,
            average_gap_km=stats.average_gap_km,
            longest_gap_km=stats.longest_gap_km,
            longest_gap_start_km=stats.longest_gap_start_km,
            warning=stats.warning,
        ),
        water_points=[
            WaterPointOut(
                lat=p.lat,
                lon=p.lon,
                name=p.name,
                operator=p.operator,
                opening_hours=p.opening_hours,
                website=p.website,
                source=p.source,
                distance_to_route_m=p.distance_to_route_m,
                along_route_km=p.along_route_km,
            )
            for p in points
        ],
    )


@router.get("/download/{job_id}")
def download_result(
    job_id: str,
    filename: str = Query(default="route-water.gpx"),
    _: User = Depends(current_user),
):
    if not job_id.isalnum() or len(job_id) != 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Ongeldig job-id."
        )
    path = processing.output_path(job_id)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dit bestand is verlopen. Genereer het opnieuw.",
        )
    return FileResponse(
        path,
        media_type="application/gpx+xml",
        filename=processing.safe_filename(filename, suffix=""),
    )
