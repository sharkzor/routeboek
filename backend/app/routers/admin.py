"""Beheerfuncties: routes toevoegen/verwijderen en gebruikers beheren."""

from __future__ import annotations

import logging
import re
import unicodedata

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_admin
from app.models import Route, RouteType, User, utcnow
from app.routers.routes import to_summary
from app.schemas import (
    AdminUserUpdateIn,
    Message,
    RouteCreateIn,
    RouteSummary,
    RouteUpdateIn,
    UserOut,
)
from app.security import revoke_all_sessions
from app.water import gpx_service
from app.water.geo import haversine_m

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:150] or "route"


def unique_slug(db: Session, base: str) -> str:
    slug = base
    counter = 2
    while db.scalar(select(Route.id).where(Route.slug == slug)) is not None:
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def _track_stats(points) -> tuple[float, int]:
    """Afstand in km (great-circle) en totale stijging in meters."""
    distance = 0.0
    for a, b in zip(points, points[1:]):
        distance += haversine_m(a.lat, a.lon, b.lat, b.lon)

    elevation = 0.0
    previous: float | None = None
    for point in points:
        if point.ele is None:
            continue
        if previous is not None and point.ele > previous:
            elevation += point.ele - previous
        previous = point.ele
    return round(distance / 1000.0, 1), int(round(elevation))


# ------------------------------------------------------------------- routes


@router.post("/routes", response_model=RouteSummary, status_code=status.HTTP_201_CREATED)
async def create_route(
    gpx: UploadFile = File(...),
    name: str = Form(...),
    description_html: str = Form(default=""),
    route_type: RouteType = Form(default=RouteType.road),
    wind_directions: str = Form(default=""),
    categories: str = Form(default=""),
    strava_url: str = Form(default=""),
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> RouteSummary:
    settings = get_settings()
    settings.ensure_dirs()

    raw = await gpx.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Het GPX-bestand is leeg."
        )
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Het bestand is te groot (maximaal 25 MB).",
        )

    # Comma-gescheiden formuliervelden valideren via het bestaande schema.
    meta = RouteCreateIn(
        name=name,
        description_html=description_html,
        route_type=route_type,
        wind_directions=[w for w in wind_directions.split(",") if w.strip()],
        categories=[c for c in categories.split(",") if c.strip()],
        strava_url=strava_url or None,
    )

    try:
        parsed = gpx_service.parse_gpx(raw)
        points = gpx_service.extract_route_points(parsed)
    except gpx_service.GpxError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    distance_km, elevation_m = _track_stats(points)
    slug = unique_slug(db, slugify(meta.name))

    target = settings.media_dir / "gpx" / f"{slug}.gpx"
    target.write_bytes(raw)

    route = Route(
        slug=slug,
        name=meta.name.strip(),
        description_html=meta.description_html,
        distance_km=distance_km,
        elevation_m=elevation_m,
        route_type=meta.route_type,
        wind_directions=meta.wind_directions,
        categories=meta.categories,
        strava_url=meta.strava_url,
        gpx_file=f"gpx/{slug}.gpx",
        coordinates=[[round(p.lat, 6), round(p.lon, 6)] for p in points],
        created_by_id=admin.id,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    logger.info("Route '%s' toegevoegd door %s", route.slug, admin.email)
    return to_summary(route)


@router.patch("/routes/{route_id}", response_model=RouteSummary)
def update_route(
    route_id: int,
    payload: RouteUpdateIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> RouteSummary:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(route, key, value)
    db.commit()
    return to_summary(route)


@router.delete("/routes/{route_id}", response_model=Message)
def delete_route(
    route_id: int,
    hard: bool = Query(default=False, description="Ook de bestanden verwijderen"),
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> Message:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )

    if not hard:
        # Standaard alleen verbergen: bestaande ritten blijven zo intact.
        route.is_active = False
        db.commit()
        logger.info("Route '%s' gearchiveerd door %s", route.slug, admin.email)
        return Message(detail=f"Route '{route.name}' is uit het overzicht gehaald.")

    media = get_settings().media_dir
    for relative in (route.gpx_file, route.tcx_file, route.map_file):
        if not relative:
            continue
        path = (media / relative).resolve()
        if path.is_relative_to(media.resolve()) and path.is_file():
            path.unlink(missing_ok=True)
    db.delete(route)
    db.commit()
    logger.info("Route '%s' definitief verwijderd door %s", route.slug, admin.email)
    return Message(detail=f"Route '{route.name}' is definitief verwijderd.")


@router.get("/routes", response_model=list[RouteSummary])
def list_all_routes(
    search: str | None = None,
    include_inactive: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> list[RouteSummary]:
    stmt = select(Route).order_by(Route.name.asc())
    if not include_inactive:
        stmt = stmt.where(Route.is_active.is_(True))
    if search:
        stmt = stmt.where(Route.name.ilike(f"%{search.strip()}%"))
    return [to_summary(r) for r in db.scalars(stmt).all()]


# --------------------------------------------------------------- gebruikers


@router.get("/users", response_model=list[UserOut])
def list_users(
    search: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> list[UserOut]:
    stmt = select(User).order_by(User.display_name.asc())
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.display_name.ilike(pattern), User.email.ilike(pattern)))
    return [UserOut.model_validate(u) for u in db.scalars(stmt).all()]


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdateIn,
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze gebruiker bestaat niet."
        )

    data = payload.model_dump(exclude_unset=True)

    if user.id == admin.id and data.get("is_admin") is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Je kunt je eigen beheerdersrechten niet intrekken.",
        )
    if data.get("is_admin") is False or data.get("is_active") is False:
        remaining = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_admin.is_(True), User.is_active.is_(True), User.id != user.id)
        )
        if user.is_admin and not remaining:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Er moet minstens één actieve beheerder overblijven.",
            )

    if data.pop("verify_email", None):
        user.email_verified_at = user.email_verified_at or utcnow()
    for key, value in data.items():
        setattr(user, key, value)
    db.commit()

    if data.get("is_active") is False:
        revoke_all_sessions(db, user.id)
    logger.info("Gebruiker %s aangepast door %s", user.email, admin.email)
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", response_model=Message)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> Message:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze gebruiker bestaat niet."
        )
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Je kunt je eigen account niet verwijderen.",
        )
    db.delete(user)
    db.commit()
    logger.info("Gebruiker %s verwijderd door %s", user.email, admin.email)
    return Message(detail="De gebruiker is verwijderd.")
