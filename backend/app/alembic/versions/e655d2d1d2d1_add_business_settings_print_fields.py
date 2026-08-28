"""Add business settings print fields

Revision ID: e655d2d1d2d1
Revises: f2a9c4e8b1d7
Create Date: 2026-08-28 00:15:47.007136

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'e655d2d1d2d1'
down_revision = 'f2a9c4e8b1d7'
branch_labels = None
depends_on = None


def upgrade():
    printformat = sa.Enum('A4', 'TICKET80', name='printformat')
    printformat.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'businesssettings',
        sa.Column(
            'default_print_format',
            printformat,
            nullable=False,
            server_default='A4',
        ),
    )
    op.add_column(
        'businesssettings',
        sa.Column(
            'voucher_footer',
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        'businesssettings',
        sa.Column(
            'voucher_legends',
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column('businesssettings', 'voucher_legends')
    op.drop_column('businesssettings', 'voucher_footer')
    op.drop_column('businesssettings', 'default_print_format')
    # PostgreSQL enum types persist across migrations; drop them explicitly so
    # a downgrade + re-upgrade does not fail with "type already exists".
    sa.Enum(name='printformat').drop(op.get_bind(), checkfirst=True)
