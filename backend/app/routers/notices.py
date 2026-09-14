"""Werkzaamheden en bijzonderheden bij routes melden.

Elk ingelogd lid mag een melding aanmaken; alleen de melder zelf of een
beheerder mag 'm bewerken of verwijderen (zelfde patroon als events en
community-routes). Een melding hangt altijd aan minstens één route en
verdwijnt zodra de einddatum verstreken is — zie `app/services/notices.py`.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import RouteNotice, User
from app.schemas import (
    Message,
    NoticeCreateIn,
    NoticeOut,
    NoticeRouteRef,
    NoticeUpdateIn,
)
from app.services import notices as notice_service

router = APIRouter(prefix="/api/notices", tags=["notices"])


def notice_out(notice: RouteNotice, user: User, today: date | None = None) -> NoticeOut:
    return NoticeOut(
        id=notice.id,
        kind=notice.kind,
        title=notice.title,
        description=notice.description,
        start_date=notice.start_date,
        end_date=notice.end_date,
        created_at=notice.created_at,
        created_by=notice.created_by.display_name if notice.created_by else None,
        routes=[NoticeRouteRef.model_validate(r) for r in notice.routes],
        is_active=notice_service.is_active(notice, today),
        can_edit=notice_service.can_edit(notice, user),
    )


def _load_notice(db: Session, notice_id: int) -> RouteNotice:
    notice = db.get(RouteNotice, notice_id)
    # Een verlopen melding gedraagt zich alsof hij niet meer bestaat, ook als
    # de nachtelijke opruimronde nog niet langs is geweest.
    if notice is None or notice.end_date < date.today():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze melding bestaat niet."
        )
    return notice


def _require_edit(notice: RouteNotice, user: User) -> None:
    if not notice_service.can_edit(notice, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Je mag alleen je eigen meldingen aanpassen.",
        )


def _apply_routes(db: Session, notice: RouteNotice, route_ids: list[int]) -> None:
    routes = notice_service.resolve_routes(db, route_ids)
    if not routes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kies minstens één bestaande route.",
        )
    notice.routes = routes


@router.get("", response_model=list[NoticeOut])
def list_notices(
    db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[NoticeOut]:
    today = date.today()
    items = db.scalars(notice_service.visible_query(today)).unique().all()
    return [notice_out(n, user, today) for n in items]


@router.get("/{notice_id}", response_model=NoticeOut)
def notice_detail(
    notice_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> NoticeOut:
    return notice_out(_load_notice(db, notice_id), user)


@router.post("", response_model=NoticeOut, status_code=status.HTTP_201_CREATED)
def create_notice(
    payload: NoticeCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> NoticeOut:
    notice = RouteNotice(
        kind=payload.kind,
        title=payload.title,
        description=payload.description,
        # De validator in NoticeCreateIn vult start_date al met vandaag.
        start_date=payload.start_date or date.today(),
        end_date=payload.end_date,
        created_by_id=user.id,
    )
    _apply_routes(db, notice, payload.route_ids)
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return notice_out(notice, user)


@router.patch("/{notice_id}", response_model=NoticeOut)
def update_notice(
    notice_id: int,
    payload: NoticeUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> NoticeOut:
    notice = _load_notice(db, notice_id)
    _require_edit(notice, user)

    data = payload.model_dump(exclude_unset=True)
    route_ids = data.pop("route_ids", None)
    for key, value in data.items():
        if value is not None:
            setattr(notice, key, value)

    if notice.end_date < notice.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="De einddatum kan niet voor de startdatum liggen.",
        )
    if notice.end_date < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="De einddatum ligt in het verleden; de melding zou meteen verdwijnen.",
        )
    if route_ids is not None:
        _apply_routes(db, notice, route_ids)

    db.commit()
    db.refresh(notice)
    return notice_out(notice, user)


@router.delete("/{notice_id}", response_model=Message)
def delete_notice(
    notice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Message:
    notice = _load_notice(db, notice_id)
    _require_edit(notice, user)
    db.delete(notice)
    db.commit()
    return Message(detail="De melding is verwijderd.")
