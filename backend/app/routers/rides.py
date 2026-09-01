"""Ritten organiseren, bewerken, annuleren en eraan deelnemen."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.deps import current_user
from app.models import Ride, RideParticipant, Route, User, utcnow
from app.routers.routes import media_url
from app.schemas import (
    Message,
    RideCreateIn,
    RideDefaults,
    RideOut,
    RideRouteRef,
    RideUpdateIn,
    UserSummary,
)
from app.services import rides as ride_service

router = APIRouter(prefix="/api/rides", tags=["rides"])


def _to_out(ride: Ride, user: User) -> RideOut:
    route_ref = None
    if ride.route is not None:
        route_ref = RideRouteRef(
            id=ride.route.id,
            slug=ride.route.slug,
            name=ride.route.name,
            distance_km=ride.route.distance_km,
            map_url=media_url(ride.route, "map"),
        )
    participants = [UserSummary.model_validate(p.user) for p in ride.participants]
    return RideOut(
        id=ride.id,
        name=ride.name,
        owner=UserSummary.model_validate(ride.owner),
        ride_date=ride.ride_date,
        ride_time=ride.ride_time,
        ride_type=ride.ride_type,
        distance_km=ride.distance_km,
        speed_kmh=ride.speed_kmh,
        max_participants=ride.max_participants,
        notes_html=ride.notes_html,
        is_private=ride.is_private,
        cancelled_at=ride.cancelled_at,
        created_at=ride.created_at,
        route=route_ref,
        participants=participants,
        participant_count=len(participants),
        is_joined=any(p.user_id == user.id for p in ride.participants),
        can_edit=ride_service.can_edit(ride, user),
    )


def _load_ride(db: Session, ride_id: int) -> Ride:
    ride = db.scalar(
        select(Ride)
        .where(Ride.id == ride_id)
        .options(
            selectinload(Ride.owner),
            selectinload(Ride.route),
            selectinload(Ride.participants).selectinload(RideParticipant.user),
        )
        # Zonder dit blijft een al in de identity map geladen Ride (bv. na
        # join/leave binnen hetzelfde request) zijn oude participants-lijst
        # tonen; forceer een verse load zodat de response altijd klopt.
        .execution_options(populate_existing=True)
    )
    if ride is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze rit bestaat niet."
        )
    return ride


def _resolve_route(db: Session, route_id: int | None) -> Route | None:
    if route_id is None:
        return None
    route = db.get(Route, route_id)
    if route is None or not route.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekende route."
        )
    return route


def _resolve_owner(db: Session, owner_id: int | None, fallback: User) -> User:
    """De wegkapitein van de rit; standaard degene die de rit aanmaakt."""
    if owner_id is None or owner_id == fallback.id:
        return fallback
    owner = db.get(User, owner_id)
    if owner is None or not owner.is_active or not owner.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekende wegkapitein."
        )
    return owner


@router.get("/defaults", response_model=RideDefaults)
def ride_defaults(_: User = Depends(current_user)) -> RideDefaults:
    day, slot, label = ride_service.next_standard_slot()
    return RideDefaults(ride_date=day, ride_time=slot, label=label)


@router.get("", response_model=list[RideOut])
def list_rides(
    include_past: bool = Query(default=False),
    mine: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[RideOut]:
    stmt = ride_service.visible_rides_query(user, include_past=include_past)
    if mine:
        joined = select(RideParticipant.ride_id).where(RideParticipant.user_id == user.id)
        stmt = stmt.where((Ride.owner_id == user.id) | (Ride.id.in_(joined)))
    return [_to_out(ride, user) for ride in db.scalars(stmt).unique().all()]


@router.get("/{ride_id}", response_model=RideOut)
def ride_detail(
    ride_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> RideOut:
    ride = _load_ride(db, ride_id)
    if not ride_service.can_view(ride, user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze rit bestaat niet."
        )
    return _to_out(ride, user)


@router.post("", response_model=RideOut, status_code=status.HTTP_201_CREATED)
def create_ride(
    payload: RideCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RideOut:
    if payload.ride_date < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Een rit in het verleden plannen kan niet.",
        )
    route = _resolve_route(db, payload.route_id)
    owner = _resolve_owner(db, payload.owner_id, user)

    ride = Ride(
        name=payload.name.strip() or ride_service.default_ride_name(route),
        owner_id=owner.id,
        route_id=route.id if route else None,
        ride_date=payload.ride_date,
        ride_time=payload.ride_time,
        ride_type=payload.ride_type,
        distance_km=payload.distance_km
        if payload.distance_km is not None
        else (route.distance_km if route else None),
        speed_kmh=payload.speed_kmh,
        max_participants=payload.max_participants,
        notes_html=payload.notes_html,
        is_private=payload.is_private,
        created_by_id=user.id,
    )
    db.add(ride)
    db.commit()
    db.refresh(ride)

    # De wegkapitein rijdt zelf mee.
    db.add(RideParticipant(ride_id=ride.id, user_id=owner.id))
    db.commit()
    return _to_out(_load_ride(db, ride.id), user)


@router.patch("/{ride_id}", response_model=RideOut)
def update_ride(
    ride_id: int,
    payload: RideUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RideOut:
    ride = _load_ride(db, ride_id)
    if not ride_service.can_edit(ride, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alleen de wegkapitein of een beheerder kan deze rit aanpassen.",
        )

    data = payload.model_dump(exclude_unset=True)
    if "route_id" in data:
        route = _resolve_route(db, data.pop("route_id"))
        ride.route_id = route.id if route else None
    if "owner_id" in data:
        ride.owner_id = _resolve_owner(db, data.pop("owner_id"), user).id
    if data.get("max_participants") is not None:
        if data["max_participants"] < len(ride.participants):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Er zijn al meer deelnemers aangemeld dan dit maximum.",
            )
    for key, value in data.items():
        setattr(ride, key, value)

    db.commit()
    return _to_out(_load_ride(db, ride.id), user)


@router.delete("/{ride_id}", response_model=Message)
def cancel_ride(
    ride_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> Message:
    ride = _load_ride(db, ride_id)
    if not ride_service.can_edit(ride, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alleen de wegkapitein of een beheerder kan deze rit annuleren.",
        )
    db.delete(ride)
    db.commit()
    return Message(detail="De rit is verwijderd.")


@router.post("/{ride_id}/join", response_model=RideOut)
def join_ride(
    ride_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> RideOut:
    ride = _load_ride(db, ride_id)
    if not ride_service.can_view(ride, user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze rit bestaat niet."
        )
    ok, message = ride_service.join(db, ride, user)
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return _to_out(_load_ride(db, ride_id), user)


@router.post("/{ride_id}/leave", response_model=RideOut)
def leave_ride(
    ride_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> RideOut:
    ride = _load_ride(db, ride_id)
    ride_service.leave(db, ride, user)
    return _to_out(_load_ride(db, ride_id), user)
