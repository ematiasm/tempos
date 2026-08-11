"""Add favor_monto to Document

Revision ID: f96e2178c3b2
Revises: 37543f24f0f0
Create Date: 2026-08-09 12:31:54.974252

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'f96e2178c3b2'
down_revision = '37543f24f0f0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'document',
        sa.Column(
            'favor_monto',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            server_default=sa.text('0'),
        ),
    )


def downgrade():
    op.drop_column('document', 'favor_monto')
