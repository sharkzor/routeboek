"""Deel-link voor privé-ritten: sleutel op rides en een gastentabel.

Revision ID: d7f2c94a1b08
Revises: c5a1e8b46d72
Create Date: 2026-09-03

Een privé-rit was voor buitenstaanders onvindbaar, ook als de link bewust met
hen gedeeld werd. Daardoor kon niemand zich op zo'n rit aanmelden. De sleutel
maakt de link bruikbaar; `ride_guests` onthoudt wie hem geopend heeft, zodat
de rit daarna gewoon in het overzicht van die persoon blijft staan.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d7f2c94a1b08"
down_revision = "c5a1e8b46d72"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Eerst zonder NOT NULL, zodat bestaande ritten een waarde kunnen krijgen.
    op.add_column("rides", sa.Column("share_token", sa.String(length=32), nullable=True))
    # `gen_random_uuid()` zit sinds Postgres 13 in de kern; geen pgcrypto nodig.
    op.execute(
        "UPDATE rides SET share_token = replace(gen_random_uuid()::text, '-', '') "
        "WHERE share_token IS NULL"
    )
    op.alter_column("rides", "share_token", nullable=False)
    op.create_unique_constraint("uq_rides_share_token", "rides", ["share_token"])

    op.create_table(
        "ride_guests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ride_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["ride_id"], ["rides.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ride_id", "user_id", name="uq_ride_guest"),
    )
    op.create_index("ix_ride_guests_ride_id", "ride_guests", ["ride_id"])
    op.create_index("ix_ride_guests_user_id", "ride_guests", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ride_guests_user_id", table_name="ride_guests")
    op.drop_index("ix_ride_guests_ride_id", table_name="ride_guests")
    op.drop_table("ride_guests")
    op.drop_constraint("uq_rides_share_token", "rides", type_="unique")
    op.drop_column("rides", "share_token")
