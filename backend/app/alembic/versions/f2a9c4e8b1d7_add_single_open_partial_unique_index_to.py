"""Add single-open partial unique index to cashregistersession

Only one CashRegisterSession may be OPEN at a time. The friendly
check-then-insert in `crud.open_cash_session` is race-prone under
concurrent opens; this DB-level guarantee closes that gap.

Revision ID: f2a9c4e8b1d7
Revises: 790f83bd8af0
Create Date: 2026-08-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a9c4e8b1d7"
down_revision: str | None = "790f83bd8af0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Unique on (status) restricted to OPEN rows: every OPEN row shares the
    # same key, so at most one can exist; CLOSED rows are excluded by the
    # predicate and remain unlimited.
    op.create_index(
        "uq_cashregistersession_single_open",
        "cashregistersession",
        ["status"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_cashregistersession_single_open", table_name="cashregistersession"
    )
