"""Telegram-integratie: account koppelen, rit posten, deelnemersreminder

Revision ID: f3a9c1d5e872
Revises: d7f2c94a1b08
Create Date: 2026-09-03

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3a9c1d5e872"
down_revision: str | None = "d7f2c94a1b08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nieuwe waarde voor het bestaande token_purpose-enum. Zelfde patroon als
    # eerder bij route_origin: ALTER TYPE ... ADD VALUE kan niet in hetzelfde
    # transactieblok samen met gebruik van die waarde, maar dat gebeurt hier
    # nergens.
    op.execute("ALTER TYPE token_purpose ADD VALUE IF NOT EXISTS 'telegram_link'")

    op.add_column("users", sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("telegram_username", sa.String(64), nullable=True))
    op.add_column(
        "users",
        sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_users_telegram_chat_id"),
        "users",
        ["telegram_chat_id"],
        unique=True,
    )

    op.add_column("rides", sa.Column("telegram_message_id", sa.BigInteger(), nullable=True))
    op.add_column(
        "rides",
        sa.Column("telegram_posted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "rides",
        sa.Column("organizer_reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rides", "organizer_reminder_sent_at")
    op.drop_column("rides", "telegram_posted_at")
    op.drop_column("rides", "telegram_message_id")

    op.drop_index(op.f("ix_users_telegram_chat_id"), table_name="users")
    op.drop_column("users", "telegram_linked_at")
    op.drop_column("users", "telegram_username")
    op.drop_column("users", "telegram_chat_id")
    # De enumwaarde 'telegram_link' blijft staan: Postgres kan een waarde niet
    # uit een enum verwijderen zonder het type te herbouwen.
