"""Ledenlijst voor keuzevelden (bijvoorbeeld de wegkapitein van een rit).

Bewust alleen id en naam: e-mailadressen blijven voorbehouden aan beheerders.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.schemas import UserSummary

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserSummary])
def list_members(
    db: Session = Depends(get_db), _: User = Depends(current_user)
) -> list[UserSummary]:
    rows = db.scalars(
        select(User)
        .where(User.is_active.is_(True), User.email_verified_at.is_not(None))
        .order_by(User.display_name.asc())
    ).all()
    return [UserSummary.model_validate(user) for user in rows]
