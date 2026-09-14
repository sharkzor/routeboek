"""route_notices: tijdelijke werkzaamheden en bijzonderheden bij routes

Revision ID: c4e9a1b7d6f2
Revises: b2d7e5f9c4a1
Create Date: 2026-09-14

Een melding hangt via een platte koppeltabel aan een of meer routes en loopt
af op `end_date`; de achtergrondlus in `app/services/notices.py` verwijdert
verlopen meldingen definitief (cascade ruimt de koppelrijen op).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "c4e9a1b7d6f2"
down_revision: str | None = "b2d7e5f9c4a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# create_type=False werkt alleen op de dialect-specifieke ENUM; de generieke
# sa.Enum negeert de parameter en laat create_table het type nog eens
# aanmaken (DuplicateObject). Zie ook 20260901_1600_events.py.
notice_kind = PGEnum("works", "hazard", "info", name="notice_kind", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    notice_kind.create(bind, checkfirst=True)

    op.create_table(
        "route_notices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", notice_kind, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_route_notices_end_date", "route_notices", ["end_date"])

    op.create_table(
        "route_notice_routes",
        sa.Column("notice_id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["notice_id"], ["route_notices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("notice_id", "route_id"),
    )
    op.create_index(
        "ix_route_notice_routes_route_id", "route_notice_routes", ["route_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_route_notice_routes_route_id", table_name="route_notice_routes")
    op.drop_table("route_notice_routes")
    op.drop_index("ix_route_notices_end_date", table_name="route_notices")
    op.drop_table("route_notices")
    notice_kind.drop(op.get_bind(), checkfirst=True)
