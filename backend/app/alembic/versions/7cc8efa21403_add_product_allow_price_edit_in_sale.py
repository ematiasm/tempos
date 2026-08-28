"""Add product allow price edit in sale

Revision ID: 7cc8efa21403
Revises: 7be47fd522ed
Create Date: 2026-08-28 17:49:35.318705

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7cc8efa21403'
down_revision = '7be47fd522ed'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'product',
        sa.Column(
            'allow_price_edit_in_sale',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade():
    op.drop_column('product', 'allow_price_edit_in_sale')
