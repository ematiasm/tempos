# Archive Report: fix-line-tax-residual

## Status

**Archived.** Verification passed, the canonical sync completed before this report, and no
implementation-owned task remains unchecked. The change folder moves to
`openspec/changes/archive/2026-09-11-fix-line-tax-residual/`.

## Artifacts read

- `proposal.md` — the non-determinism, the three agreed decisions, the scope and the risks.
- `specs/pricing/spec.md` — the single MODIFIED requirement.
- `tasks.md` — six implementation-owned tasks, all complete.
- `apply-progress.md` — the RED/GREEN/TRIANGULATE evidence per unit.
- `verify-report.md` — PASS, with the validation commands and their results.
- `sync-report.md` — the canonical replacement, written in the same pull request.

## Domains synced

| Domain | Operation | Canonical result |
|---|---|---|
| `pricing` | MODIFIED | `Document line tax decomposition (exact)` replaced; that requirement goes from 4 to 6 scenarios |

`openspec/specs/` still holds twelve capabilities.

## Destructive merge approvals

One `MODIFIED` replacement, which is destructive at archive time. The delta carried the
complete requirement block — all four surviving scenarios included — and the replacement was
asserted before writing, so nothing was dropped silently. No `REMOVED` requirement.

## Same-domain collisions

None. No other active change declares `pricing`.

## Unchecked tasks

No implementation-owned task remains unchecked. One parent-owned action stays open, its
intended state:

- Sync the delta into the canonical spec and archive this change — this report and the folder
  move.

## Structured status and action context

- Artifact store: `openspec` (file-backed); `actionContext.mode: repo-local` with the
  workspace root at `/home/mamull/tempos`, so every edit stayed inside the authoritative
  workspace.
- No migration was added or run, and stored `DocumentLineTax` rows are untouched: the new rule
  applies to documents created from now on.

## Findings carried forward

1. `price_rounding` is unused — `none` in the only installation, zero products at `.90` — and
   scheduled for removal as its own change.
2. Five canonical specs remain delta-shaped and need normalising.
3. `check-labels` cannot pass because its pinned action no longer builds.
4. `reports.spec.ts:79` fails intermittently on shard 2, on `main` as well (issue #38).
5. The frontend has no unit-test harness.

## Archived path

```
openspec/changes/archive/2026-09-11-fix-line-tax-residual/
```
