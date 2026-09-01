"""Community routes: leden uploaden zelf routes, anderen stemmen erop.

Elk ingelogd (geverifieerd) lid mag een route aanleveren (GPX-upload), de
metadata invullen en op elkaars inzendingen stemmen. De aanbieder zelf (of
een admin) mag de inzending ook weer verwijderen
(`DELETE /api/community/routes/{id}`, hieronder). Een beheerder promoveert
een goede inzending naar het officiële routeboek
(`POST /api/admin/routes/{id}/promote`); eenmaal gepromoveerd is het een
gewone officiële route en loopt verwijderen voortaan via de admin-routes
(`DELETE /api/admin/routes/{id}`), niet meer via dit endpoint.

Community routes zijn gewone `Route`-rijen met `origin="community"`: ze
gebruiken daardoor automatisch alle bestaande route-functionaliteit
(detailpagina, kaart, GPX/TCX-download, waterpunten, reacties, waardering).
Alleen het overzicht (`/api/routes`) en dit overzicht (`/api/community/routes`)
splitsen op origin.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import Route, RouteOrigin, RouteUpvote, User
from app.route_import import RouteImportError, import_from_gpx_bytes
from app.routers.routes import get_route_or_404, to_detail, to_summary
from app.routes_common import slugify, unique_slug
from app.schemas import (
    CommunityRouteCreateIn,
    Message,
    RouteDetail,
    RouteImportPreview,
    RouteSummary,
    UpvoteOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/community", tags=["community"])

SORT_OPTIONS = {
    "upvotes": (Route.upvote_count.desc(), Route.created_at.desc()),
    "recent": (Route.created_at.desc(),),
    "name": (Route.name.asc(),),
}


@router.get("/routes", response_model=list[RouteSummary])
def list_community_routes(
    search: str | None = None,
    sort: str = Query(default="upvotes"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[RouteSummary]:
    if sort not in SORT_OPTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekende sortering.")

    stmt = select(Route).where(
        Route.origin == RouteOrigin.community, Route.is_active.is_(True)
    )
    if search:
        stmt = stmt.where(Route.name.ilike(f"%{search.strip()}%"))
    routes = db.scalars(stmt.order_by(*SORT_OPTIONS[sort])).all()

    my_upvotes = set(
        db.scalars(
            select(RouteUpvote.route_id).where(
                RouteUpvote.user_id == user.id,
                RouteUpvote.route_id.in_([r.id for r in routes]),
            )
        ).all()
    )
    return [
        to_summary(route, my_upvote=route.id in my_upvotes, viewer=user) for route in routes
    ]


@router.post("/routes/import", response_model=RouteImportPreview)
async def import_route(
    gpx: UploadFile = File(...),
    _: User = Depends(current_user),
) -> RouteImportPreview:
    try:
        raw = await gpx.read()
        name_guess = None
        if gpx.filename:
            name_guess = gpx.filename.rsplit(".", 1)[0].replace("_", " ").strip() or None
        result = import_from_gpx_bytes(raw, suggested_name=name_guess)
    except RouteImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return RouteImportPreview(
        name=result.name,
        distance_km=result.distance_km,
        elevation_m=result.elevation_m,
        coordinates=result.coordinates,
        wind_directions=result.wind_directions,
    )


@router.post("/routes", response_model=RouteDetail, status_code=status.HTTP_201_CREATED)
def create_community_route(
    payload: CommunityRouteCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RouteDetail:
    slug = unique_slug(db, slugify(payload.name))
    route = Route(
        slug=slug,
        name=payload.name.strip(),
        description_html=payload.description_html,
        distance_km=payload.distance_km,
        elevation_m=payload.elevation_m,
        route_type=payload.route_type,
        wind_directions=payload.wind_directions,
        # Een handmatig gekozen windrichting telt niet als "geschat"; is de
        # lijst leeg gelaten dan gebruiken we de schatting uit stap 1 wél,
        # maar die staat dan al in payload.wind_directions vanuit de preview.
        wind_estimated=False,
        categories=payload.categories,
        strava_url=payload.strava_url,
        coordinates=payload.coordinates,
        origin=RouteOrigin.community,
        created_by_id=user.id,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    return to_detail(route, viewer=user)


@router.delete("/routes/{route_id}", response_model=Message)
def delete_community_route(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Message:
    """De aanbieder (of een admin) mag de eigen community-inzending intrekken.

    Bewust een échte verwijdering (i.t.t. de admin-route, die standaard alleen
    archiveert): een community-route heeft geen historische waarde zoals een
    officiële route, en de aanbieder moet een verkeerd/dubbel geïmporteerde
    inzending gewoon kunnen laten verdwijnen. `Ride.route_id` staat op
    `ondelete=SET NULL`, dus bestaande ritten blijven bestaan (alleen de
    routekoppeling vervalt); reacties/waarderingen/upvotes cascaden mee weg.
    Eenmaal gepromoveerd (`origin=official`) kan dit endpoint niets meer:
    verwijderen loopt dan via de normale admin-routes.
    """
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )
    if route.origin != RouteOrigin.community:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deze route staat al in het officiële routeboek; verwijder 'm via het beheer.",
        )
    if route.created_by_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Je mag alleen je eigen community-routes verwijderen.",
        )

    media = get_settings().media_dir
    for relative in (route.gpx_file, route.tcx_file, route.map_file):
        if not relative:
            continue
        path = (media / relative).resolve()
        if path.is_relative_to(media.resolve()) and path.is_file():
            path.unlink(missing_ok=True)

    name = route.name
    db.delete(route)
    db.commit()
    logger.info("Community-route '%s' verwijderd door %s", name, user.email)
    return Message(detail=f"'{name}' is verwijderd.")


@router.post("/routes/{route_id}/upvote", response_model=UpvoteOut)
def upvote_route(
    route_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> UpvoteOut:
    route = get_route_or_404(db, route_id)
    existing = db.scalar(
        select(RouteUpvote).where(
            RouteUpvote.route_id == route.id, RouteUpvote.user_id == user.id
        )
    )
    if existing is None:
        db.add(RouteUpvote(route_id=route.id, user_id=user.id))
        route.upvote_count += 1
        db.commit()
    return UpvoteOut(upvote_count=route.upvote_count, my_upvote=True)


@router.delete("/routes/{route_id}/upvote", response_model=UpvoteOut)
def remove_upvote(
    route_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> UpvoteOut:
    route = get_route_or_404(db, route_id)
    existing = db.scalar(
        select(RouteUpvote).where(
            RouteUpvote.route_id == route.id, RouteUpvote.user_id == user.id
        )
    )
    if existing is not None:
        db.delete(existing)
        route.upvote_count = max(0, route.upvote_count - 1)
        db.commit()
    return UpvoteOut(upvote_count=route.upvote_count, my_upvote=False)
