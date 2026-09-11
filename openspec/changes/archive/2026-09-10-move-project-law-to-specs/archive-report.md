# Archive Report: move-project-law-to-specs

## Status

**Archived.** Verification passed, the canonical sync completed before this report, and no
implementation-owned task remains unchecked. The change folder moves to
`openspec/changes/archive/2026-09-10-move-project-law-to-specs/`.

## Artifacts read

- `proposal.md` — intent, the fourteen agreed decisions, scope, risks, rollback, success
  criteria.
- `design.md` — decisions D-A to D-I, the migration map, the delivery split.
- `tasks.md` — 17 implementation-owned tasks, all complete.
- `apply-progress.md` — the TDD evidence per work unit.
- `verify-report.md` — PASS, with the validation commands and their results.
- `sync-report.md` — the canonical sync, written by the preceding pull request.
- `specs/` — the eight delta specs this change produced.

## Domains synced

Synced in `#46` before this archive; no archive-time sync fallback was needed.

| Domain | Operation | Canonical result |
|---|---|---|
| `transactional-integrity` | new | Full spec, 5 requirements |
| `documents` | new | Full spec, 7 requirements |
| `catalog` | new | Full spec, 5 requirements |
| `counterparties` | new | Full spec, 5 requirements |
| `cash-sessions` | new | Full spec, 4 requirements |
| `payments` | ADDED | `Standalone receipts allocate oldest-first` |
| `post-sale-actions` | REMOVED | `Client regeneration after OpenAPI changes` |
| `print-configuration` | REMOVED | `Client regeneration after OpenAPI changes` |

`openspec/specs/` now holds twelve capabilities.

## Destructive merge approvals

The two `REMOVED` requirements delete canonical content. Both were explicitly approved as
decision D5 in the proposal and recorded with reason and migration notes in the delta specs
before the removal. No `MODIFIED` delta replaced a requirement block in this change, so no
scenario could be silently dropped.

## Same-domain collisions

None. No other active change under `openspec/changes/` declared these domains, and every
active folder except this one is absent, so the archive reorders nothing.

## Unchecked tasks

No implementation-owned task remains unchecked (`- [ ]` with an `implementation` owner).
Three parent-owned actions stay open, which is their intended state and not an archive
blocker:

- Start or reuse bounded review for each merged slice — left to the maintainer, since
  receipt-driven development reviews are not enabled in this repository.
- Archive the change — this report and the folder move.
- Deliver the deferred default-locale (EN) change as its own pull request.

## Structured status and action context

- Artifact store: `openspec` (file-backed); `actionContext.mode: repo-local` with the
  workspace root at `/home/mamull/tempos`, so every edit stayed inside the authoritative
  workspace.
- All slices were applied from that workspace, and the schema gate ran against a database
  migrated to head in both directions.

## Findings carried forward

1. Five canonical specs remain delta-shaped and need normalising.
2. `openspec/README.md` still documents a `state.yaml` that no change has contained.
3. The default locale is inconsistent between backend and frontend; the decision to
   reconcile it in `EN` is recorded but unimplemented.
4. `check-labels` cannot pass because its pinned action no longer builds.
5. `reports.spec.ts:79` fails intermittently on shard 2, on `main` as well (issue #38).

## Archived path

```
openspec/changes/archive/2026-09-10-move-project-law-to-specs/
```
