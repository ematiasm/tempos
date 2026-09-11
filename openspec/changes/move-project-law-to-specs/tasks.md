# Tasks: move-project-law-to-specs

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2000 total (artifacts ~700; trigger + tests ~230; docs ~330; deletion-heavy `AGENTS.md` rewrite ~700; specs ~400) |
| 400-line budget risk | High for the change as a whole, Low–Medium per slice |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 enforcement → PR 2 domain specs → PR 3 docs + test hygiene → PR 4 `AGENTS.md` §6/§8 → PR 5 `AGENTS.md` §3/§4 + index |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Reasoning: the change is large in total but each of the five slices stays under the
400-line budget — the two `AGENTS.md` slices are split precisely because a 500-line
deletion cannot be reviewed as a single unit. The delivery decision is already made
(chained PRs, stacked-to-main, no `size:exception` needed), so no decision blocks apply.

Strict TDD is enabled (`openspec/config.yaml`). Work unit 1 is behaviour code and runs
RED → GREEN → TRIANGULATE → REFACTOR. Work units 2–4 are documentation and file
deletion; they have no meaningful pre-implementation failing test, so they are recorded
as a justified exception and validated by the gates named in their verification line.

Backend tests need the docker compose `db` service up with migrations applied, and they
are non-parallel-safe.

---

## Work Unit 1 — Enforce ledger immutability (PR 1)

- [x] RED: create `backend/tests/api/routes/test_ledger_immutability.py` with a behaviour test that inserts a `StockMovement` through the API and then asserts a raw `UPDATE` raises from the database and the row keeps its original `cantidad`, plus the equivalent `DELETE` case; and a presence test that asserts `pg_trigger` has the mutation-rejecting trigger on every protected table. Observed failure captured in `apply-progress.md`. <!-- sdd-owner: implementation -->
- [x] GREEN: hand-write `backend/app/alembic/versions/1809708fd773_add_ledger_immutability_guard.py` with `uv run alembic revision -m ...` (not `--autogenerate`: autogenerate cannot see triggers): a `CREATE OR REPLACE FUNCTION` that raises, a `DROP TRIGGER IF EXISTS` plus `CREATE TRIGGER ... BEFORE UPDATE OR DELETE ... FOR EACH ROW`, and a `downgrade()` that drops exactly those triggers and the function. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: add the contra-entry case (a correction inserts an opposite-sign movement produced by the reversing document and the original stays untouched) and the bulk-`UPDATE`-without-`WHERE` case (the guard is per row, so it cannot slip through). <!-- sdd-owner: implementation -->
- [x] Keep `backend/tests/conftest.py` `_clean_test_data` deleting the same rows, wrapped in `SET LOCAL session_replication_role = replica` so the guard does not block cleanup. `TRUNCATE` was measured and rejected: it ignores the `_BASELINE` per-row preservation and would delete the dev database's 17 pre-existing ledger rows. <!-- sdd-owner: implementation -->
- [x] RED+GREEN (discovered by the guard): conciliation mutated `accountmovement.conciliado` through the API. Move it to its own append-only log — `Conciliation` model, migration `9337de9c4513` (create + backfill + drop column + attach the guard), `crud.conciliate_account_movement`, the route recording a row instead of a mutation, and `AccountMovementPublic.conciliado` derived from the log so the API shape is unchanged. <!-- sdd-owner: implementation -->
- [x] RED+GREEN (discovered by the guard): `test_stock_ledger.py` pinned a movement's `created_at` by updating it. Add `pin_created_at` to `tests/utils/ledger.py` using the same test-only escape hatch, and use it there. <!-- sdd-owner: implementation -->
- [x] REFACTOR: confirm both migrations match the house style (reversible, no data touched, re-runnable). Run `cd backend && bash scripts/lint.sh` (mypy, ty, ruff) and `bash scripts/check-schema.sh` (`alembic check` reports no drift). <!-- sdd-owner: implementation -->
- [x] Verify `bash backend/scripts/test.sh` passes with the trigger active, and that the regenerated client differs only in the propagated route docstring. Results recorded in `apply-progress.md`. <!-- sdd-owner: implementation -->

## Work Unit 2 — Documentation extraction (PR 3)

- [ ] Create `docs/ARCHITECTURE.md` with: backend (`backend/app/`) and frontend (`frontend/src/`) and root layout tables moved from `AGENTS.md` §4; the stack and conventions from §2; the rationale of the database invariants now enforced (the trigger, the partial unique index and the check constraint declared in `app/models.py` metadata); the migration traps (`postgresql.ENUM(..., create_type=False)`, the spurious `drop_index` removed by hand); the custom `ThemeProvider`; the `ENVIRONMENT=local` private router; and that Backups come from the upstream template. <!-- sdd-owner: implementation -->
- [ ] Create `docs/TESTING.md` with: the real-Postgres session-scoped autouse `db` fixture, the non-parallel caveat, how to run tests against a dev database, the PEP 758 unparenthesized `except` trap that `ruff format --check` enforces, `uv run bash scripts/...` and the `docker builder prune` disk note. <!-- sdd-owner: implementation -->
- [ ] Verify both files read as standalone documents: every command matches the current scripts, and no statement contradicts `openspec/config.yaml: testing` or a spec. <!-- sdd-owner: implementation -->

## Work Unit 3 — Test hygiene and dead files (PR 3)

- [ ] Change the autouse `open_cash_session` fixture in `backend/tests/conftest.py` to close a stray `OPEN` `CashRegisterSession` instead of failing with `cash_session_already_open`. RED is not applicable (the current behaviour is proven by the existing suite failing on a stray session); verify by opening a session manually, running the suite, and confirming it is green without a manual `UPDATE`. <!-- sdd-owner: implementation -->
- [ ] Delete `backend/tests/utils/item.py` and `frontend/src/components/Pending/PendingItems.tsx` after confirming nothing imports or references them, then run `bash backend/scripts/test.sh`, `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` and `bun run lint`. <!-- sdd-owner: implementation -->
- [ ] Confirm no remaining reference to the template `Item` CRUD exists anywhere in live files (generated client excluded). <!-- sdd-owner: implementation -->

## Work Unit 4 — `AGENTS.md` index and config citations (PR 4 and PR 5)

- [ ] PR 4: remove `AGENTS.md` §6 and §8 entirely, and update the three `openspec/config.yaml` citations: `rules.design` → `openspec/specs/transactional-integrity/spec.md`, `rules.apply` → `docs/ARCHITECTURE.md`, `rules.proposal` left pointing at rule 1. Confirm no live file still cites `AGENTS.md` for a contract that moved. <!-- sdd-owner: implementation -->
- [ ] PR 5: remove `AGENTS.md` §3 (commands) and §4 (where things live), then rewrite §1/§2/§5 as the pointer index: purpose, "where the rules live" pointers, the seven working rules, and the reserved-hooks line pointing at the `documents` spec. Target under 60 lines. <!-- sdd-owner: implementation -->
- [ ] Verify the index contains no behavioural contract owned by a capability and that every invariant it names links to a file that exists. <!-- sdd-owner: implementation -->
- [ ] Verify the contradiction is gone: no file states that `precio_venta` carries IVA inside, and `pricing/spec.md` remains the only statement of the shelf-price chain. <!-- sdd-owner: implementation -->

## Parent-owned lifecycle

- [ ] Start or reuse bounded review for each merged slice. <!-- sdd-owner: parent -->
- [ ] Sync the change specs into `openspec/specs/` (five new capabilities, `payments` ADDED, two REMOVED) after PR 2 is merged and verified. <!-- sdd-owner: parent -->
- [ ] Archive the change under `openspec/changes/archive/YYYY-MM-DD-move-project-law-to-specs/`. <!-- sdd-owner: parent -->
- [ ] Deliver the deferred default-locale (EN) change as its own PR after this change lands. <!-- sdd-owner: parent -->
