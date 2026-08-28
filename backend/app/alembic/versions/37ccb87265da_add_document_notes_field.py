"""Add document notes field

Revision ID: 37ccb87265da
Revises: e655d2d1d2d1
Create Date: 2026-08-28 00:19:41.724245

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '37ccb87265da'
down_revision = 'e655d2d1d2d1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'document',
        sa.Column(
            'notes',
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column('document', 'notes')
