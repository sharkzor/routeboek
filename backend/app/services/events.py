"""Bedrijfslogica rond events.

Losse laag van FastAPI, zodat een toekomstige Telegram-bot dezelfde regels
kan hergebruiken (net als bij `services/rides.py`).
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Event, EventParticipant, TransportMode, User


def visible_events_query(include_past: bool = False):
    """Events zijn voor iedereen zichtbaar; geen privé-events (in tegenstelling

    tot ritten) omdat het doel juist is om reisgenoten te vinden.
    """
    stmt = (
        select(Event)
        .options(
            selectinload(Event.created_by),
            selectinload(Event.route),
            selectinload(Event.participants).selectinload(EventParticipant.user),
        )
        .order_by(Event.event_date.asc(), Event.event_time.asc())
    )
    if not include_past:
        stmt = stmt.where(Event.event_date >= date.today())
    return stmt


def can_edit(event: Event, user: User) -> bool:
    return user.is_admin or event.created_by_id == user.id


def is_full(event: Event) -> bool:
    return len(event.participants) >= event.max_participants


def join(db: Session, event: Event, user: User, transport: TransportMode) -> tuple[bool, str]:
    """Meld aan, of werk het vervoer bij als de gebruiker al is aangemeld."""
    existing = next((p for p in event.participants if p.user_id == user.id), None)
    if existing is not None:
        existing.transport = transport
        db.commit()
        return True, "Je aanmelding is bijgewerkt."
    if is_full(event):
        return False, "Dit event zit vol."
    db.add(EventParticipant(event_id=event.id, user_id=user.id, transport=transport))
    db.commit()
    return True, "Je bent aangemeld voor dit event."


def leave(db: Session, event: Event, user: User) -> tuple[bool, str]:
    entry = db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id, EventParticipant.user_id == user.id
        )
    )
    if entry is None:
        return True, "Je was niet aangemeld."
    db.delete(entry)
    db.commit()
    return True, "Je bent afgemeld voor dit event."
