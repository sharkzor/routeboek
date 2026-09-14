"""Tabel app_settings: instellingen die tijdens het draaien aanpasbaar zijn.

Revision ID: e8b3d7f1a520
Revises: c4e9a1b7d6f2
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "e8b3d7f1a520"
down_revision: str | None = "c4e9a1b7d6f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
