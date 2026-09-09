"""Drop number_format from business settings

Revision ID: 41820b782d4f
Revises: d61ddf38636a
Create Date: 2026-09-09 00:34:06.093158

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '41820b782d4f'
down_revision = 'd61ddf38636a'
branch_labels = None
depends_on = None


def upgrade():
    # Number formatting is now derived from the business default locale.
    op.drop_column('businesssettings', 'number_format')
    sa.Enum(name='numberformat').drop(op.get_bind(), checkfirst=True)


def downgrade():
    numberformat = postgresql.ENUM('ES', 'EN', name='numberformat', create_type=False)
    numberformat.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'businesssettings',
        sa.Column('number_format', numberformat, server_default='EN', nullable=False),
    )
