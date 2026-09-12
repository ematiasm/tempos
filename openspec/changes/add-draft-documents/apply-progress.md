# Apply Progress: add-draft-documents

## Status

| Field | Value |
|---|---|
| Work unit | **1 of 4 — PR 0: stable document-type identity** |
| State | Complete, all gates green, delivered as three stacked commits |
| Change state | Active. Units 2, 3 and 4 are not started. |
| Artifact store | `openspec` (no Engram mirror) |

PR 0 shipped as three stacked commits after one honest slicing pass, because the unit measured
756 authored lines against the 400 budget:

| Slice | Commit | Authored lines | Deliverable |
|---|---|---|---|
| 0a | `feat(documents): give document types a stable seed identity` | **325** (+32 generated) | The identity exists and the seed is rename-proof |
| 0b | `fix(documents): resolve document types by key instead of by name` | **115** | The backend consumes the identity |
| 0c | `feat(frontend): resolve document types by key in the screens` | **322** | The screens consume the identity |

## What changed

`DocumentType` now carries a stable, non-editable `key`, and every place that used to identify a
seeded type by its editable `name` or `prefix` resolves by that key instead.

| File | Change |
|---|---|
| `backend/app/models.py` | `DocumentType.key` (nullable, unique, indexed); `DocumentTypePublic.key`; `DocumentTypeUpdate.key` declared only so the route can reject it; `FISCAL_SALE_TYPE_NAMES` → `FISCAL_SALE_TYPE_KEYS` |
| `backend/app/alembic/versions/f9b5dda6c3cd_add_document_type_key.py` | New. Adds the column, backfills it from the current prefix, adds the unique index |
| `backend/app/core/db.py` | `SEED_DOCUMENT_TYPES` gains a `key` and becomes a list of a named tuple; the seed matches by `key` then `prefix` then `name` and backfills a missing key; `VOID_TYPE_MIRROR` is keyed by `key` |
| `backend/app/crud.py` | `suggest_fiscal_sale_type` resolves by `key` |
| `backend/app/api/routes/document_types.py` | `PATCH` rejects `key` with `document_type_key_immutable` |
| `frontend/src/lib/documentTypes.ts` | New. `findTypeByKey`, `isCreatableType`, `isReceiptType`, `isCounterSaleType` |
| `frontend/src/routes/_layout/{buy,stock}.tsx` | Resolve their type by `key` |
| `frontend/src/components/Documents/NewDocumentDialog.tsx` | Creation filter by key |
| `frontend/src/components/Sell/useReferenceData.ts`, `frontend/src/components/Admin/SellScreenSettings.tsx` | Counter sale types by key |
| `frontend/src/routes/_layout/payments.tsx` | Receipt filter by key |
| `frontend/src/client/*` | Regenerated (`bash ./scripts/generate-client.sh`) for the new `key` field |
| `backend/tests/api/routes/test_document_types.py` | 3 new integration tests plus the seeded-key map and the void-mirror assertions |
| `frontend/src/lib/documentTypes.test.ts` | New. 15 pure-function tests across the four helpers |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 Seeded identity exists and is stable | `test_document_types.py` | Integration | ✅ 5/5 | ✅ Written | ✅ Passed | ✅ Full 14-key map + void mirrors | ✅ Clean |
| 1.2 A renamed fiscal type still resolves | `test_document_types.py` | Integration | ✅ 5/5 | ✅ Observed `400 {"detail":"Seeded document type 'Factura A' not found"}` | ✅ Passed | ✅ Renamed row's id and name asserted | ✅ Name lookup deleted |
| 1.3 Re-seeding does not duplicate a renamed type | `test_document_types.py` | Integration | ✅ 5/5 | ✅ Observed `assert 15 == 14` | ✅ Passed | ✅ Squatter removal proves it is the seed, not luck | ✅ Seed matches by key |
| 1.4 `key` cannot be edited through the API | `test_document_types.py` | Integration | ✅ 5/5 | ✅ Observed `KeyError: 'key'` | ✅ Passed | ✅ Stored value re-read after the rejection | ✅ Clean |
| 1.5 Resolve a type by key | `documentTypes.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 5 passed | ✅ Full seeded key set, missing key, unknown key, renamed type | ✅ Clean |
| 1.6 Manual-creation filter follows the key | `documentTypes.test.ts` | Unit | N/A (new) | ✅ Observed `Export named 'isCreatableType' not found` | ✅ 3 passed | ✅ Renamed credit note still refused | ✅ Shared key sets, no duplication |
| 1.7 Receipt and counter-sale filters follow the key | `documentTypes.test.ts` | Unit | N/A (new) | ✅ Observed `Export named 'isReceiptType' not found` | ✅ 6 passed | ✅ Excluded sets, NULL key, renamed type | ✅ `NON_CREATABLE` composed from the two sets |

Fifteen new pure-function tests in `documentTypes.test.ts` plus three new integration tests in
`test_document_types.py`.

Assertion quality: every new test calls production code and asserts a specific value — the
resolved row's id, the seeded key map, an HTTP status and body, a refused key, a returned
boolean per key. No tautologies, no type-only assertions, no empty-collection assertions, no
CSS assertions. The two object comparisons in the frontend test are over concrete key objects
built in the test, with a companion case per branch.

### Test Summary

| Layer | Command | Result |
|---|---|---|
| Backend integration | `cd backend && uv run pytest tests/ -q` | **387 passed** (baseline 384 + 3 new) |
| Backend lint | `cd backend && uv run bash scripts/lint.sh` | mypy 48 files clean, ty clean, ruff check clean, ruff format clean |
| Schema parity | `cd backend && uv run bash scripts/check-schema.sh` | `No new upgrade operations detected` |
| Frontend unit | `cd frontend && bun run test:unit` | **95 passed** (baseline 80 + 15 new), `tsc` clean |
| Frontend typecheck / lint / build | `bunx tsc -p tsconfig.build.json --noEmit`, `bun run lint`, `bun run build` | clean / 226 files no fixes / built |
| E2E | `cd frontend && bunx playwright test` | **128 passed** |

Per-slice verification, so each commit is green on its own:

| Slice | Backend | Frontend | Notes |
|---|---|---|---|
| 0a | 385 passed (384 + the re-seed test), lint and `alembic check` clean | 80 unit, typecheck/lint/build clean | The regenerated client ships here, per `AGENTS.md` rule 3 |
| 0b | 387 passed, lint and `alembic check` clean | 80 unit | Frontend untouched |
| 0c | unchanged, 387 passed | 95 unit, typecheck/lint/build clean, 128 E2E | The screens ship here |

E2E note: three specs (`reset-password` ×2 and the sell email action) initially failed with
`connect ECONNREFUSED ::1:1080`. They need the `mailcatcher` compose service, which was not
running locally. Started it and the full suite is green; nothing in this change touches email
or SMTP.

### Safety net

Baseline before touching anything: `test_document_types.py` + `test_document_convert.py`
→ 5 passed. No pre-existing failure was observed or fixed.

## Deviations from the plan

1. **Four more prefix-identity sites than the plan counted.** The plan listed five matches;
   triangulation surfaced four more screens doing the same thing with a `Set`
   (`EXCLUDED_PREFIXES`, `SALE_PREFIXES` ×2, `RECEIPT_PREFIXES`). They are the same defect, so
   they were fixed in this unit and recorded as a task line rather than deferred.
2. **`key` is nullable, not NOT NULL.** The migration runs over data a user may have renamed and
   only `prefix` is available to match on, so an unmatched row keeps NULL instead of failing the
   migration. The seed backfills by `key` → `prefix` → `name`, and the spec states the residual
   case. `DocumentTypePublic.key` is therefore optional and the helpers handle a NULL key
   explicitly (creatable fails open, the two offered-type filters fail closed).
3. **`SEED_DOCUMENT_TYPES` became a named tuple.** An eight-field positional tuple with two
   booleans and two ints was no longer readable once `key` joined it; the extraction is part of
   this unit's refactor step and changes no value. It is the single largest hunk in the unit.
4. **PR 0 needed a slicing pass.** It measured 756 authored lines against the 400 budget, so it
   was delivered as the three commits above rather than one PR.
5. **The shared dev database needed a repair.** The RED observation of 1.3 ran against the
   pre-fix seed, which inserted a duplicate of the renamed type; the test's `finally` could not
   restore the prefix because the duplicate held it. The orphan row (0 documents, NULL key) was
   deleted and `init_db` re-wired the FA void mirror. The test now removes any squatter before
   restoring, so a future RED observation cannot leave the session database dirty.

## Remaining tasks

Work units 2, 3 and 4 are untouched: 32 of 45 task lines remain unchecked, including every
parent-owned lifecycle line:

- `- [ ] Sync the documents delta into openspec/specs/documents/spec.md after the last unit is verified, and archive this change.`
- `- [ ] Record the Spanish-vocabulary → English migration as deliberate debt in docs/ARCHITECTURE.md and AGENTS.md.`

No parent marker was required for this unit.

## Structured status

`actionContext.mode: repo-local`, workspace `/home/mamull/tempos`, edit roots `/home/mamull`.
No `workspace-planning` warnings. The change is active with `specs`, `design` and `tasks`
present; unit 1 had no unmet dependency.
