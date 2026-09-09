"""Add voucher print margin settings

Revision ID: c9719855c36c
Revises: 41820b782d4f
Create Date: 2026-09-09 14:14:59.275116

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c9719855c36c'
down_revision = '41820b782d4f'
branch_labels = None
depends_on = None


def upgrade():
    # Uniform page margins (mm) for the voucher print profiles; existing rows
    # adopt the previous hardcoded @page margins (12mm A4, 4mm ticket).
    op.add_column(
        'businesssettings',
        sa.Column('print_margin_a4_mm', sa.Integer(), nullable=False, server_default='12'),
    )
    op.add_column(
        'businesssettings',
        sa.Column('print_margin_ticket_mm', sa.Integer(), nullable=False, server_default='4'),
    )


def downgrade():
    op.drop_column('businesssettings', 'print_margin_ticket_mm')
    op.drop_column('businesssettings', 'print_margin_a4_mm')
