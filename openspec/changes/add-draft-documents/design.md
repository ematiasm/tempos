# Design: Add draft documents

## Context

`Document` is a single unified table whose entire behaviour is selected by its `DocumentType`
row. Three columns do the work:

| Column | Role |
|---|---|
| `operation` | Behaviour class: which reports, statement bucket and cash-session bucket the document belongs to |
| `signo_stock` | `0` → `_stock_movements_hook` returns immediately (no stock movement, no cache update) |
| `signo_caja` | `0` → `_financial_movements_hook` returns immediately (no account movement, no balance delta) |

`signs 0/0` is therefore already the system's "posts nothing" marker, and `Cotización` uses it
today. A draft needs no new posting mechanism; it needs the existing one plus a lifecycle.

The obstacle is identity. Two columns that the admin panel lets a user edit — `name` and
`prefix` — are still used as keys in four places, so today's editable-prefix feature can break
fiscal suggestion, the buy screen and stock adjustments.

## Architecture decisions

### 1. The draft is an operation, not a status

`DocumentStatus` stays `active | voided`. A draft is identified by
`document_type.operation == borrador`; the value is produced by
`ALTER TYPE documentoperation RENAME VALUE 'cotizacion' TO 'borrador'`, so the existing `COT`
row — with its data, its tests and its conversion — simply changes vocabulary.

*Alternative rejected:* `DocumentStatus.DRAFT` with posting deferred to a confirm step. It costs
an extra enum migration, a state machine, an exactly-once posting guard, moving the
cash-session requirement from creation to confirmation, and deciding what a confirmed-then-voided
draft means. It buys nothing here, because in this model a draft never becomes the posting
document: conversion creates a new one, exactly as `COT → invoice` does today.

*Consequence:* "draft" and "posted" are two different documents linked by `parent_document_id`,
not two states of one document. That is the Odoo-style note/receipt separation the codebase
already follows.

### 2. `DocumentType.key` is the identity, and it is seed-managed

```python
class DocumentType(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # Stable seed identity, never exposed by DocumentTypeUpdate.
    key: str | None = Field(default=None, unique=True, index=True, max_length=50)
    name: str = ...
    prefix: str = ...
```

Seeded keys: `factura_a`, `factura_b`, `factura_c`, `ticket`, `cotizacion`, `nota_credito_venta`,
`nota_debito_venta`, `orden_compra`, `nc_compra`, `nd_compra`, `remito`, `ajuste_stock`,
`recibo_cobro`, `recibo_pago`.

Nullability is deliberate: the migration runs over data a user may have renamed, and a migration
that fails on an unmatched row is worse than a row without a key. Convergence is handled by the
seed:

```text
seed(document_type):
  row = by_key(seed.key)
     or by_prefix(seed.prefix)      # legacy database, key not yet backfilled
     or insert(seed)
  if row.key is None: row.key = seed.key
```

*Why the column is required at all:* fiscal types A/B/C are indistinguishable by their immutable
columns (`operation`, signs, `es_fiscal`, `tipo_contraparte` are identical for all three), so no
combination of existing columns can identify them.

*Bonus fix:* the seed's idempotency is keyed on `prefix` today, so renaming a prefix makes the
next startup insert a duplicate. Matching by `key` removes that failure mode.

### 3. Drafts take no payments and no cash session

`_create_document_in_tx` stores `cash_session_id` for any document created while a session is
open, and accepts payments for any type. For `signo_caja == 0` that produces two artifacts with
no counterpart: payments that move no money and are still counted as *egresos* by
`cash_session_report` (it buckets by `signo > 0`), and session links on documents that have no
cash effect. Both are closed by an explicit guard on `operation == borrador`.

### 4. Conversion is one generic operation

```text
POST /documents/{id}/convert
  body: { lines?: [{ line_id, cantidad }] }   # omitted = convert everything

source.operation must be borrador, source active
  target = supplier draft → purchase type            (by key: orden_compra)
         | customer draft → suggest_fiscal_sale_type (by key: factura_a/b/c)

customer: 1:1 copy, reject when an ACTIVE child exists     (today's rule)
supplier: per line, cantidad defaults to the pending quantity,
          reject cantidad > pending, children accumulate
```

`_attach_counterpart_names` currently builds `child_map = {parent: (id, numero)}`, so with two
children the last one wins and the singular `child_document_id` silently lies. It becomes a
`children` list plus the per-line pending quantity, with `child_document_id` kept for the 1:1
customer case.

### 5. Editability is a property of the draft, guarded by the absence of children

`PUT /documents/{id}` replaces counterpart, date, discount, notes and lines, recomputing totals
with the **same** rules as creation. To avoid a second copy of that arithmetic,
`_create_document_in_tx` has its line/tax/total computation extracted into a reusable helper —
as a pure refactor with the suite green before any behaviour is added.

Row locking and the child check happen inside the transaction, so a concurrent conversion cannot
slip a child under an edit. Deletion is physical and relies on the self-referencing foreign keys
(`parent_document_id`, `parent_line_id`): a draft with any child is refused with a business
error rather than surfacing an integrity error.

```text
PUT /documents/{id}                 DELETE /documents/{id}
  lock document row                   lock document row
  estado == active                    estado == active
  operation == borrador               operation == borrador
  no children (any state)             no children (any state)
  → recompute + replace lines         → delete (lines/taxes cascade)
```

## Data flow

### Draft with partial deliveries

```text
Pedido de Compra (borrador, 0/0, PED)        Compra (compra, +1/-1, OC)
   10 units ──────────── receive 8 ─────────▶ child, ACTIVE, numero 2026-OC-00000009
          └───────────── receive 2 ─────────▶ child, ACTIVE, numero 2026-OC-00000010
   pending per line = ordered − Σ active children = 0
   keeps its own number; can never be edited again (has children)
```

Only the children post: stock in and cash/counterpart balance come from each `Compra`, which is
why partial deliveries need no change to the ledger hooks at all.

### Permissions

`document.update` and `document.delete` join `SEED_PERMISSIONS`; the existing `init_db` sync
grants new permissions to the `Administrador` role on the next startup, so no data migration is
needed.

## File changes

| File | Change |
|---|---|
| `backend/app/models.py` | `DocumentType.key`; `DocumentOperation.BORRADOR`; `DocumentTypePublic.key`; `DocumentChildrenPublic` / per-line `cantidad_pendiente`; permissions are in `core/db.py` |
| `backend/app/alembic/versions/<new>.py` | `RENAME VALUE 'cotizacion' TO 'borrador'`; add + backfill `key`; unique index |
| `backend/app/core/db.py` | Seed tuples gain `key`; seed matches by `key`; `VOID_TYPE_MIRROR` keyed by `key`; `Orden de Compra` → `Compra` backfill; two new permissions |
| `backend/app/crud.py` | Extract the line/tax/total computation; draft guards; `update_document`; `delete_document`; `convert_document`; key-based `suggest_fiscal_sale_type`; pending-quantity helper |
| `backend/app/api/routes/documents.py` | `PUT /`, `DELETE /{id}`, `POST /{id}/convert`; `children` in the payload; `convert-to-invoice` kept as an alias |
| `backend/app/api/routes/document_types.py` | Reject `key` in the PATCH body |
| `frontend/src/components/Documents/*` | Edit and delete actions, "Recibir" with pending quantities, borrador vocabulary |
| `frontend/src/routes/_layout/{buy,stock}.tsx` | Resolve types by `key`, not by `prefix` |
| `openspec/specs/documents/spec.md` | Synced from this delta at archive time |

## Tests

Strict TDD is enabled (`openspec/config.yaml`), so each unit starts from a failing test that
names the behaviour, then the smallest implementation that passes, then triangulation.

| Layer | File | Covers |
|---|---|---|
| Integration (FastAPI + real Postgres) | `tests/api/routes/test_document_types.py` | Rename-proof identity: fiscal suggestion, purchase type, re-seed without duplication, `key` not editable |
| Integration | `tests/api/routes/test_document_convert.py` | Generic conversion, alias, 1:1 rule, partial reception, pending quantity, voided delivery returns quantity |
| Integration | `tests/api/routes/test_document_drafts.py` (new) | No stock/cash movement, no payments, no session link, edit, delete, immutability with a child |
| Unit | `tests/crud/test_schema_invariants.py` | Enum value present after the rename (the guard Alembic autogenerate cannot provide) |

Runner: `cd backend && uv run pytest tests/api/routes/test_<module>.py -x` per cycle, and
`cd backend && bash scripts/test.sh` for verification. Tests need the compose database up and
are not parallel-safe.

## Rollout

Four stacked PRs to `main`, in order, each green and reviewable on its own:

1. **PR 0 — stable document-type identity.** Prerequisite for the feature, and independently
   valuable: it makes the already-shipped editable-prefix feature safe.
2. **PR 1 — the draft axis.** Enum rename, guards, edit/delete, generic conversion, the
   extraction refactor.
3. **PR 2 — Pedido de Compra and partial reception.** Seed, per-line pending quantity, the
   `children` payload fix, the `OC` → `Compra` rename.
4. **PR 3 — Cotización de venta** on the already-proven axis.

If PR 1 approaches the 400-line budget it splits at the natural seam: 1a (enum + guards,
backend only) and 1b (endpoints + generic conversion + frontend).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ALTER TYPE ... RENAME VALUE` inside the migration transaction | Verify on the compose database; `autocommit_block` if Postgres rejects it. A test asserts the seeded row's operation value, since autogenerate cannot |
| The extraction refactor silently changes totals | Pure refactor first: the existing document suite must stay green before any behaviour change |
| Multiple active children break the singular child contract | Explicit `children` list + pending quantity, tested with two deliveries |
| A legacy database with a renamed prefix gets a NULL `key` | The seed backfills by prefix then name and never inserts a duplicate; the migration never fails |
| Drafts polluting the daily arqueo | Guard on `cash_session_id` plus a test asserting it stays NULL |
| A `PUT` racing a conversion | Both lock the document row and re-check the child condition inside the transaction |
