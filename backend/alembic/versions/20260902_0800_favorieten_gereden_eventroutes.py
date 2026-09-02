"""Favorieten, gereden routes en event-eigen routes

Revision ID: c5a1e8b46d72
Revises: b3f7d2a91c6e
Create Date: 2026-09-02

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5a1e8b46d72"
down_revision: str | None = "b3f7d2a91c6e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nieuwe waarde voor het bestaande route_origin-enum. ALTER TYPE ... ADD
    # VALUE kan in Postgres niet in een transactieblok samen met gebruik van
    # die waarde, maar hier wordt 'event' in deze migratie nergens weggeschreven
    # dus is dit veilig.
    op.execute("ALTER TYPE route_origin ADD VALUE IF NOT EXISTS 'event'")

    op.create_table(
        "route_favorites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "user_id", name="uq_route_favorite_user"),
    )
    op.create_index(
        op.f("ix_route_favorites_route_id"), "route_favorites", ["route_id"]
    )
    op.create_index(op.f("ix_route_favorites_user_id"), "route_favorites", ["user_id"])

    op.create_table(
        "route_completions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "user_id", name="uq_route_completion_user"),
    )
    op.create_index(
        op.f("ix_route_completions_route_id"), "route_completions", ["route_id"]
    )
    op.create_index(
        op.f("ix_route_completions_user_id"), "route_completions", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_route_completions_user_id"), table_name="route_completions")
    op.drop_index(
        op.f("ix_route_completions_route_id"), table_name="route_completions"
    )
    op.drop_table("route_completions")
    op.drop_index(op.f("ix_route_favorites_user_id"), table_name="route_favorites")
    op.drop_index(op.f("ix_route_favorites_route_id"), table_name="route_favorites")
    op.drop_table("route_favorites")
    # De enumwaarde 'event' blijft staan: Postgres kan een waarde niet uit een
    # enum verwijderen zonder het type te herbouwen.
