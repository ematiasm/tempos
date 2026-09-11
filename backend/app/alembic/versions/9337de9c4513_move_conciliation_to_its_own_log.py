"""Move conciliation to its own append-only log

Conciliating an account movement used to flip ``accountmovement.conciliado``, which
made the finance ledger the one ledger that had to stay mutable. The append-only
guard turned that into a hard failure, and the honest fix is to stop mutating the
ledger at all: a movement now counts as conciliated when the ``conciliation`` table
holds a row for it, and that table joins the guard.

Backfill keeps the original provenance: the conciliation is attributed to the user who
created the movement, at the movement's own creation time, because that is the only
evidence the previous boolean left behind.

Revision ID: 9337de9c4513
Revises: 1809708fd773
Create Date: 2026-09-10 21:16:58.935869

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9337de9c4513"
down_revision = "1809708fd773"
branch_labels = None
depends_on = None

GUARD_TRIGGER = "trg_ledger_immutable"
GUARD_FUNCTION = "tempos_reject_ledger_mutation"

BACKFILL = """
INSERT INTO conciliation (id, account_movement_id, user_id, conciliated_at)
SELECT gen_random_uuid(), id, user_id, COALESCE(created_at, now())
FROM accountmovement
WHERE conciliado IS TRUE
"""


def upgrade() -> None:
    op.create_table(
        "conciliation",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_movement_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("conciliated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_movement_id"], ["accountmovement.id"], ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_conciliation_account_movement_id"),
        "conciliation",
        ["account_movement_id"],
        unique=True,
    )
    op.execute(BACKFILL)
    op.drop_column("accountmovement", "conciliado")
    # The log is append-only like the ledgers it belongs to. The function was created
    # by 1809708fd773, which always runs first.
    op.execute(f"DROP TRIGGER IF EXISTS {GUARD_TRIGGER} ON conciliation")
    op.execute(
        f"CREATE TRIGGER {GUARD_TRIGGER} BEFORE UPDATE OR DELETE ON conciliation "
        f"FOR EACH ROW EXECUTE FUNCTION {GUARD_FUNCTION}()"
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {GUARD_TRIGGER} ON conciliation")
    op.add_column(
        "accountmovement",
        sa.Column(
            "conciliado", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    # Repopulating the flag means writing to a guarded table, so user triggers are
    # disabled for this transaction only (superuser-only, cleared at commit).
    op.execute("SET LOCAL session_replication_role = replica")
    op.execute(
        """
        UPDATE accountmovement
        SET conciliado = TRUE
        WHERE id IN (SELECT account_movement_id FROM conciliation)
        """
    )
    op.alter_column("accountmovement", "conciliado", server_default=None)
    op.drop_index(op.f("ix_conciliation_account_movement_id"), table_name="conciliation")
    op.drop_table("conciliation")
