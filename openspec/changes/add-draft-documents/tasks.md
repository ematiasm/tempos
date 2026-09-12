# Tasks: add-draft-documents

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1.500 total (WU1 ~280, WU2 ~400, WU3 ~380, WU4 ~150, change artifacts ~290) |
| Measured, WU1 | **~756** reviewable lines (271 backend + 163 backend tests + 322 frontend), measured with `git diff --numstat`; the artifact store and the regenerated client are excluded |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 0 → PR 1 → PR 2 → PR 3 (four stacked PRs, in that order) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Reasoning: the change adds an enum value, a column, two permissions, three endpoints, a
lifecycle rule, a partial-delivery rule and a frontend surface. The delivery path is already
resolved by the maintainer (stacked PRs to `main`, one deliverable work unit each), so the apply
gate had no pending decision.

**WU1 came in over its estimate and needs a delivery decision before its PR is opened.** It
measured ~756 reviewable lines against the ~280 forecasted, because the estimate missed the four
extra prefix-identity screens triangulation surfaced and the size of the `SEED_DOCUMENT_TYPES`
rewrite. One honest slicing pass gives three cohesive slices, each under 400 and each green on
its own: **0a** the identity exists (column, migration, seed, ~350) → **0b** code consumes it
(`suggest_fiscal_sale_type`, the `PATCH` rejection, ~85) → **0c** the screens consume it (client,
helper, six call sites, ~322). Either those three slices are committed, or WU1 ships whole under
an explicit `size:exception`.

If WU2 approaches the budget it splits at the natural seam: **2a** enum rename + draft guards
(backend only), **2b** edit/delete endpoints + generic conversion + frontend.

Strict TDD is enabled (`openspec/config.yaml`). Every unit below is written as
RED → GREEN → TRIANGULATE → REFACTOR, and `apply-progress.md` MUST carry a `TDD Cycle Evidence`
table. Test runner: `cd backend && uv run pytest tests/api/routes/test_<module>.py -x`; full
gate: `cd backend && bash scripts/test.sh` plus `scripts/lint.sh`.

---

## Work Unit 1 — PR 0: stable document-type identity

Prerequisite for everything else, and independently valuable: it makes the already-shipped
editable `name`/`prefix` feature safe.

- [x] RED: in `tests/api/routes/test_document_types.py`, add a test that renames the seeded
      `Factura A` (`name` and `prefix`), then resolves a sale type for a RI customer and asserts
      it is that same renamed row — it fails today with `Seeded document type 'Factura A' not found`.
      Restore the seeded values at the end, as the sibling test already does, because the session
      PostgreSQL is shared. <!-- sdd-owner: implementation -->
- [x] RED: add a test that renames a seeded type's `prefix`, runs the seed again, and asserts no
      second row was inserted for that type. <!-- sdd-owner: implementation -->
- [x] RED: add a test that `PATCH /document-types/{id}` rejects an attempt to set `key`.
      <!-- sdd-owner: implementation -->
- [x] GREEN: add `DocumentType.key` (`str | None`, unique, indexed, max_length 50) to
      `backend/app/models.py` and write the Alembic migration: add the column, backfill it from
      the current prefix, add the unique index. Read the generated revision and remove anything
      that does not belong to this change, per `AGENTS.md` rule 2. <!-- sdd-owner: implementation -->
- [x] GREEN: extend `SEED_DOCUMENT_TYPES` with a `key` per type and make `init_db` match by
      `key`, falling back to `prefix` and then `name` and backfilling a missing `key`, so a
      renamed type converges instead of duplicating. <!-- sdd-owner: implementation -->
- [x] GREEN: rewrite `VOID_TYPE_MIRROR` to be keyed by document-type `key` instead of `prefix`.
      <!-- sdd-owner: implementation -->
- [x] GREEN: make `crud.suggest_fiscal_sale_type` resolve by `key`
      (`factura_a`/`factura_b`/`factura_c`) and delete the name-based lookup and
      `FISCAL_SALE_TYPE_NAMES` if it becomes unused. <!-- sdd-owner: implementation -->
- [x] GREEN: expose `key` in `DocumentTypePublic` and reject `key` in `PATCH
      /document-types/{id}` with a business error. <!-- sdd-owner: implementation -->
- [x] GREEN: regenerate the client (`bash ./scripts/generate-client.sh`) and switch
      `frontend/src/routes/_layout/buy.tsx` and `stock.tsx` to resolve their type by `key`
      instead of `prefix`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: cover the rename of a non-fiscal type (the purchase type and the stock
      adjustment type) so the rule is proven for more than one lookup path, and assert the
      unchanged case too (a type with an intact prefix still resolves). <!-- sdd-owner: implementation -->
- [x] REFACTOR: remove the now-dead name/prefix matching, and state in each replaced site why
      the identity is the `key`. <!-- sdd-owner: implementation -->
- [x] GREEN (found while triangulating, same defect class): four more screens resolved seeded
      types by `prefix`, which the plan had not counted — `NewDocumentDialog`'s
      `EXCLUDED_PREFIXES`, `SALE_PREFIXES` in `useReferenceData` and in `SellScreenSettings`, and
      `RECEIPT_PREFIXES` in `payments.tsx`. Renaming `NCV` made credit notes manually creatable,
      renaming `FA` removed a sale type from the counter, and renaming `RC` emptied the payments
      list. All four now resolve through `@/lib/documentTypes`.
      <!-- sdd-owner: implementation -->
- [x] Verify: `cd backend && bash scripts/test.sh`, `cd backend && bash scripts/lint.sh`,
      `cd backend && bash scripts/check-schema.sh`, frontend typecheck/lint/unit/build.
      <!-- sdd-owner: implementation -->
- [x] Record the TDD evidence and the PR boundary in `apply-progress.md`.
      <!-- sdd-owner: implementation -->

## Work Unit 2 — PR 1: the draft axis

- [ ] RED: new `tests/api/routes/test_document_drafts.py` asserting a `borrador` document records
      no stock movement, no account movement and no counterpart balance change; that it rejects
      payments; and that `cash_session_id` stays NULL even with an open session.
      <!-- sdd-owner: implementation -->
- [ ] RED: assert a childless draft can be edited through `PUT /documents/{id}` with the totals
      recomputed, that its `numero` does not change, and that a draft with a child is rejected for
      both edit and delete; assert a posted sale is still rejected for edit.
      <!-- sdd-owner: implementation -->
- [ ] RED: assert `DELETE /documents/{id}` removes a childless draft and that the next document of
      that type takes the following number (the gap is never reused). <!-- sdd-owner: implementation -->
- [ ] GREEN: add `DocumentOperation.BORRADOR` and the Alembic migration with
      `ALTER TYPE documentoperation RENAME VALUE 'cotizacion' TO 'borrador'`; verify on the
      compose database whether the migration needs an autocommit block, and check the enum value
      after migrating. <!-- sdd-owner: implementation -->
- [ ] GREEN: add `document.update` and `document.delete` to `SEED_PERMISSIONS`.
      <!-- sdd-owner: implementation -->
- [ ] GREEN: in `crud._create_document_in_tx`, reject payments for a draft and leave
      `cash_session_id` NULL for it. <!-- sdd-owner: implementation -->
- [ ] GREEN: extract the line, tax and total computation out of `crud._create_document_in_tx` into
      a reusable helper, as a pure refactor with the document suite green before and after.
      <!-- sdd-owner: implementation -->
- [ ] GREEN: implement `crud.update_document` (lock the row, re-check the draft-and-childless
      condition, recompute and replace lines) and `crud.delete_document`, plus the
      `PUT /documents/{id}` and `DELETE /documents/{id}` routes with their permissions.
      <!-- sdd-owner: implementation -->
- [ ] GREEN: generalize conversion to `POST /documents/{id}/convert`, resolving the target from
      `operation` + `tipo_contraparte`, keeping `convert-to-invoice` as an alias of the same
      behaviour. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE: cover the negative paths — draft with a voided child refused for edit and for
      delete, edit that changes the counterpart, delete of a document that is not a draft.
      <!-- sdd-owner: implementation -->
- [ ] REFACTOR: drop the quote-specific naming that no longer describes the behaviour, and keep
      one helper as the single place that computes document totals. <!-- sdd-owner: implementation -->
- [ ] GREEN (frontend): edit and delete actions on `DocumentDetailSheet` gated by the permission
      and the draft condition, the `borrador` vocabulary in i18n, and the regenerated client.
      <!-- sdd-owner: implementation -->
- [ ] Verify: full backend suite, backend lint, `cd backend && bash scripts/check-schema.sh`,
      frontend typecheck/lint/unit/build, and E2E because a UI flow changed.
      <!-- sdd-owner: implementation -->
- [ ] Record the TDD evidence and the PR boundary in `apply-progress.md`.
      <!-- sdd-owner: implementation -->

## Work Unit 3 — PR 2: Pedido de Compra and partial reception

- [ ] RED: in `tests/api/routes/test_document_convert.py`, assert a purchase order for 10 units
      received as 8 then 2 exposes both active children, and that the per-line pending quantity
      reads 0 at the end. <!-- sdd-owner: implementation -->
- [ ] RED: assert a delivery larger than the pending quantity is rejected, and that voiding a
      delivery returns its quantity to pending. <!-- sdd-owner: implementation -->
- [ ] GREEN: seed `Pedido de Compra` (`PED`, `borrador`, signs `0/0`, supplier) with its `key`,
      and rename the seeded `Orden de Compra` display name to `Compra` with an idempotent
      backfill for existing databases. <!-- sdd-owner: implementation -->
- [ ] GREEN: accept per-line quantities in `POST /documents/{id}/convert` for a supplier draft,
      defaulting to the pending quantity, validating the accumulated received quantity against
      the ordered one the way `void_document` validates reverted quantities.
      <!-- sdd-owner: implementation -->
- [ ] GREEN: replace the singular `child_map` in `documents._attach_counterpart_names` with a
      `children` list and expose the per-line pending quantity, keeping `child_document_id` for
      the 1:1 customer case. <!-- sdd-owner: implementation -->
- [ ] GREEN: switch the cost-price default in `NewDocumentDialog` from `operation == "compra"` to
      `tipo_contraparte == "supplier"`, so a purchase order defaults to cost as a purchase does.
      <!-- sdd-owner: implementation -->
- [ ] GREEN: add the "Recibir" action to `DocumentDetailSheet` with the pending quantity per
      line and the regenerated client. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE: three deliveries where the last one closes the order; receiving a line twice
      past its ordered quantity; an order whose delivery was voided being receivable again.
      <!-- sdd-owner: implementation -->
- [ ] REFACTOR: keep one shared helper for accumulated-children quantities instead of two
      near-identical accumulations (void and reception). <!-- sdd-owner: implementation -->
- [ ] Verify: full backend suite, backend lint, `cd backend && bash scripts/check-schema.sh`,
      frontend typecheck/lint/unit/build, E2E for the receiving flow.
      <!-- sdd-owner: implementation -->
- [ ] Record the TDD evidence and the PR boundary in `apply-progress.md`.
      <!-- sdd-owner: implementation -->

## Work Unit 4 — PR 3: Cotización de venta

- [ ] RED: assert the customer draft still converts 1:1 through both the new endpoint and the
      alias, and that the target type is resolved by `key` when its `name` and `prefix` were
      renamed. <!-- sdd-owner: implementation -->
- [ ] GREEN: adapt the remaining quote-specific frontend surface and i18n to the `borrador`
      vocabulary and the generic endpoint. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE: a renamed fiscal type still converting correctly, and a second conversion
      unlocked by voiding the first child. <!-- sdd-owner: implementation -->
- [ ] Verify: full backend suite, backend lint, frontend gates, E2E for the conversion flow.
      <!-- sdd-owner: implementation -->
- [ ] Record the TDD evidence and the PR boundary in `apply-progress.md`.
      <!-- sdd-owner: implementation -->

## Parent-owned lifecycle

- [ ] Sync the `documents` delta into `openspec/specs/documents/spec.md` after the last unit is
      verified, and archive this change. <!-- sdd-owner: parent -->
- [ ] Record the Spanish-vocabulary → English migration as deliberate debt in
      `docs/ARCHITECTURE.md` and `AGENTS.md`. <!-- sdd-owner: parent -->
