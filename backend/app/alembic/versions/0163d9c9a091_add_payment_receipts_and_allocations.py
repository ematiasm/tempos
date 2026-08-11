"""Add payment receipts and document payment allocations

Adds the ``recibo`` value to the ``documentoperation`` enum and creates the
``documentpaymentallocation`` link table (receipt document -> settled
document).

Revision ID: 0163d9c9a091
Revises: d287f6ecc79f
Create Date: 2026-08-07 20:49:15

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '0163d9c9a091'
down_revision = 'd287f6ecc79f'
branch_labels = None
depends_on = None


def upgrade():
    # The new enum value must not be USED in this same transaction; the RC/RP
    # document types are seeded by init_db right after migrations apply.
    op.execute("ALTER TYPE documentoperation ADD VALUE 'RECIBO'")
    op.create_table('documentpaymentallocation',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('receipt_document_id', sa.Uuid(), nullable=False),
    sa.Column('document_id', sa.Uuid(), nullable=False),
    sa.Column('monto', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['document_id'], ['document.id'], ),
    sa.ForeignKeyConstraint(['receipt_document_id'], ['document.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_documentpaymentallocation_document_id'), 'documentpaymentallocation', ['document_id'], unique=False)
    op.create_index(op.f('ix_documentpaymentallocation_receipt_document_id'), 'documentpaymentallocation', ['receipt_document_id'], unique=False)


def downgrade():
    # Postgres cannot remove an enum value; 'RECIBO' stays but is unused.
    op.drop_index(op.f('ix_documentpaymentallocation_receipt_document_id'), table_name='documentpaymentallocation')
    op.drop_index(op.f('ix_documentpaymentallocation_document_id'), table_name='documentpaymentallocation')
    op.drop_table('documentpaymentallocation')
