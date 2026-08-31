"""windrichting geschat-vlag

Revision ID: 4a9b2f6e1c3d
Revises: d37b8ce74240
Create Date: 2026-08-31 16:50:00.000000+02:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '4a9b2f6e1c3d'
down_revision: str | None = 'd37b8ce74240'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'routes',
        sa.Column(
            'wind_estimated',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # server_default was alleen nodig om bestaande rijen te vullen.
    op.alter_column('routes', 'wind_estimated', server_default=None)


def downgrade() -> None:
    op.drop_column('routes', 'wind_estimated')
