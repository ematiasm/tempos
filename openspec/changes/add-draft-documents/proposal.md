# Proposal: Add draft documents (Pedido de Compra and Cotización)

## Intent

The store needs two **non-binding** documents: a purchase request that later becomes a
purchase, and a sales quote offered to a customer. Today the system has exactly one such
document — `Cotización` (`COT`, `operation = cotizacion`, signs `0/0`) — and it converts to a
fiscal invoice in one step. What is missing is the purchase-side mirror and, for both, a
document that can be shaped before it commits anything.

Two facts about the current model shape this proposal:

1. **The whole behaviour of a document is decided by its `DocumentType` row.**
   `signo_stock`/`signo_caja` decide whether the ledger hooks run at all
   (`crud._stock_movements_hook`, `crud._financial_movements_hook`); `operation` decides which
   report, statement bucket and cash-session bucket the document lands in. `signs 0/0` is
   already the system's way of saying "this document must not touch anything", so a draft does
   not need a new mechanism: it needs a type that does not post.
2. **`name` and `prefix` are editable from the admin panel** (`EditDocumentType.tsx` →
   `PATCH /document-types/{id}`, which accepts both, plus `is_active`). But four code paths
   still identify a seeded type by `name` or `prefix`: `crud.suggest_fiscal_sale_type`
   (`name == "Factura A/B/C"`), `buy.tsx` (`prefix == "OC"`), `stock.tsx` (`prefix == "AJS"`)
   and `core/db.py`'s `VOID_TYPE_MIRROR` (keyed by prefix). So the advertised feature is a
   loaded gun: renaming `Factura A` breaks fiscal suggestion, renaming `OC` breaks the buy
   screen. The repository already knows the correct pattern — `customers.py` refuses to rename
   the seeded `Consumidor Final` because "renaming it would break every protection keyed on
   that name" — it is simply missing for `DocumentType`. Adding the purchase draft on top of
   this would repeat the mistake, so the identity fix lands first.

## Agreed decisions (binding for spec)

1. **A draft is a document type that does not post, not a new document status.** The new
   operation value is `borrador` (renamed in place from `cotizacion`), used with
   `signo_stock = 0` and `signo_caja = 0`. `DocumentStatus` stays `active | voided`; no
   `draft` state and no `documentstatus` migration.
2. **`DocumentType` gains a stable, non-editable `key`.** Code resolves document types by
   `key` (or by `operation` + `tipo_contraparte`), never by `name` or `prefix`. The seed
   matches rows by `key` and backfills a missing one from the current `prefix`/`name`, so a
   migrated database converges without duplicating a renamed type.
3. **Drafts are editable and hard-deletable while they are childless.** Permission
   `document.update` guards `PUT /documents/{id}`; `document.delete` guards
   `DELETE /documents/{id}`. A draft with any child (active or voided) becomes immutable and
   follows the normal void/credit-note path. Posted documents keep today's rule: no editing.
4. **Drafts take no payments and no cash session.** The backend MUST reject `payments` for a
   draft and MUST leave `cash_session_id` NULL. Today a `Cotización` accepts payments that move
   nothing and still surface as *egresos* in the cash-session method table
   (`crud.cash_session_report` buckets by `signo > 0`), which is a reconciliation bug.
5. **Drafts are numbered when created**, like `COT` today. Gaps are expected and already
   specified, so `numero` stays NOT NULL and no provisional numbering is introduced.
6. **Conversion resolves the target from `operation` + `tipo_contraparte`.** A customer draft
   converts to the fiscal type suggested by the tax condition; a supplier draft converts to the
   purchase type. `POST /documents/{id}/convert-to-invoice` stays as an alias.
7. **A purchase order is received in partial deliveries.** A `Pedido de Compra` stays active
   and produces several active children until it is covered; the pending quantity per line is
   `ordered − received by active children`, reusing the exact validation shape of partial
   voiding (`crud.get_line_voided_quantities` + `DocumentLine.parent_line_id`). A customer
   quote stays 1:1 as today.
8. **Types seeded**: `Pedido de Compra` (`PED`, `borrador`, `0/0`, supplier) and the existing
   `Cotización` (`COT`, now `borrador`, `0/0`, customer). Neither carries a void mirror: a draft
   has nothing to revert, so it is edited or deleted instead of voided.
9. **`Orden de Compra` is renamed to `Compra`** (display `name` only; `prefix` `OC` untouched),
   because once a real purchase order exists, "Orden de Compra" for the document that posts
   stock and cash is misleading. Applied in the seed plus an idempotent backfill for existing
   databases.
10. **The domain vocabulary stays Spanish.** `borrador` was chosen over `draft` to keep each
    enum internally consistent (`venta | compra | borrador | ajuste | recibo`), which is the
    only convention the enums actually follow. A future migration of the whole vocabulary to
    English is recorded as deliberate debt, to be done one enum per change.

## Scope

### In Scope

- `DocumentType.key` (model, migration, seed, backfill) and the removal of every `name`/`prefix`
  match in backend and frontend.
- `DocumentOperation.BORRADOR` via `ALTER TYPE ... RENAME VALUE 'cotizacion' TO 'borrador'`.
- Draft guards: no payments, no cash session, editability and deletion while childless.
- `PUT /documents/{id}`, `DELETE /documents/{id}` and the generic
  `POST /documents/{id}/convert`, with permissions `document.update` and `document.delete`.
- `Pedido de Compra` seed, partial reception with per-line pending quantity, and the
  `child_document_id` fix required by multiple active children.
- The `documents` spec delta, tests, and the frontend surface (edit/delete/receive on the
  document detail sheet).

### Out of Scope

- **Stock reservation or commitment by a draft.** A draft moves nothing; whether a quote
  should commit stock is a separate product decision.
- **Amending a posted document.** Editing a document that already moved the ledger stays
  forbidden; the correction path is `void` plus a new document.
- **A dedicated `/pedidos` route or a pending-orders list.** Reception lives on the document
  detail sheet.
- **Any rename of code identifiers or database columns to English.** Recorded as debt, not
  executed here.
- **ARCA electronic invoicing.** `cae`/`cae_vto` stay reserved and unused.

## Capabilities

> Contract with sdd-spec. One capability is affected: `documents` owns numbering, voiding,
> conversion and the document lifecycle.

### Modified Capabilities

- `documents`: MODIFIED `Quote converts to invoice in one step` — conversion becomes
  operation-driven (`borrador` + `tipo_contraparte`) instead of quote-specific, and the source
  document stays active and re-convertible once its children are voided.

### New Requirements In `documents`

- `Document types carry a stable seed identity` — the prerequisite for the editable
  `name`/`prefix` feature to be safe.
- `Draft documents are non-binding, editable and deletable` — the draft contract.
- `A purchase order is received in partial deliveries` — the per-line pending quantity.

## Risks

| Risk | Mitigation |
|------|-----------|
| Renaming an enum value is invisible to Alembic autogenerate, so `alembic check` proves nothing about it | Hand-written migration plus an explicit test asserting the seeded row's operation value, following the precedent set by the ledger-immutability trigger (`1809708fd773`), which has a test for the same reason |
| `ALTER TYPE ... RENAME VALUE` may not be allowed inside Alembic's migration transaction | Verify against Postgres 18 while writing the migration; use an autocommit block if required, and prove it by running the migration on a copy |
| `_create_document_in_tx` is the transactional core of every document, so the extraction refactor could silently change behaviour | Refactor as a pure step first (approval tests green before and after), then add behaviour with RED/GREEN |
| Partial reception breaks the singular `child_document_id` contract | Explicit `children` list plus pending quantity per line, covered by a test with two partial deliveries |
| A migrated database where `name` and `prefix` were both renamed cannot be backfilled deterministically | The migration never fails on unmatched rows; the seed backfills by `key`, then `prefix`, then `name`, and leaves the rest NULL rather than guessing |
| Drafts created while a session is open inheriting `cash_session_id` | Explicit guard plus a test asserting the column stays NULL |

## Rollback

Revert the migration (`RENAME VALUE` back, drop `key`) and the code with it. No historical
document is rewritten: `key` is derived data and drafts post nothing, so no ledger row, balance
cache or `DocumentSequence` counter needs unwinding. The `Orden de Compra` → `Compra` rename is
reversible by the same backfill.

## Success Criteria

1. Renaming the `name` and the `prefix` of a seeded document type changes no behaviour:
   fiscal suggestion, buy screen and stock adjustment all keep resolving their type.
2. Re-seeding after such a rename does not create a duplicate document type.
3. A draft moves no stock, no cash, no financial account and no counterpart balance, accepts no
   payments, and is never linked to a cash session.
4. A childless draft can be edited and deleted under its permissions; one with a child cannot.
5. A posted document keeps the today's behaviour: immutable except for its notes.
6. A `Pedido de Compra` can be received in two partial deliveries and reports the correct
   pending quantity per line, with both children visible.
7. A customer draft still converts 1:1 to the fiscal type suggested by the tax condition.
8. Backend suite, backend lint, `check-schema.sh`, frontend typecheck/lint/unit tests and build
   all pass.
