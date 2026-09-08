"""add_price_rounding_and_precio_neto

Revision ID: 05cf4ac88022
Revises: 7bc6a75d0f0a
Create Date: 2026-09-06 21:51:38.305195

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '05cf4ac88022'
down_revision = '7bc6a75d0f0a'
branch_labels = None
depends_on = None


def upgrade():
    # Two additive columns for the pricing chain (single conceptual change).
    # Plain string column (not a pg enum): enum types persist across
    # migrations and poison reuse (AGENTS.md §9).
    op.add_column(
        'businesssettings',
        sa.Column(
            'price_rounding', sa.String(length=20), nullable=False,
            server_default='none',
        ),
    )
    op.add_column(
        'product',
        sa.Column(
            'precio_neto', sa.Numeric(precision=12, scale=2), nullable=False,
            server_default='0',
        ),
    )


def downgrade():
    op.drop_column('product', 'precio_neto')
    op.drop_column('businesssettings', 'price_rounding')
