"""Add a stable seed identity to document types

``DocumentType.name`` and ``DocumentType.prefix`` are both editable from the admin panel
(``PATCH /document-types/{id}``), yet code resolved seeded types by one or the other:
``suggest_fiscal_sale_type`` matched ``name == "Factura A"``, the buy screen matched
``prefix == "OC"`` and the stock screen ``prefix == "AJS"``. Renaming either broke those
paths, so the type gains a stable, non-editable ``key`` that code resolves instead.

The column is nullable on purpose: this migration runs over data a user may have renamed.
Matching by the *current* prefix is not enough to backfill it, because the old seed matched
rows by prefix too — so a rename made the next startup insert a **duplicate** of the seeded
type, and the prefix a seed expects can now be held by that duplicate. Stamping the key by
prefix alone would therefore label the duplicate as the seed, and since the runtime seed
resolves a type by key first, nothing would ever repair it: the real row would keep a NULL
key, its documents and its numbering would sit on one row while new documents went to the
other. The backfill ranks candidates with ``resolve_seed_candidate`` instead, which prefers
the row **in service** — the one a document or a numbering sequence points at — before
falling back to the prefix and then the name. A row nothing claims keeps a NULL key; the
runtime seed adopts it later.

``tests/core/test_document_type_seed.py`` covers the ranking, because Alembic autogenerate
cannot see a seed change and ``alembic check`` stays silent.

Revision ID: f9b5dda6c3cd
Revises: 9337de9c4513
Create Date: 2026-09-12 01:20:20.925225

"""

from typing import NamedTuple

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

from app.core.document_type_seed import ResolvableRow, resolve_seed_candidate


class _FrozenSeed(NamedTuple):
    """The seed shape the rule reads, so this revision does not import the live table."""

    key: str
    name: str
    prefix: str


# revision identifiers, used by Alembic.
revision = "f9b5dda6c3cd"
down_revision = "9337de9c4513"
branch_labels = None
depends_on = None

# A type is in service when it has issued a number or carries a document. The void mirror is
# deliberately excluded: the old wiring matched by prefix, so it may have landed on a
# duplicate and would then point at the wrong row.
# Frozen copy of the seeded identities as of this revision. A migration must reproduce its
# own behaviour forever, so it does not import the seed table from the application: a type
# added later gets its own seed at runtime and needs no backfill.
SEEDED_IDENTITIES: tuple[tuple[str, str, str], ...] = (
    ("factura_a", "Factura A", "FA"),
    ("factura_b", "Factura B", "FB"),
    ("factura_c", "Factura C", "FC"),
    ("ticket", "Ticket", "TCK"),
    ("cotizacion", "Cotización", "COT"),
    ("nota_credito_venta", "Nota de Crédito", "NCV"),
    ("nota_debito_venta", "Nota de Débito", "NDV"),
    ("orden_compra", "Orden de Compra", "OC"),
    ("nc_compra", "NC Compra", "NCC"),
    ("nd_compra", "ND Compra", "NDC"),
    ("remito", "Remito", "RTO"),
    ("ajuste_stock", "Ajuste Stock", "AJS"),
    ("recibo_cobro", "Recibo de Cobro", "RC"),
    ("recibo_pago", "Recibo de Pago", "RP"),
)


ROWS_IN_SERVICE = """
SELECT dt.id,
       dt.name,
       dt.prefix,
       EXISTS (SELECT 1 FROM document d WHERE d.document_type_id = dt.id)
    OR EXISTS (SELECT 1 FROM documentsequence q WHERE q.document_type_id = dt.id)
       AS in_service
FROM documenttype dt
"""


def upgrade() -> None:
    op.add_column(
        "documenttype",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
    )
    connection = op.get_bind()
    rows = connection.execute(sa.text(ROWS_IN_SERVICE)).all()
    by_id = {row.id: row for row in rows}
    resolvable = [
        ResolvableRow(row.id, row.name, row.prefix, bool(row.in_service))
        for row in rows
    ]
    # A row may claim more than one seed only through a pathological rename; assigning one
    # key per row keeps the first claim and leaves the other seed to the runtime.
    assigned: set[object] = set()
    for key, name, prefix in SEEDED_IDENTITIES:
        candidate = resolve_seed_candidate(
            _FrozenSeed(key=key, name=name, prefix=prefix), resolvable
        )
        if candidate is None or candidate.id in assigned:
            continue
        assigned.add(candidate.id)
        connection.execute(
            sa.text("UPDATE documenttype SET key = :key WHERE id = :id"),
            {"key": key, "id": by_id[candidate.id].id},
        )
    op.create_index(op.f("ix_documenttype_key"), "documenttype", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_documenttype_key"), table_name="documenttype")
    op.drop_column("documenttype", "key")
