"""Beheerfuncties: routes toevoegen/verwijderen en gebruikers beheren."""

from __future__ import annotations

import logging

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

from app.config import SECRET_SETTING_KEYS, get_settings
from app.db import get_db
from app.deps import current_admin
from app.mail import send_test_mail
from app.models import Route, RouteOrigin, RouteType, User, utcnow
from app.routers.routes import to_detail, to_summary
from app.routes_common import slugify, track_stats, unique_slug
from app.schemas import (
    AdminUserUpdateIn,
    Message,
    OsmMapStatusOut,
    RouteCreateIn,
    RouteDetail,
    RouteSummary,
    RouteUpdateIn,
    SettingsOut,
    SettingsUpdateIn,
    TestMailIn,
    UserOut,
)
from app.security import revoke_all_sessions
from app import settings_store
from app.services import osm_index
from app.services import telegram as telegram_service
from app.water import gpx_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


# ------------------------------------------------------------------- routes


@router.post("/routes", response_model=RouteSummary, status_code=status.HTTP_201_CREATED)
async def create_route(
    gpx: UploadFile = File(...),
    tcx: UploadFile | None = File(default=None),
    name: str = Form(...),
    description_html: str = Form(default=""),
    route_type: RouteType = Form(default=RouteType.road),
    wind_directions: str = Form(default=""),
    categories: str = Form(default=""),
    strava_url: str = Form(default=""),
    komoot_url: str = Form(default=""),
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

    tcx_raw: bytes | None = None
    if tcx is not None and tcx.filename:
        tcx_raw = await tcx.read()
        if tcx_raw and len(tcx_raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Het TCX-bestand is te groot (maximaal 25 MB).",
            )

    # Comma-gescheiden formuliervelden valideren via het bestaande schema.
    meta = RouteCreateIn(
        name=name,
        description_html=description_html,
        route_type=route_type,
        wind_directions=[w for w in wind_directions.split(",") if w.strip()],
        categories=[c for c in categories.split(",") if c.strip()],
        strava_url=strava_url or None,
        komoot_url=komoot_url or None,
    )

    try:
        parsed = gpx_service.parse_gpx(raw)
        points = gpx_service.extract_route_points(parsed)
    except gpx_service.GpxError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    distance_km, elevation_m = track_stats(points)
    slug = unique_slug(db, slugify(meta.name))

    target = settings.media_dir / "gpx" / f"{slug}.gpx"
    target.write_bytes(raw)

    tcx_file = None
    if tcx_raw:
        tcx_target = settings.media_dir / "tcx" / f"{slug}.tcx"
        tcx_target.write_bytes(tcx_raw)
        tcx_file = f"tcx/{slug}.tcx"

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
        komoot_url=meta.komoot_url,
        gpx_file=f"gpx/{slug}.gpx",
        tcx_file=tcx_file,
        coordinates=[[round(p.lat, 6), round(p.lon, 6)] for p in points],
        created_by_id=admin.id,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    logger.info("Route '%s' toegevoegd door %s", route.slug, admin.email)
    return to_summary(route)


@router.get("/routes/{route_id}", response_model=RouteDetail)
def get_route(
    route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> RouteDetail:
    """Volledige routegegevens voor het bewerkformulier (ook verborgen routes)."""
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )
    return to_detail(route)


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
    data = payload.model_dump(exclude_unset=True)
    if "wind_directions" in data:
        # Een admin die de wind handmatig invult, overschrijft de schatting.
        route.wind_estimated = False
    for key, value in data.items():
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


@router.post("/routes/{route_id}/promote", response_model=RouteSummary)
def promote_route(
    route_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> RouteSummary:
    """Verplaats een community-route naar het officiële routeboek."""
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze route bestaat niet."
        )
    route.origin = RouteOrigin.official
    db.commit()
    logger.info("Community-route '%s' gepromoveerd door %s", route.slug, admin.email)
    return to_summary(route)


@router.get("/routes", response_model=list[RouteSummary])
def list_all_routes(
    search: str | None = None,
    include_inactive: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> list[RouteSummary]:
    stmt = select(Route).order_by(Route.name.asc())
    # Event-eigen routes zijn een implementatiedetail van één event en horen
    # niet als losse regel in het routebeheer thuis.
    stmt = stmt.where(Route.origin != RouteOrigin.event)
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


# -- Wegenkaart --------------------------------------------------------------

# De routecontrole ("mag ik hier fietsen?") werkt op een lokale kopie van de
# Nederlandse wegenkaart uit OpenStreetMap. Die wordt normaal vanzelf
# maandelijks ververst; hier kan een beheerder dat handmatig doen en zien hoe
# oud de gegevens zijn.


def _map_status() -> OsmMapStatusOut:
    state = osm_index.status()
    job = osm_index.current_job()
    return OsmMapStatusOut(
        available=state.available,
        way_count=state.way_count,
        size_mb=state.size_mb,
        age_days=round(state.age_days, 1) if state.age_days is not None else None,
        stale=state.stale,
        job_status=job.state if job is not None else "idle",
        job_message=job.message if job is not None else None,
        job_progress=job.progress if job is not None else 0.0,
        job_error=job.error if job is not None else None,
    )


@router.get("/map", response_model=OsmMapStatusOut)
def map_status(admin: User = Depends(current_admin)) -> OsmMapStatusOut:
    return _map_status()


@router.post("/map/refresh", response_model=OsmMapStatusOut)
def refresh_map(admin: User = Depends(current_admin)) -> OsmMapStatusOut:
    """Haal een verse wegenkaart op.

    Dit duurt een paar minuten en is bewust een achtergrondtaak: de huidige
    kaart blijft gewoon in gebruik tot de nieuwe helemaal klaar is.
    """
    job = osm_index.current_job()
    if job is not None and job.state == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="De kaart wordt al bijgewerkt.",
        )
    osm_index.start_refresh()
    logger.info("Wegenkaart handmatig bijgewerkt door %s", admin.email)
    return _map_status()


# -------------------------------------------------------------- instellingen
# Instellingen staan in de tabel `app_settings` en werken direct door, zonder
# herstart (zie app/config.py). Niet elk veld mag hier in: de whitelist
# RUNTIME_SETTING_KEYS houdt bewust `database_url`, `secret_key`, `nl_gpx_url`
# en de container-eigenschappen buiten bereik.


@router.get("/settings", response_model=SettingsOut)
def read_settings(admin: User = Depends(current_admin)) -> SettingsOut:
    return SettingsOut(
        values=settings_store.current_values(),
        secrets_set=settings_store.secret_flags(),
        readonly=settings_store.readonly_values(),
        readonly_reasons=settings_store.READONLY_REASONS,
    )


@router.put("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdateIn,
    db: Session = Depends(get_db),
    admin: User = Depends(current_admin),
) -> SettingsOut:
    # Een leeg gelaten geheim betekent "ongewijzigd"; zonder deze regel zou het
    # formulier bij elke keer opslaan het wachtwoord en de tokens wissen.
    values = {
        key: value
        for key, value in payload.values.items()
        if not (key in SECRET_SETTING_KEYS and value in ("", None))
    }
    try:
        settings_store.save_overrides(
            db, values, clear=payload.clear, actor_id=admin.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    logger.info(
        "Instellingen gewijzigd door %s: %s",
        admin.email,
        ", ".join(sorted(set(values) | set(payload.clear))) or "(niets)",
    )

    # De webhook hangt aan base_url en het bot-token; wijzigt daar iets, dan moet
    # Telegram opnieuw te horen krijgen waar hij moet aankloppen.
    if {"base_url", "telegram_bot_token", "telegram_webhook_secret"} & (
        set(values) | set(payload.clear)
    ):
        try:
            telegram_service.ensure_webhook()
        except Exception:
            logger.exception("Telegram-webhook opnieuw registreren mislukt")

    return SettingsOut(
        values=settings_store.current_values(),
        secrets_set=settings_store.secret_flags(),
        readonly=settings_store.readonly_values(),
        readonly_reasons=settings_store.READONLY_REASONS,
    )


@router.post("/settings/test-mail", response_model=Message)
def test_mail(
    payload: TestMailIn,
    admin: User = Depends(current_admin),
) -> Message:
    """Stuur een testmail en geef een eventuele SMTP-fout letterlijk terug.

    Hier mag de fout wél zichtbaar zijn: dit is een beheerdersdiagnose achter
    authenticatie, geen publiek endpoint. De anti-enumeratieregel die bij
    registratie en wachtwoordherstel geldt, is hier niet van toepassing.

    Bewust synchroon (geen BackgroundTask): de beheerder wil juist wachten op het
    antwoord, want dat antwoord is het hele doel van de knop.
    """
    settings = get_settings()
    target = str(payload.to) if payload.to else admin.email
    if not settings.mail_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="E-mail staat uit (mail_enabled). Zet die eerst aan.",
        )
    try:
        send_test_mail(target, admin.display_name)
    except Exception as exc:
        logger.warning("Testmail naar %s mislukt: %s", target, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Versturen mislukt: {exc}",
        ) from exc
    return Message(detail=f"Testmail verstuurd naar {target}.")


@router.post("/settings/test-telegram", response_model=Message)
def test_telegram(admin: User = Depends(current_admin)) -> Message:
    """Post een testbericht in het clubkanaal."""
    settings = get_settings()
    if not settings.telegram_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Er is geen Telegram-bot-token ingesteld.",
        )
    if not settings.telegram_channel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Er is geen kanaal-id ingesteld.",
        )
    try:
        telegram_service.send_message(
            settings.telegram_channel_id,
            f"✅ Testbericht vanuit {settings.app_name}. "
            f"De koppeling met dit kanaal werkt.",
        )
    except Exception as exc:
        logger.warning("Telegram-testbericht mislukt: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Versturen mislukt: {exc}",
        ) from exc
    return Message(detail="Testbericht in het kanaal geplaatst.")
