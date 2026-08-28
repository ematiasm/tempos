"""Add business settings sell config

Revision ID: 7be47fd522ed
Revises: 37ccb87265da
Create Date: 2026-08-28 17:49:34.920795

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7be47fd522ed'
down_revision = '37ccb87265da'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'businesssettings',
        sa.Column('sell_quick_method_ids', sa.JSON(), nullable=True),
    )
    op.add_column(
        'businesssettings',
        sa.Column('sell_default_document_type_id', sa.Uuid(), nullable=True),
    )
    op.add_column(
        'businesssettings',
        sa.Column('sell_default_customer_id', sa.Uuid(), nullable=True),
    )
    op.add_column(
        'businesssettings',
        sa.Column(
            'sell_block_price_edit',
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        'businesssettings',
        sa.Column(
            'sell_hide_date',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade():
    op.drop_column('businesssettings', 'sell_hide_date')
    op.drop_column('businesssettings', 'sell_block_price_edit')
    op.drop_column('businesssettings', 'sell_default_customer_id')
    op.drop_column('businesssettings', 'sell_default_document_type_id')
    op.drop_column('businesssettings', 'sell_quick_method_ids')
