"""Drop restorestatus table

Restore progress now lives in a state file under the backup directory (the
database itself is dropped during a restore, so it cannot be the source of
truth). The table and its enum type are removed.

Revision ID: 37543f24f0f0
Revises: 78485ea2f66a
Create Date: 2026-08-09 01:02:25.765613

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '37543f24f0f0'
down_revision = '78485ea2f66a'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('restorestatus')
    # PostgreSQL enum types persist across migrations; drop it explicitly so
    # future autogenerate runs do not see the stale type.
    sa.Enum(name='restorestate').drop(op.get_bind(), checkfirst=True)


def downgrade():
    # Recreate the enum and the singleton table exactly as 78485ea2f66a
    # created them.
    restorestate = sa.Enum('IDLE', 'RUNNING', 'SUCCESS', 'FAILED', name='restorestate')
    restorestate.create(op.get_bind(), checkfirst=True)
    op.create_table('restorestatus',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('estado', sa.Enum('IDLE', 'RUNNING', 'SUCCESS', 'FAILED', name='restorestate'), nullable=False),
    sa.Column('source_filename', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('error', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
