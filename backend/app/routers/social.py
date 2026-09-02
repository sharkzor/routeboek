"""Reacties en waarderingen per route.

Iedereen die is ingelogd mag reageren en waarderen (net als in de rest van de
app is er geen anoniem gebruik). Waarderingen zijn per lid uniek (1-5
sterren, opnieuw stemmen overschrijft de vorige stem). Comments verwijderen
mag alleen een admin (bijvoorbeeld bij ongepaste inhoud).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_admin, current_user
from app.models import RouteComment, RouteCompletion, RouteFavorite, RouteRating, User
from app.rating import recompute_rating
from app.routers.routes import get_route_or_404
from app.schemas import CommentCreateIn, CommentOut, MarkOut, RatingIn, RatingOut

router = APIRouter(prefix="/api/routes", tags=["social"])


def _recompute_rating(db: Session, route_id: int) -> tuple[float | None, int]:
    route = get_route_or_404(db, route_id)
    recompute_rating(db, route)
    db.add(route)
    return route.rating, route.rating_count


@router.get("/{route_id}/comments", response_model=list[CommentOut])
def list_comments(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[CommentOut]:
    route = get_route_or_404(db, route_id)
    comments = db.scalars(
        select(RouteComment)
        .where(RouteComment.route_id == route.id)
        .order_by(RouteComment.created_at.asc())
    ).all()
    return [
        CommentOut(
            id=c.id,
            display_name=c.user.display_name,
            body=c.body,
            created_at=c.created_at,
            is_mine=c.user_id == user.id,
        )
        for c in comments
    ]


@router.post("/{route_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def add_comment(
    route_id: int,
    payload: CommentCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> CommentOut:
    route = get_route_or_404(db, route_id)
    comment = RouteComment(route_id=route.id, user_id=user.id, body=payload.body)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return CommentOut(
        id=comment.id,
        display_name=user.display_name,
        body=comment.body,
        created_at=comment.created_at,
        is_mine=True,
    )


@router.delete("/{route_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    route_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
) -> None:
    comment = db.get(RouteComment, comment_id)
    if comment is None or comment.route_id != route_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reactie niet gevonden.")
    db.delete(comment)
    db.commit()


@router.put("/{route_id}/rating", response_model=RatingOut)
def set_rating(
    route_id: int,
    payload: RatingIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RatingOut:
    get_route_or_404(db, route_id)
    existing = db.scalar(
        select(RouteRating).where(
            RouteRating.route_id == route_id, RouteRating.user_id == user.id
        )
    )
    if existing:
        existing.value = payload.value
    else:
        db.add(RouteRating(route_id=route_id, user_id=user.id, value=payload.value))
    db.flush()
    rating, rating_count = _recompute_rating(db, route_id)
    db.commit()
    return RatingOut(rating=rating, rating_count=rating_count, my_rating=payload.value)


@router.delete("/{route_id}/rating", response_model=RatingOut)
def clear_rating(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RatingOut:
    get_route_or_404(db, route_id)
    existing = db.scalar(
        select(RouteRating).where(
            RouteRating.route_id == route_id, RouteRating.user_id == user.id
        )
    )
    if existing:
        db.delete(existing)
        db.flush()
    rating, rating_count = _recompute_rating(db, route_id)
    db.commit()
    return RatingOut(rating=rating, rating_count=rating_count, my_rating=None)


def _toggle_mark(
    db: Session,
    model: type[RouteFavorite] | type[RouteCompletion],
    route_id: int,
    user_id: int,
    on: bool,
) -> bool:
    """Zet een persoonlijke markering (favoriet of gereden) aan of uit.

    Idempotent: twee keer aanzetten levert geen dubbele rij op, uitzetten van
    iets dat er niet staat is geen fout.
    """
    existing = db.scalar(
        select(model).where(model.route_id == route_id, model.user_id == user_id)
    )
    if on and existing is None:
        db.add(model(route_id=route_id, user_id=user_id))
    elif not on and existing is not None:
        db.delete(existing)
    db.commit()
    return on


@router.post("/{route_id}/favorite", response_model=MarkOut)
def add_favorite(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> MarkOut:
    get_route_or_404(db, route_id)
    return MarkOut(active=_toggle_mark(db, RouteFavorite, route_id, user.id, True))


@router.delete("/{route_id}/favorite", response_model=MarkOut)
def remove_favorite(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> MarkOut:
    get_route_or_404(db, route_id)
    return MarkOut(active=_toggle_mark(db, RouteFavorite, route_id, user.id, False))


@router.post("/{route_id}/ridden", response_model=MarkOut)
def add_ridden(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> MarkOut:
    get_route_or_404(db, route_id)
    return MarkOut(active=_toggle_mark(db, RouteCompletion, route_id, user.id, True))


@router.delete("/{route_id}/ridden", response_model=MarkOut)
def remove_ridden(
    route_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> MarkOut:
    get_route_or_404(db, route_id)
    return MarkOut(active=_toggle_mark(db, RouteCompletion, route_id, user.id, False))
