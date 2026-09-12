"""Add a stable seed identity to document types

``DocumentType.name`` and ``DocumentType.prefix`` are both editable from the admin panel
(``PATCH /document-types/{id}``), yet code resolved seeded types by one or the other:
``suggest_fiscal_sale_type`` matched ``name == "Factura A"``, the buy screen matched
``prefix == "OC"`` and the stock screen ``prefix == "AJS"``. Renaming either broke those
paths, so the type gains a stable, non-editable ``key`` that code resolves instead.

The column is nullable on purpose: this migration runs over data a user may have renamed,
and the backfill matches by the *current* prefix, which is the only stable signal available.
A row that cannot be matched keeps a NULL key rather than guessing — the seed then adopts it
by prefix and then by name and fills the key in, so a migrated database converges without
inserting a duplicate. ``tests/api/routes/test_document_types.py`` asserts the seeded keys,
because Alembic autogenerate cannot see a seed change and ``alembic check`` stays silent.

Revision ID: f9b5dda6c3cd
Revises: 9337de9c4513
Create Date: 2026-09-12 01:20:20.925225

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = "f9b5dda6c3cd"
down_revision = "9337de9c4513"
branch_labels = None
depends_on = None

# Current prefix → stable key, mirroring SEED_DOCUMENT_TYPES in app/core/db.py.
SEEDED_KEYS: tuple[tuple[str, str], ...] = (
    ("FA", "factura_a"),
    ("FB", "factura_b"),
    ("FC", "factura_c"),
    ("TCK", "ticket"),
    ("COT", "cotizacion"),
    ("NCV", "nota_credito_venta"),
    ("NDV", "nota_debito_venta"),
    ("OC", "orden_compra"),
    ("NCC", "nc_compra"),
    ("NDC", "nd_compra"),
    ("RTO", "remito"),
    ("AJS", "ajuste_stock"),
    ("RC", "recibo_cobro"),
    ("RP", "recibo_pago"),
)


def upgrade() -> None:
    op.add_column(
        "documenttype",
        sa.Column(
            "key", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True
        ),
    )
    values = ", ".join(f"('{prefix}', '{key}')" for prefix, key in SEEDED_KEYS)
    op.execute(
        f"""
        UPDATE documenttype SET key = seeded.key
        FROM (VALUES {values}) AS seeded(prefix, key)
        WHERE documenttype.prefix = seeded.prefix
        """
    )
    op.create_index(op.f("ix_documenttype_key"), "documenttype", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_documenttype_key"), table_name="documenttype")
    op.drop_column("documenttype", "key")
