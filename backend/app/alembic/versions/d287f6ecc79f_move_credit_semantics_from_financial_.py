"""Move credit semantics from financial accounts to payment methods

Adds ``paymentmethod.marks_paid`` (backfilled from the current-account
financial account types) and removes ``financialaccount.tipo`` together with
the ``financialaccounttype`` enum.

Revision ID: d287f6ecc79f
Revises: c024b6603c1f
Create Date: 2026-08-07 16:30:28.205061

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'd287f6ecc79f'
down_revision = 'c024b6603c1f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'paymentmethod',
        sa.Column(
            'marks_paid', sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    # Existing methods anchored to current-account types keep their behavior.
    op.execute(
        """
        UPDATE paymentmethod
        SET marks_paid = FALSE
        WHERE financial_account_id IN (
            SELECT id FROM financialaccount
            WHERE tipo IN ('CUENTA_CLIENTE', 'CUENTA_PROVEEDOR')
        )
        """
    )
    op.drop_column('financialaccount', 'tipo')
    postgresql.ENUM(name='financialaccounttype').drop(
        op.get_bind(), checkfirst=True
    )


def downgrade():
    postgresql.ENUM(
        'EFECTIVO', 'BANCO', 'TARJETA', 'DIGITAL',
        'CUENTA_CLIENTE', 'CUENTA_PROVEEDOR',
        name='financialaccounttype',
        create_type=False,
    ).create(op.get_bind(), checkfirst=True)
    op.add_column(
        'financialaccount',
        sa.Column('tipo', postgresql.ENUM(
            'EFECTIVO', 'BANCO', 'TARJETA', 'DIGITAL',
            'CUENTA_CLIENTE', 'CUENTA_PROVEEDOR',
            name='financialaccounttype',
            create_type=False,
        ), nullable=True),
    )
    op.execute(
        """
        UPDATE financialaccount
        SET tipo = CASE
            WHEN EXISTS (
                SELECT 1 FROM paymentmethod
                WHERE paymentmethod.financial_account_id = financialaccount.id
                  AND paymentmethod.marks_paid = FALSE
            ) THEN 'CUENTA_CLIENTE'
            ELSE 'EFECTIVO'
        END
        """
    )
    op.alter_column('financialaccount', 'tipo', nullable=False)
    op.drop_column('paymentmethod', 'marks_paid')
