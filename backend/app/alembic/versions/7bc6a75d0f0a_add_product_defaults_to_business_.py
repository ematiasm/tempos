"""Add product defaults to business settings

Revision ID: 7bc6a75d0f0a
Revises: bb4805f80102
Create Date: 2026-09-06 12:07:37.002503

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7bc6a75d0f0a'
down_revision = 'bb4805f80102'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'businesssettings',
        sa.Column('default_margen_pct', sa.Numeric(precision=5, scale=2), nullable=True),
    )
    # server_default keeps the existing singleton row valid during the upgrade.
    op.add_column(
        'businesssettings',
        sa.Column('warn_below_cost', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'businesssettings',
        sa.Column('require_barcode', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'businesssettings',
        sa.Column('default_uom_id', sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        'fk_businesssettings_default_uom_id',
        'businesssettings',
        'uom',
        ['default_uom_id'],
        ['id'],
    )


def downgrade():
    op.drop_constraint(
        'fk_businesssettings_default_uom_id',
        'businesssettings',
        type_='foreignkey',
    )
    op.drop_column('businesssettings', 'default_uom_id')
    op.drop_column('businesssettings', 'require_barcode')
    op.drop_column('businesssettings', 'warn_below_cost')
    op.drop_column('businesssettings', 'default_margen_pct')
