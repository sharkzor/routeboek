"""Events organiseren, bewerken, verwijderen en eraan deelnemen.

Een event is bewust losstaand van `Ride`: geen wegkapitein, geen standaard
woensdag/zondag-slot, geen privé-optie (het doel is juist om reisgenoten te
vinden voor grotere, verder-vooruit-geplande dingen zoals een sportive of
meerdaagse). Iedereen die is ingelogd mag een event aanmaken en zich
aanmelden; alleen de aanmaker of een beheerder mag 'm bewerken/verwijderen.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.deps import current_user
from app.models import Event, EventParticipant, Route, User
from app.routers.routes import media_url
from app.schemas import (
    EventCreateIn,
    EventJoinIn,
    EventOut,
    EventParticipantOut,
    EventRouteRef,
    EventUpdateIn,
    Message,
    UserSummary,
)
from app.services import events as event_service

router = APIRouter(prefix="/api/events", tags=["events"])


def _to_out(event: Event, user: User) -> EventOut:
    route_ref = None
    if event.route is not None:
        route_ref = EventRouteRef(
            id=event.route.id,
            slug=event.route.slug,
            name=event.route.name,
            distance_km=event.route.distance_km,
            map_url=media_url(event.route, "map"),
        )
    participants = [
        EventParticipantOut(
            id=p.user.id, display_name=p.user.display_name, transport=p.transport
        )
        for p in event.participants
    ]
    mine = next((p for p in event.participants if p.user_id == user.id), None)
    return EventOut(
        id=event.id,
        name=event.name,
        event_type=event.event_type,
        event_date=event.event_date,
        event_time=event.event_time,
        url=event.url,
        cost_eur=event.cost_eur,
        distance_km=event.distance_km,
        speed_kmh=event.speed_kmh,
        max_participants=event.max_participants,
        notes_html=event.notes_html,
        created_at=event.created_at,
        created_by=UserSummary.model_validate(event.created_by) if event.created_by else None,
        route=route_ref,
        participants=participants,
        participant_count=len(participants),
        is_joined=mine is not None,
        my_transport=mine.transport if mine else None,
        can_edit=event_service.can_edit(event, user),
    )


def _load_event(db: Session, event_id: int) -> Event:
    event = db.scalar(
        select(Event)
        .where(Event.id == event_id)
        .options(
            selectinload(Event.created_by),
            selectinload(Event.route),
            selectinload(Event.participants).selectinload(EventParticipant.user),
        )
        # Zonder dit blijft een al in de identity map geladen Event (bv. na
        # join/leave binnen hetzelfde request) zijn oude participants-lijst
        # tonen; forceer een verse load zodat de response altijd klopt.
        .execution_options(populate_existing=True)
    )
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dit event bestaat niet."
        )
    return event


def _resolve_route(db: Session, route_id: int | None) -> Route | None:
    if route_id is None:
        return None
    route = db.get(Route, route_id)
    if route is None or not route.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekende route."
        )
    return route


@router.get("", response_model=list[EventOut])
def list_events(
    include_past: bool = Query(default=False),
    mine: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[EventOut]:
    stmt = event_service.visible_events_query(include_past=include_past)
    if mine:
        joined = select(EventParticipant.event_id).where(EventParticipant.user_id == user.id)
        stmt = stmt.where((Event.created_by_id == user.id) | (Event.id.in_(joined)))
    return [_to_out(event, user) for event in db.scalars(stmt).unique().all()]


@router.get("/{event_id}", response_model=EventOut)
def event_detail(
    event_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> EventOut:
    return _to_out(_load_event(db, event_id), user)


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> EventOut:
    if payload.event_date < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Een event in het verleden plannen kan niet.",
        )
    route = _resolve_route(db, payload.route_id)

    event = Event(
        name=payload.name.strip(),
        event_type=payload.event_type,
        route_id=route.id if route else None,
        event_date=payload.event_date,
        event_time=payload.event_time,
        url=payload.url or None,
        cost_eur=payload.cost_eur,
        distance_km=payload.distance_km
        if payload.distance_km is not None
        else (route.distance_km if route else None),
        speed_kmh=payload.speed_kmh,
        max_participants=payload.max_participants,
        notes_html=payload.notes_html,
        created_by_id=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # De aanmaker meldt zichzelf meteen aan.
    db.add(EventParticipant(event_id=event.id, user_id=user.id))
    db.commit()
    return _to_out(_load_event(db, event.id), user)


@router.patch("/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> EventOut:
    event = _load_event(db, event_id)
    if not event_service.can_edit(event, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alleen de aanmaker of een beheerder kan dit event aanpassen.",
        )

    data = payload.model_dump(exclude_unset=True)
    if "route_id" in data:
        route = _resolve_route(db, data.pop("route_id"))
        event.route_id = route.id if route else None
    if "max_participants" in data and data["max_participants"] is not None:
        if data["max_participants"] < len(event.participants):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Er zijn al meer aanmeldingen dan dit maximum.",
            )
    if "url" in data and not data["url"]:
        data["url"] = None
    for key, value in data.items():
        setattr(event, key, value)

    db.commit()
    return _to_out(_load_event(db, event.id), user)


@router.delete("/{event_id}", response_model=Message)
def delete_event(
    event_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> Message:
    event = _load_event(db, event_id)
    if not event_service.can_edit(event, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alleen de aanmaker of een beheerder kan dit event verwijderen.",
        )
    db.delete(event)
    db.commit()
    return Message(detail="Het event is verwijderd.")


@router.post("/{event_id}/join", response_model=EventOut)
def join_event(
    event_id: int,
    payload: EventJoinIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> EventOut:
    event = _load_event(db, event_id)
    ok, message = event_service.join(db, event, user, payload.transport)
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return _to_out(_load_event(db, event_id), user)


@router.post("/{event_id}/leave", response_model=EventOut)
def leave_event(
    event_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> EventOut:
    event = _load_event(db, event_id)
    event_service.leave(db, event, user)
    return _to_out(_load_event(db, event_id), user)
