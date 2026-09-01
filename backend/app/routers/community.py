"""Community routes: leden uploaden zelf routes, anderen stemmen erop.

Elk ingelogd (geverifieerd) lid mag een route aanleveren (GPX-upload), de
metadata invullen en op elkaars inzendingen stemmen. Een beheerder promoveert
een goede inzending naar het officiële routeboek
(`POST /api/admin/routes/{id}/promote`) of verwijdert 'm via de bestaande
admin-routes (dezelfde tabel, dus dezelfde endpoints).

Community routes zijn gewone `Route`-rijen met `origin="community"`: ze
gebruiken daardoor automatisch alle bestaande route-functionaliteit
(detailpagina, kaart, GPX/TCX-download, waterpunten, reacties, waardering).
Alleen het overzicht (`/api/routes`) en dit overzicht (`/api/community/routes`)
splitsen op origin.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import Route, RouteOrigin, RouteUpvote, User
from app.route_import import RouteImportError, import_from_gpx_bytes
from app.routers.routes import get_route_or_404, to_detail, to_summary
from app.routes_common import slugify, unique_slug
from app.schemas import (
    CommunityRouteCreateIn,
    RouteDetail,
    RouteImportPreview,
    RouteSummary,
    UpvoteOut,
)

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
    return [to_summary(route, my_upvote=route.id in my_upvotes) for route in routes]


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
    return to_detail(route)


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
