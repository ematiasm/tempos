# Proposal: Move Project Law into OpenSpec Specs

## Intent

`AGENTS.md` (501 lines) is the only always-on channel, and it has become a second,
weaker spec store. Three concrete failures:

1. **Contracts that exist nowhere else.** Grepping every capability under
   `openspec/specs/` finds no match for: the deletion policies and their 409 codes
   (`product_in_use`, `tax_in_use`, `customer_in_use`, `supplier_in_use`), receipt
   FIFO allocation with its `saldo_inicial` snapshot, `limite_credito` validation,
   `favor_monto` auto-application, the void mirror table (FA/FB/FC/TCK/NDV → NCV,
   OC/NDC → NCC), the single-open cash session guard, or the `backup.*`
   permissions. They live only in prose inside a module map, so nothing verifies
   them.
2. **A contradiction with the canonical spec.** `AGENTS.md:389` states that
   `Product.precio_venta` "carries IVA inside"; `pricing/spec.md` defines
   `precio_venta = precio_neto + Σ(line-level taxes)` including IVA, IIBB,
   percepciones and internos. The map describes the pre-change chain.
3. **Duplicated process rules that drift.** Client regeneration is stated three
   times (AGENTS.md, `post-sale-actions`, `print-configuration`); the validation
   gates exist in three non-matching lists (AGENTS.md rule 4 with 5 commands,
   `openspec/config.yaml: testing` with 8, `AGENTS.md` §3 with 9); the
   "do not invent business data" rule is written out in two places.

The four transactional invariants are the worst case: **zero enforcement**. No
`TRIGGER`, `REVOKE` or `GRANT` appears in any migration, and no test protects the
append-only ledgers. This is the same class of exposure that let `d61ddf38636a`
drop two database invariants and go unnoticed for eleven revisions.

After this change `AGENTS.md` becomes a ~50-line pointer index: project scope, the
seven working rules, the validation gates by name, and explicit pointers into
`openspec/specs/`. Behaviour lives in capabilities where `sdd-verify` can check it,
and the transactional invariants become real database constraints.

## Agreed Decisions (user-approved — binding for spec/design)

1. **D1 — Append-only becomes enforceable.** A `BEFORE UPDATE OR DELETE ... FOR
   EACH ROW` trigger rejects mutations on the protected tables. Discipline alone is
   rejected as insufficient: the invariant already failed silently once.
2. **D1a — The test cleanup disables user triggers for its own transaction.**
   `backend/tests/conftest.py` deletes the ledger tables after every test, so the
   guard would fail the whole suite. The cleanup keeps its current
   `DELETE ... WHERE pk NOT IN baseline` and wraps it in
   `SET LOCAL session_replication_role = replica`: superuser-only, scoped to the
   cleanup transaction, and cleared by its commit. `TRUNCATE` was measured and
   rejected — it would discard the dev database's pre-existing ledger rows
   (17 today) while their 6 documents and 18 products survive, leaving stale caches.
3. **D1b — The guard ships with a presence test.** `alembic check` cannot see
   triggers (`alembic/env.py` has no custom comparators and autogenerate does not
   reflect triggers), so a test querying `pg_trigger` is mandatory, not optional.
4. **D2 — Capability split.** `transactional-integrity` owns the cross-cutting
   invariants; the numbering gap policy starts `documents`. Repeating
   "no UPDATE/DELETE" across domain specs is rejected: it would recreate the drift
   this change removes.
5. **D2a — `Transfer` joins the protected set.** It has no mutation path in the API
   today, so the guard only formalises what is already true.
6. **D3 — Gates by name, not by command.** The index lists which gates always apply
   and which are conditional; `openspec/config.yaml: testing` stays the single
   source of exact commands.
7. **D4 — "Do not invent business data" lives in the index** (always-on, applies to
   inline work too) and `config.yaml` references it without repeating the text.
8. **D5 — The two `Client regeneration after OpenAPI changes` requirements are
   removed** from `post-sale-actions` and `print-configuration`: they describe a
   build process that is already done, not ongoing system behaviour.
9. **D6 — Rule 11 is deleted** (do not modify the template's behaviour): the harness
   governs scope and work units now.
10. **D7 — Rule 12 is deleted** (do not commit secrets): the user decided the harness
    covers secret handling, so the repo does not duplicate the rule. Note recorded in
    design: the remaining protection is `.gitignore` for `.env.production` plus the
    tracked dev `.env` carrying the `changethis` placeholder.
11. **D8 — Documentation split in two files:** `docs/ARCHITECTURE.md` (layout,
    invariants rationale, stack, conventions) and `docs/TESTING.md` (real Postgres
    fixture, non-parallel suite, orphaned session, commands).
12. **D9 — The orphaned cash-session trap is fixed in the fixture**, not documented:
    the autouse fixture closes a stray `OPEN` session instead of failing the whole
    suite.
13. **D10 — §6 becomes specs, not prose.** One capability per domain (see below);
    `Backups` deliberately gets no spec (template-provided, not tempos domain) and
    moves to docs.
14. **D11 — Conciliation moves to its own append-only log.** Discovered while
    implementing the guard: `POST /account-movements/{id}/conciliate` flipped
    `accountmovement.conciliado`, so the finance ledger was the one ledger that had to
    stay mutable and the guard broke a shipped feature. Carving the flag out of the
    guard was rejected: the ledger stays absolutely immutable and the conciliation
    becomes a row in its own guarded log, with the API field derived from it so no
    client change is needed.

## Scope

### In Scope

1. **`transactional-integrity` capability (new) + the trigger migration**: one
   hand-written Alembic migration creating the rejection function and attaching it
   to `StockMovement`, `AccountMovement`, `CustomerAccountMovement`,
   `SupplierAccountMovement` and `Transfer`; explicit `downgrade`.
2. **Test-suite changes**: `_clean_test_data` keeps its baseline-honoring `DELETE`
   and runs it with user triggers disabled for that transaction;
   a behaviour test (UPDATE and DELETE rejected) and a presence test (`pg_trigger`).
3. **Four new capability specs**: `documents` (numbering and gaps, voiding and
   mirrors, quote conversion, `favor_monto`, polymorphic counterparts, reserved ARCA
   hooks, mono-store constraint), `catalog` (deletion and edit policies for Product
   and Tax), `counterparties` (deletion policies, `limite_credito`, signed balances,
   Consumidor Final protection, CUIT/CUIL validation), `cash-sessions` (single open
   session, lifecycle, document tagging, permissions).
4. **`payments` (modified)**: the standalone-receipt requirement, FIFO allocation,
   `saldo_inicial` snapshot, on-account credit, `marks_paid` enforcement.
5. **`post-sale-actions` and `print-configuration` (modified)**: the client
   regeneration requirements are removed.
6. **`docs/ARCHITECTURE.md` and `docs/TESTING.md` (new)**: everything non-behavioural
   that leaves `AGENTS.md` §2, §3, §4 and §8.
7. **`AGENTS.md` rewrite to an index** (~50 lines from 501) and the three
   `openspec/config.yaml` citations updated to point at the new homes.
8. **Two dead files removed**: `backend/tests/utils/item.py` and
   `frontend/src/components/Pending/PendingItems.tsx` (both verified unreferenced),
   which retires a known-issues entry.

### Out of Scope

- **The default-locale change (EN).** Decided separately and delivered as its own
  PR after this change lands; it touches `locale-and-formats` plus six frontend
  fallbacks and must not be mixed with a governance change.
- **Any behaviour change to pricing, payments, sell screen, printing or search.**
  This change only writes down what those capabilities already do.
- **Retroactive enforcement over existing data.** The trigger rejects future
  mutations; it does not validate historical rows.
- **`Backups`** keeps its template behaviour and gets no capability spec.
- **AFIP/ARCA integration.** The reserved hooks stay reserved and nullable.

## Capabilities

> Contract with sdd-spec. Existing specs under `openspec/specs/`: `locale-and-formats`,
> `payments`, `post-sale-actions`, `pricing`, `print-configuration`, `product-search`,
> `sell-screen`. None of them covers ledgers, document lifecycle, deletion policies,
> counterparty rules or cash-session lifecycle.

### New Capabilities

- `transactional-integrity`: insert-only ledgers, atomic relative cache
  reconciliation, numbering claimed under lock, counterpart-before-sequence lock
  order.
- `documents`: numbering format and intentional gaps, voiding via mirror notes,
  quote-to-invoice conversion, `favor_monto`, polymorphic counterpart references,
  reserved ARCA hooks, mono-store constraint.
- `catalog`: Product and Tax deletion policies and the fiscal-field freeze on used
  taxes.
- `counterparties`: Customer and Supplier deletion policies, credit limit
  validation, signed balance reconciliation, seeded Consumidor Final protection,
  CUIT/CUIL validation.
- `cash-sessions`: single open session, open/close lifecycle, document tagging for
  arqueo, permissions.

### Modified Capabilities

- `payments`: ADDED — standalone receipts with FIFO allocation.
- `post-sale-actions`: REMOVED — client regeneration requirement.
- `print-configuration`: REMOVED — client regeneration requirement.

## Risks

| Risk | Mitigation |
|------|-----------|
| The DELETE trigger breaks the whole suite | D1a: the cleanup runs its baseline-honoring `DELETE` with user triggers disabled for that transaction; the behaviour test would fail loudly if a DELETE path survives |
| The guard surfaces mutation paths that shipped features and tests relied on | It already did: the conciliation flag (fixed by D11) and a test pinning `created_at` (fixed with a test-only helper). Both were invisible before because nothing enforced the invariant |
| The trigger is silently dropped by a future autogenerated migration | D1b: presence test querying `pg_trigger`; `check-schema.sh` cannot cover it |
| Moving rules out of the always-on file weakens inline work | The index keeps the invariants as explicit pointers, so every prompt still names the file that owns them |
| Specs drift again because AGENTS.md keeps a summary | §6 is removed, not summarised; the contradiction with `pricing/spec.md` is the evidence that summaries rot |
| A restore loses the trigger | `backup.py:restore_database` drops and recreates the database, then asserts `alembic_version` and runs `alembic upgrade head`, so an older dump receives the trigger through the migration |

## Rollback

Each slice is independently revertible. Reverting the trigger slice means running the
migration `downgrade`, which drops the function and the triggers; the ledger tables and
their rows are untouched in either direction. Reverting the documentation slices restores
`AGENTS.md` from git with no runtime effect. No slice performs a data migration.

## Success Criteria

1. `AGENTS.md` is under 60 lines and contains no behavioural contract that a capability
   owns; every removed rule has a named destination.
2. `transactional-integrity`, `documents`, `catalog`, `counterparties` and
   `cash-sessions` exist as specs with RFC 2119 requirements and at least one testable
   scenario each; `payments` gains the receipt requirement; the two client-regeneration
   requirements are gone.
3. An `UPDATE` or `DELETE` against any of the five protected tables fails at the database
   level, and a test proves the guard is present.
4. The full validation set passes: `backend/scripts/test.sh`, `backend/scripts/lint.sh`,
   `backend/scripts/check-schema.sh`, frontend `tsc` and lint.
5. No live document under the repo cites `AGENTS.md` for a contract that moved.
