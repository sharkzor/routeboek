"""Bedrijfslogica rond ritten.

Deze laag staat los van FastAPI, zodat een toekomstige Telegram-bot precies
dezelfde regels kan gebruiken om ritten aan te maken en te tonen.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, time, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Ride, RideGuest, RideParticipant, Route, User

# De club rijdt standaard op woensdagavond en zondagochtend.
# Sleutel is de weekdag volgens date.weekday() (maandag = 0).
STANDARD_SLOTS: dict[int, time] = {
    2: time(19, 0),  # woensdag 19:00
    6: time(10, 0),  # zondag 10:00
}
SLOT_LABELS = {2: "woensdagavond", 6: "zondagochtend"}


def next_standard_slot(now: datetime | None = None) -> tuple[date, time, str]:
    """Het eerstvolgende standaard clubmoment vanaf `now`.

    Een moment dat vandaag is maar al geweest, wordt overgeslagen.
    """
    now = now or datetime.now()
    for offset in range(0, 8):
        day = now.date() + timedelta(days=offset)
        slot = STANDARD_SLOTS.get(day.weekday())
        if slot is None:
            continue
        if offset == 0 and now.time() >= slot:
            continue
        return day, slot, SLOT_LABELS[day.weekday()]

    # Onbereikbaar zolang STANDARD_SLOTS gevuld is, maar geeft een veilige waarde.
    day = now.date() + timedelta(days=1)
    return day, time(19, 0), "rit"


def default_ride_name(route: Route | None) -> str:
    return route.name if route is not None else "Clubrit"


def visible_rides_query(user: User, include_past: bool = False):
    """Ritten die deze gebruiker mag zien.

    Privé-ritten blijven buiten het standaardoverzicht; alleen de eigenaar, de
    aanmaker, aangemelde deelnemers, genodigden (`RideGuest`, iemand met wie de
    link gedeeld is) en beheerders zien ze.
    """
    stmt = (
        select(Ride)
        .options(
            selectinload(Ride.owner),
            selectinload(Ride.route),
            selectinload(Ride.participants).selectinload(RideParticipant.user),
        )
        .order_by(Ride.ride_date.asc(), Ride.ride_time.asc())
    )
    if not include_past:
        stmt = stmt.where(Ride.ride_date >= date.today())

    if not user.is_admin:
        joined = select(RideParticipant.ride_id).where(RideParticipant.user_id == user.id)
        invited = select(RideGuest.ride_id).where(RideGuest.user_id == user.id)
        stmt = stmt.where(
            or_(
                Ride.is_private.is_(False),
                Ride.owner_id == user.id,
                Ride.created_by_id == user.id,
                Ride.id.in_(joined),
                Ride.id.in_(invited),
            )
        )
    return stmt


def can_view(ride: Ride, user: User) -> bool:
    if not ride.is_private or user.is_admin:
        return True
    if ride.owner_id == user.id or ride.created_by_id == user.id:
        return True
    if any(p.user_id == user.id for p in ride.participants):
        return True
    return any(g.user_id == user.id for g in ride.guests)


def accept_share_key(db: Session, ride: Ride, user: User, key: str | None) -> bool:
    """Verzilver een deel-link: leg vast dat dit lid de rit mag zien.

    Zonder dit zou een gedeelde privé-rit weer uit het overzicht verdwijnen
    zodra de link kwijt is. De sleutel zelf geeft geen toegang aan
    buitenstaanders: je moet nog steeds ingelogd zijn als clublid.

    Geeft terug of deze gebruiker de rit (nu) mag zien.
    """
    if can_view(ride, user):
        return True
    # `compare_digest` voorkomt dat de reactietijd iets over de sleutel prijsgeeft.
    if not key or not secrets.compare_digest(key, ride.share_token):
        return False
    db.add(RideGuest(ride_id=ride.id, user_id=user.id))
    db.commit()
    return True


def can_edit(ride: Ride, user: User) -> bool:
    return user.is_admin or ride.owner_id == user.id or ride.created_by_id == user.id


def is_full(ride: Ride) -> bool:
    return len(ride.participants) >= ride.max_participants


def join(db: Session, ride: Ride, user: User) -> tuple[bool, str]:
    """Meld een gebruiker aan. Geeft (gelukt, melding)."""
    if ride.cancelled_at is not None:
        return False, "Deze rit is geannuleerd."
    if any(p.user_id == user.id for p in ride.participants):
        return True, "Je was al aangemeld."
    if is_full(ride):
        return False, "Deze rit zit vol."
    db.add(RideParticipant(ride_id=ride.id, user_id=user.id))
    db.commit()
    return True, "Je bent aangemeld voor deze rit."


def leave(db: Session, ride: Ride, user: User) -> tuple[bool, str]:
    entry = db.scalar(
        select(RideParticipant).where(
            RideParticipant.ride_id == ride.id, RideParticipant.user_id == user.id
        )
    )
    if entry is None:
        return True, "Je was niet aangemeld."
    db.delete(entry)
    db.commit()
    return True, "Je bent afgemeld voor deze rit."
