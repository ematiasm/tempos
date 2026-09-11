# Verify Report: move-project-law-to-specs

## Status

**PASS.** All implementation-owned tasks are complete, the new invariant is enforced and
proven, and the canonical store now owns the contracts the change wrote down. No blockers.

## Spec coverage

| Capability | Requirements | How it is verified |
|---|---|---|
| `transactional-integrity` | 5 | The append-only guard exists as a `BEFORE UPDATE OR DELETE` trigger on six tables and a test asserts its presence in `pg_trigger` by name; two behaviour tests prove `UPDATE` and `DELETE` are rejected while the row survives, a third proves the guard is per row, and a fourth proves a correction is still an insert. The conciliation-log requirement is met by the `conciliation` table, the idempotent `crud.conciliate_account_movement`, the derived `AccountMovementPublic.conciliado` and both list filters (`test_finance_crud.py::test_conciliate_movement`). Cache reconciliation and numbering were not modified by this change; their requirements document the existing code paths. |
| `documents` | 7 | Documentation of behaviour that already existed: numbering through `DocumentSequence`, voiding through `document_type.void_document_type_id`, quote conversion, `favor_monto`, polymorphic counterparts, reserved hooks, mono-store. Verified by traceability to the routes, `crud.create_document`/`create_receipt` and the existing document suites (all green). No code was changed for this capability. |
| `catalog` | 5 | Documentation of the existing deletion and edit policies; verified by traceability to `routes/products.py`, `routes/taxes.py` (`tax_in_use`, fiscal-field freeze) and `test_products.py` / `test_taxes.py`. |
| `counterparties` | 5 | Documentation of the existing policies; verified by traceability to `routes/customers.py`, `routes/suppliers.py`, `crud.documents_for_counterpart`, `app/validators.py` and the counterparty suites. |
| `cash-sessions` | 4 | Documentation of the existing lifecycle; verified by traceability to `routes/cash_sessions.py`, `crud.open_cash_session` and `test_cash_sessions.py`, plus the partial unique index now declared in metadata (`check-schema.sh` confirms it). |
| `payments` | 7 (1 added) | The added receipt requirement documents `crud.create_receipt` and the FIFO allocation with the `saldo_inicial` snapshot, exercised by `test_payments.py`. |
| `post-sale-actions`, `print-configuration` | 6, 3 (1 removed each) | The removed `Client regeneration after OpenAPI changes` requirements described a build step already completed; the regenerated client is committed and the remaining requirements are untouched. |

## Task completion

- 17 implementation-owned tasks: **all checked**.
- 3 parent-owned actions remain open by design: bounded review per merged slice (left to
  the maintainer), the archive (performed immediately after this report) and delivering
  the deferred default-locale change.

## Strict TDD compliance

Strict TDD is active (`openspec/config.yaml`). Work unit 1 was behaviour code and carries
RED → GREEN → TRIANGULATE → REFACTOR evidence in `apply-progress.md` with the observed
failures recorded verbatim:

- RED: `Failed: DID NOT RAISE DatabaseError` on both the `UPDATE` and the `DELETE` case,
  plus `AssertionError: tables without the append-only guard: {..., set()}` — empty trigger
  sets for all five tables.
- GREEN: `5 passed` after `alembic upgrade head`.
- TRIANGULATE: the contra-entry case and the bulk-`UPDATE` case added afterwards.
- REFACTOR: `lint.sh` clean and `check-schema.sh` reporting no drift.

Work units 2 to 4 are documentation, file deletion and test scaffolding; a pre-implementation
failing test is not meaningful for them, so they are recorded as a justified exception and
validated by the commands below.

## Assertion quality

The new tests assert behaviour, not shape: that the database raises, that the row keeps its
original value, that an insert still succeeds, and that the guard is present on **every**
protected table by trigger name. No tautologies, no type-only assertions, no smoke tests.
The presence test is deliberately strict — it names the trigger instead of accepting any
trigger — because `alembic check` cannot see triggers and a rename or drop must fail loudly.

## Validation commands

| Command | Result |
|---|---|
| `uv run bash scripts/test.sh` | `380 passed` with the trigger active |
| `uv run bash scripts/lint.sh` | `Success: no issues found in 48 source files`; ty and ruff clean |
| `uv run bash scripts/check-schema.sh` | `No new upgrade operations detected` |
| `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` | clean |
| `cd frontend && bun run build` | succeeds |
| `cd frontend && bun run lint` | clean |
| `bash ./scripts/generate-client.sh` | only the propagated route docstring changed |
| CI on the pull requests | `pre-commit`, `test-backend`, `test-docker-compose`, `zizmor` and Playwright shards 1, 3 and 4 pass. Shard 2 fails solely on `reports.spec.ts:79`, a pre-existing flake on `main` (issue #38). `check-labels` fails on every pull request because the pinned action cannot build its image. |

Direct evidence the invariant is live:

```
ERROR:  ledger tables are append-only: DELETE is rejected on stockmovement
HINT:  insert an opposite-sign movement referencing the row
```

## Review workload findings

Delivered as seven pull requests, each with its own issue: #35 (guide cleanup), #37 (the
guard plus the conciliation move), #40 (domain specs), #42 (reference docs, fixture fix,
orphan deletions), #44 (module map and known-issues removal), #46 (canonical sync), #48
(the index). Every slice except #37 fit a single review; #37 was one atomic unit — the guard
cannot land green without moving conciliation out of the ledger — and its size was disclosed
in the pull request.

## Findings carried forward

1. Five canonical specs are still delta-shaped (`payments`, `post-sale-actions`,
   `print-configuration`, `product-search`, `sell-screen`); they need normalising.
2. `openspec/README.md` documents a `state.yaml` that no change has ever contained.
3. The default locale is still inconsistent between backend (`EN`) and frontend (`ES`);
   the decision to reconcile it in `EN` is made but unimplemented.
4. `check-labels` fails for every pull request because its pinned action cannot build.
5. `reports.spec.ts:79` fails intermittently on shard 2, on `main` too (issue #38).

## Blockers

None.
