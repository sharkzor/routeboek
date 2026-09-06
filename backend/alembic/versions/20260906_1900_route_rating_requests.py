"""Beoordeel-je-rit-mail: tabel om verzonden verzoeken bij te houden

Revision ID: a1c6f4e8b3d0
Revises: f3a9c1d5e872
Create Date: 2026-09-06

Onthoudt aan wie er, per (rit, deelnemer), al een 'beoordeel deze route'-mail
is gestuurd. Zonder deze tabel zou de dagelijkse achtergrondtaak (08:00) bij
een herstart of trage query dezelfde mail nog eens kunnen versturen.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c6f4e8b3d0"
down_revision: str | None = "f3a9c1d5e872"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "route_rating_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ride_id",
            sa.Integer(),
            sa.ForeignKey("rides.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            sa.Integer(),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("ride_id", "user_id", name="uq_rating_request_ride_user"),
    )
    op.create_index(
        op.f("ix_route_rating_requests_ride_id"),
        "route_rating_requests",
        ["ride_id"],
    )
    op.create_index(
        op.f("ix_route_rating_requests_user_id"),
        "route_rating_requests",
        ["user_id"],
    )
    op.create_index(
        op.f("ix_route_rating_requests_route_id"),
        "route_rating_requests",
        ["route_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_route_rating_requests_route_id"), table_name="route_rating_requests"
    )
    op.drop_index(
        op.f("ix_route_rating_requests_user_id"), table_name="route_rating_requests"
    )
    op.drop_index(
        op.f("ix_route_rating_requests_ride_id"), table_name="route_rating_requests"
    )
    op.drop_table("route_rating_requests")
