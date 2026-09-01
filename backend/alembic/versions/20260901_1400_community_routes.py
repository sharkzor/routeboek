"""community routes: origin, upvotes

Revision ID: 9e2a7c1f4d68
Revises: 7c1d9a4e2b5f
Create Date: 2026-09-01 14:00:00.000000+02:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '9e2a7c1f4d68'
down_revision: str | None = '7c1d9a4e2b5f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

route_origin = sa.Enum('official', 'community', name='route_origin')


def upgrade() -> None:
    route_origin.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'routes',
        sa.Column(
            'origin', route_origin, nullable=False, server_default='official'
        ),
    )
    op.alter_column('routes', 'origin', server_default=None)
    op.add_column(
        'routes',
        sa.Column('upvote_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.alter_column('routes', 'upvote_count', server_default=None)

    op.create_table(
        'route_upvotes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('route_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('route_id', 'user_id', name='uq_route_upvote_user'),
    )
    op.create_index(
        op.f('ix_route_upvotes_route_id'), 'route_upvotes', ['route_id'], unique=False
    )
    op.create_index(
        op.f('ix_route_upvotes_user_id'), 'route_upvotes', ['user_id'], unique=False
    )


def downgrade() -> None:
    op.drop_table('route_upvotes')
    op.drop_column('routes', 'upvote_count')
    op.drop_column('routes', 'origin')
    route_origin.drop(op.get_bind(), checkfirst=True)
