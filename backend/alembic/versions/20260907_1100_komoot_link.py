"""Komoot-link naast Strava-link op routes

Revision ID: b2d7e5f9c4a1
Revises: a1c6f4e8b3d0
Create Date: 2026-09-07

Sommige leden hebben geen Strava-abonnement; een optionele Komoot-link is
een gelijkwaardig alternatief naast de bestaande Strava-link.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2d7e5f9c4a1"
down_revision: str | None = "a1c6f4e8b3d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("komoot_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("routes", "komoot_url")
