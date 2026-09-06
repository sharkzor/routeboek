"""Dagelijkse 'beoordeel je rit'-mail, de ochtend na een clubrit.

Draait als achtergrondthread (zelfde patroon als de Telegram-reminderloop in
`services/telegram.py`): een lus die elke minuut checkt of het 08:00 lokale
tijd is en de taak dat kalenderdag nog niet gedraaid heeft. Verzenden zelf is
idempotent via `RouteRatingRequest` (uniek per rit + deelnemer), dus een
toevallige dubbele run (bv. na een herstart rond 08:00) veroorzaakt nooit
dubbele mails.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import SessionLocal
from app.mail import send_route_rating_mail
from app.models import Ride, RideParticipant, RouteRating, RouteRatingRequest

logger = logging.getLogger(__name__)

_last_run_date: date | None = None


def _rides_ridden_on(db, ride_date: date) -> list[Ride]:
    stmt = (
        select(Ride)
        .where(Ride.ride_date == ride_date, Ride.route_id.is_not(None))
        .options(
            selectinload(Ride.route),
            selectinload(Ride.participants).selectinload(RideParticipant.user),
        )
    )
    return list(db.execute(stmt).scalars().unique())


def send_due_rating_requests(*, for_date: date | None = None) -> int:
    """Verstuurt de beoordeel-mail voor alle ritten op `for_date` (standaard
    gisteren). Geeft het aantal verstuurde mails terug; vooral handig om
    los te kunnen testen zonder op 08:00 te hoeven wachten."""

    settings = get_settings()
    target_date = for_date or (datetime.now().date() - timedelta(days=1))
    sent = 0
    db = SessionLocal()
    try:
        for ride in _rides_ridden_on(db, target_date):
            route = ride.route
            if route is None:
                continue
            for participant in ride.participants:
                user = participant.user
                already_asked = db.execute(
                    select(RouteRatingRequest.id).where(
                        RouteRatingRequest.ride_id == ride.id,
                        RouteRatingRequest.user_id == user.id,
                    )
                ).scalar_one_or_none()
                if already_asked is not None:
                    continue
                # Vastleggen gebeurt ook als de gebruiker al beoordeeld heeft,
                # zodat deze rit/deelname nooit opnieuw wordt bekeken.
                db.add(
                    RouteRatingRequest(
                        ride_id=ride.id, user_id=user.id, route_id=route.id
                    )
                )
                already_rated = db.execute(
                    select(RouteRating.id).where(
                        RouteRating.route_id == route.id,
                        RouteRating.user_id == user.id,
                    )
                ).scalar_one_or_none()
                if already_rated is not None:
                    db.commit()
                    continue
                route_url = f"{settings.base_url}/routes/{route.id}"
                try:
                    send_route_rating_mail(
                        user.email, user.display_name, route.name, route_url
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "beoordeel-mail voor rit %s / gebruiker %s mislukt",
                        ride.id,
                        user.id,
                    )
                db.commit()
                sent += 1
    finally:
        db.close()
    return sent


def _tick() -> None:
    global _last_run_date
    now = datetime.now()
    today = now.date()
    if now.hour != 8 or _last_run_date == today:
        return
    _last_run_date = today
    try:
        count = send_due_rating_requests()
        if count:
            logger.info("beoordeel-mails: %s verstuurd", count)
    except Exception:  # noqa: BLE001
        logger.exception("beoordeel-mails: dagelijkse ronde mislukt")


def start_rating_request_loop() -> None:
    def loop() -> None:
        while True:
            try:
                _tick()
            except Exception:  # noqa: BLE001
                logger.exception("beoordeel-mails: onverwachte fout in lus")
            time.sleep(60)

    threading.Thread(target=loop, name="route-rating-requests", daemon=True).start()
