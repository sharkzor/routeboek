"""Werkzaamheden en bijzonderheden bij routes.

Losse laag van FastAPI, net als `services/rides.py` en `services/events.py`,
zodat een toekomstige Telegram-bot dezelfde regels kan hergebruiken.

Meldingen verdwijnen op twee manieren, en dat is bewust dubbelop:

1. **Filteren op leestijd** (`visible_query()`, `for_route()`): alles met een
   einddatum vóór vandaag valt buiten de query. Een melding is daardoor
   meteen weg zodra de dag om is, niet pas na de nachtelijke ronde.
2. **Definitief opruimen** (`purge_expired()`, gestart via
   `start_cleanup_loop()`): één keer per dag worden de rijen echt verwijderd,
   zodat de tabel niet eindeloos groeit. Er is bewust geen archief; wie een
   melding langer nodig heeft, verlengt de einddatum zolang hij nog leeft.
"""

from __future__ import annotations

import logging
import threading
import time as time_module
from datetime import date, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal
from app.models import Route, RouteNotice, User, route_notice_routes

logger = logging.getLogger(__name__)

#: Uur waarop de opruimronde draait; 's nachts, want het is puur onderhoud.
CLEANUP_HOUR = 3

_last_run_date: date | None = None


def visible_query(today: date | None = None):
    """Alle nog lopende en geplande meldingen, eerstaflopende bovenaan."""
    today = today or date.today()
    return (
        select(RouteNotice)
        .options(selectinload(RouteNotice.created_by), selectinload(RouteNotice.routes))
        .where(RouteNotice.end_date >= today)
        .order_by(RouteNotice.end_date.asc(), RouteNotice.id.asc())
    )


def for_route(db: Session, route_id: int, today: date | None = None) -> list[RouteNotice]:
    """Meldingen die bij één route horen (lopend én gepland)."""
    today = today or date.today()
    stmt = (
        visible_query(today)
        .join(route_notice_routes, route_notice_routes.c.notice_id == RouteNotice.id)
        .where(route_notice_routes.c.route_id == route_id)
    )
    return list(db.scalars(stmt).unique().all())


def is_active(notice: RouteNotice, today: date | None = None) -> bool:
    """Actief = begonnen en nog niet verlopen; anders is het nog 'gepland'."""
    today = today or date.today()
    return notice.start_date <= today <= notice.end_date


def can_edit(notice: RouteNotice, user: User) -> bool:
    return user.is_admin or notice.created_by_id == user.id


def resolve_routes(db: Session, route_ids: list[int]) -> list[Route]:
    """Zoek de opgegeven routes op; onbekende of verborgen routes vallen af.

    Origin-agnostisch: een melding mag net zo goed op een community- of
    event-route slaan als op een officiële route.
    """
    routes = list(
        db.scalars(
            select(Route).where(Route.id.in_(route_ids), Route.is_active.is_(True))
        ).all()
    )
    return routes


def purge_expired(today: date | None = None) -> int:
    """Verwijder verlopen meldingen definitief; koppelrijen gaan mee via cascade."""
    today = today or date.today()
    db = SessionLocal()
    try:
        result = db.execute(delete(RouteNotice).where(RouteNotice.end_date < today))
        db.commit()
        return result.rowcount or 0
    finally:
        db.close()


def _tick() -> None:
    global _last_run_date
    now = datetime.now()
    today = now.date()
    if now.hour != CLEANUP_HOUR or _last_run_date == today:
        return
    _last_run_date = today
    try:
        removed = purge_expired(today)
        if removed:
            logger.info("werkzaamheden: %s verlopen meldingen opgeruimd", removed)
    except Exception:  # noqa: BLE001
        logger.exception("werkzaamheden: opruimronde mislukt")


def start_cleanup_loop() -> None:
    def loop() -> None:
        while True:
            try:
                _tick()
            except Exception:  # noqa: BLE001
                logger.exception("werkzaamheden: onverwachte fout in lus")
            time_module.sleep(60)

    threading.Thread(target=loop, name="notice-cleanup", daemon=True).start()
