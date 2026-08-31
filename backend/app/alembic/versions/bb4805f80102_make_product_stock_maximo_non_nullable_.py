"""Make product stock_maximo non nullable with minimo check

Revision ID: bb4805f80102
Revises: 7cc8efa21403
Create Date: 2026-08-30 23:36:04.380713

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bb4805f80102'
down_revision = '7cc8efa21403'
branch_labels = None
depends_on = None


def upgrade():
    # Neutral backfill: a product without a maximum now fills up to its
    # minimum (max == min keeps today's "order up to the minimum" semantics);
    # with no minimum either it defaults to 0.
    op.execute(
        "UPDATE product SET stock_maximo = COALESCE(stock_minimo, 0) "
        "WHERE stock_maximo IS NULL"
    )
    op.alter_column(
        'product',
        'stock_maximo',
        existing_type=sa.NUMERIC(precision=12, scale=3),
        nullable=False,
    )
    # A NULL minimum must pass (explicit IS NULL branch; note a bare
    # "stock_maximo >= stock_minimo" would also pass on NULL via SQL
    # three-valued logic, but being explicit documents the intent).
    op.create_check_constraint(
        'ck_product_stock_maximo_gte_minimo',
        'product',
        'stock_minimo IS NULL OR stock_maximo >= stock_minimo',
    )


def downgrade():
    op.drop_constraint(
        'ck_product_stock_maximo_gte_minimo', 'product', type_='check'
    )
    op.alter_column(
        'product',
        'stock_maximo',
        existing_type=sa.NUMERIC(precision=12, scale=3),
        nullable=True,
    )
