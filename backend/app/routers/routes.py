"""Routeoverzicht, filters, detail en downloads.

Mediabestanden worden bewust via endpoints geserveerd en niet als statische map,
zodat ook GPX- en TCX-downloads alleen voor ingelogde gebruikers beschikbaar zijn.
"""

from __future__ import annotations

from datetime import date, time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import (
    RideType,
    Route,
    RouteCompletion,
    RouteFavorite,
    RouteOrigin,
    RouteRating,
    RouteType,
    RouteUpvote,
    User,
)
from app.route_thumbnail import render_route_thumbnail_png
from app.schemas import QuickstartOut, RouteDetail, RoutePage, RouteSummary
from app.services import weather as weather_service
from app.water.processing import build_gpx_from_coordinates

router = APIRouter(prefix="/api/routes", tags=["routes"])

SORT_OPTIONS = {
    "name": (Route.name.asc(),),
    "distance_asc": (Route.distance_km.asc().nullslast(),),
    "distance_desc": (Route.distance_km.desc().nullslast(),),
    "elevation_asc": (Route.elevation_m.asc().nullslast(),),
    "elevation_desc": (Route.elevation_m.desc().nullslast(),),
    "rating_desc": (Route.rating.desc().nullslast(), Route.name.asc()),
    "recent": (Route.created_at.desc(), Route.id.desc()),
    "upvotes": (Route.upvote_count.desc(), Route.created_at.desc()),
}


def media_url(route: Route, kind: str) -> str | None:
    if kind == "map" and (route.map_file or route.coordinates):
        return f"/api/routes/{route.id}/map"
    return None


def to_summary(
    route: Route,
    my_upvote: bool = False,
    viewer: User | None = None,
    is_favorite: bool = False,
    is_ridden: bool = False,
) -> RouteSummary:
    # Lazy load van created_by kost alleen een extra query bij community routes
    # (klein aantal); voor de officiële lijst (verreweg de meeste rijen) wordt
    # dit nooit aangeraakt.
    submitted_by = None
    if route.origin == RouteOrigin.community and route.created_by:
        submitted_by = route.created_by.display_name
    can_delete = (
        route.origin == RouteOrigin.community
        and viewer is not None
        and (route.created_by_id == viewer.id or viewer.is_admin)
    )
    return RouteSummary(
        id=route.id,
        slug=route.slug,
        name=route.name,
        distance_km=route.distance_km,
        elevation_m=route.elevation_m,
        route_type=route.route_type,
        wind_directions=route.wind_directions or [],
        wind_estimated=route.wind_estimated,
        categories=route.categories or [],
        rating=route.rating,
        rating_count=route.rating_count,
        map_url=media_url(route, "map"),
        has_gpx=bool(route.gpx_file) or bool(route.coordinates),
        has_tcx=bool(route.tcx_file),
        is_active=route.is_active,
        origin=route.origin.value,
        upvote_count=route.upvote_count,
        submitted_by=submitted_by,
        my_upvote=my_upvote,
        can_delete=can_delete,
        is_favorite=is_favorite,
        is_ridden=is_ridden,
    )


def marked_route_ids(
    db: Session, user_id: int, route_ids: list[int]
) -> tuple[set[int], set[int]]:
    """Favoriet- en gereden-markeringen van één lid voor een pagina routes.

    In één query per soort, zodat een overzicht van 24 kaarten geen 48 losse
    queries veroorzaakt.
    """
    if not route_ids:
        return set(), set()
    favorites = set(
        db.scalars(
            select(RouteFavorite.route_id).where(
                RouteFavorite.user_id == user_id,
                RouteFavorite.route_id.in_(route_ids),
            )
        ).all()
    )
    ridden = set(
        db.scalars(
            select(RouteCompletion.route_id).where(
                RouteCompletion.user_id == user_id,
                RouteCompletion.route_id.in_(route_ids),
            )
        ).all()
    )
    return favorites, ridden


def apply_route_filters(
    stmt: Select,
    search: str | None,
    km_min: float | None,
    km_max: float | None,
    wind: list[str] | None,
    route_type: RouteType | None,
    min_rating: float | None,
    categories: list[str] | None,
    origin: RouteOrigin = RouteOrigin.official,
    viewer_id: int | None = None,
    favorite: bool | None = None,
    ridden: bool | None = None,
) -> Select:
    # Het officiële routeoverzicht toont bewust nooit community-inzendingen en
    # ook geen event-routes; die hebben hun eigen pagina respectievelijk horen
    # alleen bij één event.
    stmt = stmt.where(Route.is_active.is_(True), Route.origin == origin)

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Route.name.ilike(pattern), Route.description_html.ilike(pattern))
        )
    if km_min is not None:
        stmt = stmt.where(Route.distance_km >= km_min)
    if km_max is not None:
        stmt = stmt.where(Route.distance_km <= km_max)
    if wind:
        # Route is geschikt als minstens een van de gekozen windrichtingen past.
        stmt = stmt.where(Route.wind_directions.overlap([w.upper() for w in wind]))
    if route_type is not None:
        stmt = stmt.where(Route.route_type == route_type)
    if min_rating is not None:
        stmt = stmt.where(Route.rating >= min_rating)
    if categories:
        stmt = stmt.where(Route.categories.overlap([c.lower() for c in categories]))
    if viewer_id is not None and favorite is not None:
        exists = (
            select(RouteFavorite.id)
            .where(
                RouteFavorite.route_id == Route.id,
                RouteFavorite.user_id == viewer_id,
            )
            .exists()
        )
        stmt = stmt.where(exists if favorite else ~exists)
    if viewer_id is not None and ridden is not None:
        exists = (
            select(RouteCompletion.id)
            .where(
                RouteCompletion.route_id == Route.id,
                RouteCompletion.user_id == viewer_id,
            )
            .exists()
        )
        stmt = stmt.where(exists if ridden else ~exists)
    return stmt


@router.get("", response_model=RoutePage)
def list_routes(
    search: str | None = None,
    km_min: float | None = Query(default=None, ge=0),
    km_max: float | None = Query(default=None, ge=0),
    wind: list[str] | None = Query(default=None),
    route_type: RouteType | None = None,
    min_rating: float | None = Query(default=None, ge=0, le=5),
    category: list[str] | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    ridden: bool | None = Query(default=None),
    sort: str = Query(default="distance_asc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RoutePage:
    if sort not in SORT_OPTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekende sortering."
        )

    stmt = apply_route_filters(
        select(Route),
        search,
        km_min,
        km_max,
        wind,
        route_type,
        min_rating,
        category,
        viewer_id=user.id,
        favorite=favorite,
        ridden=ridden,
    )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(*SORT_OPTIONS[sort])
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    favorites, ridden_ids = marked_route_ids(db, user.id, [r.id for r in rows])

    # Grenzen voor de kilometerslider: over alle actieve routes, niet de selectie.
    bounds = db.execute(
        select(func.min(Route.distance_km), func.max(Route.distance_km)).where(
            Route.is_active.is_(True)
        )
    ).one()

    return RoutePage(
        items=[
            to_summary(
                r,
                viewer=user,
                is_favorite=r.id in favorites,
                is_ridden=r.id in ridden_ids,
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
        distance_min=bounds[0],
        distance_max=bounds[1],
    )


# ----------------------------------------------------------------- quickstart

#: Afstandsgrenzen voor Quick start-suggesties: net iets meer dan een clubmoment
#: maar niet zo ver dat het geen "instapper" meer is.
QUICKSTART_MIN_KM = 50
QUICKSTART_MAX_KM = 110

#: Rittype en routetype delen dezelfde onderliggende indeling
#: (weg/weg met gravel/gravel); zie ook RIDE_TYPE_FROM_ROUTE_TYPE in
#: frontend/src/pages/RideFormPage.tsx, waarvan dit de omgekeerde mapping is.
QUICKSTART_ROUTE_TYPE = {
    RideType.race: RouteType.road,
    RideType.race_gravel: RouteType.road_gravel,
    RideType.gravel: RouteType.gravel,
}

_reference_location_cache: tuple[float, float] | None = None


def _club_reference_location(db: Session) -> tuple[float, float] | None:
    """Middelpunt van de officiële routes, als locatie voor de
    windrichting-schatting bij Quick start.

    Er is geen apart opgeslagen "clubhuis"-coördinaat; het gemiddelde
    startpunt van de officiële routes ligt vanzelf midden in het gebied waar
    de club rijdt en is dus een robuuste, datagedreven vervanger. Wordt
    éénmalig per procesleven berekend (de officiële routelijst verandert
    zelden) i.p.v. bij elke Quick start-aanvraag opnieuw.
    """
    global _reference_location_cache
    if _reference_location_cache is not None:
        return _reference_location_cache
    rows = db.scalars(
        select(Route.coordinates).where(
            Route.origin == RouteOrigin.official,
            Route.is_active.is_(True),
        )
    ).all()
    points = [tuple(c[0]) for c in rows if c]
    if not points:
        return None
    lat = sum(p[0] for p in points) / len(points)
    lon = sum(p[1] for p in points) / len(points)
    _reference_location_cache = (lat, lon)
    return _reference_location_cache


@router.get("/quickstart", response_model=QuickstartOut)
def quickstart_routes(
    ride_date: date = Query(...),
    ride_time: time = Query(...),
    ride_type: RideType = Query(default=RideType.race),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> QuickstartOut:
    """Top 4 routesuggesties voor Quick start: op basis van het rittype, de
    verwachte windrichting op het gekozen moment en (bij voorkeur) de eigen
    favorieten van het lid, met een afstand tussen 50 en 110 km.

    Favoriet + windrichting-match gaat voor; is dat er te weinig, dan vult de
    hoogste beoordeling de resterende plekken aan (zie `_sort_key` hieronder)
    — één sortering handelt dus zowel het "genoeg eigen favorieten"- als het
    "te weinig favorieten"-geval af.
    """
    route_type = QUICKSTART_ROUTE_TYPE[ride_type]

    wind_direction: str | None = None
    location = _club_reference_location(db)
    if location is not None:
        hourly = weather_service.get_hourly_forecast(location[0], location[1], ride_date)
        if hourly:
            hour = weather_service.nearest_hour(hourly, ride_time)
            if hour is not None:
                wind_direction = weather_service.compass4_from_degrees(
                    hour["wind_direction_deg"]
                )

    candidates = db.scalars(
        select(Route).where(
            Route.is_active.is_(True),
            Route.origin.in_([RouteOrigin.official, RouteOrigin.community]),
            Route.route_type == route_type,
            Route.distance_km.is_not(None),
            Route.distance_km >= QUICKSTART_MIN_KM,
            Route.distance_km <= QUICKSTART_MAX_KM,
        )
    ).all()

    candidate_ids = [r.id for r in candidates]
    favorite_ids, _ = marked_route_ids(db, user.id, candidate_ids)

    def _sort_key(route: Route) -> tuple[int, int, float, int]:
        is_favorite = route.id in favorite_ids
        wind_match = wind_direction is not None and wind_direction in (
            route.wind_directions or []
        )
        return (
            0 if is_favorite else 1,
            0 if wind_match else 1,
            -(route.rating or 0),
            -(route.rating_count or 0),
        )

    top = sorted(candidates, key=_sort_key)[:4]
    top_ids = [r.id for r in top]
    my_upvotes = set(
        db.scalars(
            select(RouteUpvote.route_id).where(
                RouteUpvote.user_id == user.id,
                RouteUpvote.route_id.in_(top_ids),
            )
        ).all()
    )
    favorites, ridden_ids = marked_route_ids(db, user.id, top_ids)

    return QuickstartOut(
        wind_direction=wind_direction,
        routes=[
            to_summary(
                r,
                my_upvote=r.id in my_upvotes,
                viewer=user,
                is_favorite=r.id in favorites,
                is_ridden=r.id in ridden_ids,
            )
            for r in top
        ],
    )


def to_detail(
    route: Route,
    my_rating: int | None = None,
    my_upvote: bool = False,
    viewer: User | None = None,
    is_favorite: bool = False,
    is_ridden: bool = False,
) -> RouteDetail:
    summary = to_summary(
        route,
        my_upvote=my_upvote,
        viewer=viewer,
        is_favorite=is_favorite,
        is_ridden=is_ridden,
    )
    return RouteDetail(
        **summary.model_dump(),
        description_html=route.description_html,
        strava_url=route.strava_url,
        komoot_url=route.komoot_url,
        coordinates=route.coordinates or [],
        created_at=route.created_at,
        my_rating=my_rating,
    )


def get_route_or_404(db: Session, route_id: int) -> Route:
    route = db.get(Route, route_id)
    if route is None or not route.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )
    return route


@router.get("/{route_id}", response_model=RouteDetail)
def route_detail(
    route_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> RouteDetail:
    route = get_route_or_404(db, route_id)
    existing = db.scalar(
        select(RouteRating).where(
            RouteRating.route_id == route.id, RouteRating.user_id == user.id
        )
    )
    my_upvote = False
    if route.origin == RouteOrigin.community:
        my_upvote = (
            db.scalar(
                select(RouteUpvote.id).where(
                    RouteUpvote.route_id == route.id, RouteUpvote.user_id == user.id
                )
            )
            is not None
        )
    favorites, ridden_ids = marked_route_ids(db, user.id, [route.id])
    return to_detail(
        route,
        my_rating=existing.value if existing else None,
        my_upvote=my_upvote,
        viewer=user,
        is_favorite=route.id in favorites,
        is_ridden=route.id in ridden_ids,
    )


def _media_path(relative: str | None) -> Path | None:
    """Los een pad in de mediamap op en weiger alles wat er buiten wijst."""
    if not relative:
        return None
    root = get_settings().media_dir.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


@router.get("/{route_id}/map")
def route_map(
    route_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    route = get_route_or_404(db, route_id)
    path = _media_path(route.map_file)
    if path is not None:
        return FileResponse(
            path, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"}
        )
    if route.coordinates:
        png = render_route_thumbnail_png(route.coordinates)
        return Response(
            content=png,
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=86400"},
        )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Geen kaartafbeelding."
    )


def _download_name(route: Route, extension: str) -> str:
    safe = "".join(c if (c.isalnum() or c in "-_ ") else "-" for c in route.name).strip()
    return f"{safe or route.slug}.{extension}"


@router.get("/{route_id}/gpx")
def download_gpx(
    route_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    route = get_route_or_404(db, route_id)
    path = _media_path(route.gpx_file)
    filename = _download_name(route, "gpx")
    if path is not None:
        return FileResponse(path, media_type="application/gpx+xml", filename=filename)

    # Terugval voor routes waarvan het originele bestand ontbreekt op de bronsite.
    if not route.coordinates:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Geen GPX beschikbaar."
        )
    xml = build_gpx_from_coordinates(route.name, route.coordinates)
    return Response(
        xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{route_id}/tcx")
def download_tcx(
    route_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    route = get_route_or_404(db, route_id)
    path = _media_path(route.tcx_file)
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Geen TCX beschikbaar."
        )
    return FileResponse(
        path,
        media_type="application/vnd.garmin.tcx+xml",
        filename=_download_name(route, "tcx"),
    )
