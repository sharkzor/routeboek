"""reacties en waarderingen per route

Revision ID: 7c1d9a4e2b5f
Revises: 4a9b2f6e1c3d
Create Date: 2026-08-31 17:30:00.000000+02:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '7c1d9a4e2b5f'
down_revision: str | None = '4a9b2f6e1c3d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('routes', sa.Column('legacy_rating', sa.Float(), nullable=True))
    op.add_column(
        'routes',
        sa.Column(
            'legacy_rating_count',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
    )
    op.alter_column('routes', 'legacy_rating_count', server_default=None)
    # Bevries de huidige (gescrapete) waardering als legacy-baseline. De
    # volgende `python -m app.seed` zet 'm nogmaals expliciet vanuit het
    # seedbestand; dit is puur zodat bestaande rijen meteen consistent zijn.
    op.execute(
        "UPDATE routes SET legacy_rating = rating, "
        "legacy_rating_count = rating_count"
    )

    op.create_table(
        'route_ratings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('route_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('route_id', 'user_id', name='uq_route_rating_user'),
    )
    op.create_index(
        op.f('ix_route_ratings_route_id'), 'route_ratings', ['route_id'], unique=False
    )
    op.create_index(
        op.f('ix_route_ratings_user_id'), 'route_ratings', ['user_id'], unique=False
    )

    op.create_table(
        'route_comments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('route_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_route_comments_route_id'), 'route_comments', ['route_id'], unique=False
    )
    op.create_index(
        op.f('ix_route_comments_user_id'), 'route_comments', ['user_id'], unique=False
    )
    op.create_index(
        op.f('ix_route_comments_created_at'), 'route_comments', ['created_at'], unique=False
    )


def downgrade() -> None:
    op.drop_table('route_comments')
    op.drop_table('route_ratings')
    op.drop_column('routes', 'legacy_rating_count')
    op.drop_column('routes', 'legacy_rating')
