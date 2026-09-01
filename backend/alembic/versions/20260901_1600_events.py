"""events: evenementen en deelnemers

Revision ID: b3f7d2a91c6e
Revises: 9e2a7c1f4d68
Create Date: 2026-09-01 16:00:00.000000+02:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = 'b3f7d2a91c6e'
down_revision: str | None = '9e2a7c1f4d68'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

event_type = PGEnum(
    'sportive', 'race', 'multiday', 'gravel', 'other', name='event_type', create_type=False
)
transport_mode = PGEnum(
    'car', 'train', 'own_transport', 'bike', name='transport_mode', create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    event_type.create(bind, checkfirst=True)
    transport_mode.create(bind, checkfirst=True)

    op.create_table(
        'events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('event_type', event_type, nullable=False),
        sa.Column('route_id', sa.Integer(), nullable=True),
        sa.Column('event_date', sa.Date(), nullable=False),
        sa.Column('event_time', sa.Time(), nullable=True),
        sa.Column('url', sa.String(length=500), nullable=True),
        sa.Column('cost_eur', sa.Float(), nullable=True),
        sa.Column('distance_km', sa.Float(), nullable=True),
        sa.Column('speed_kmh', sa.Float(), nullable=True),
        sa.Column('max_participants', sa.Integer(), nullable=False),
        sa.Column('notes_html', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_events_event_date'), 'events', ['event_date'], unique=False)
    op.create_index(op.f('ix_events_route_id'), 'events', ['route_id'], unique=False)

    op.create_table(
        'event_participants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('transport', transport_mode, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('event_id', 'user_id', name='uq_event_user'),
    )
    op.create_index(
        op.f('ix_event_participants_event_id'), 'event_participants', ['event_id'], unique=False
    )
    op.create_index(
        op.f('ix_event_participants_user_id'), 'event_participants', ['user_id'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_event_participants_user_id'), table_name='event_participants')
    op.drop_index(op.f('ix_event_participants_event_id'), table_name='event_participants')
    op.drop_table('event_participants')
    op.drop_index(op.f('ix_events_route_id'), table_name='events')
    op.drop_index(op.f('ix_events_event_date'), table_name='events')
    op.drop_table('events')

    bind = op.get_bind()
    transport_mode.drop(bind, checkfirst=True)
    event_type.drop(bind, checkfirst=True)
