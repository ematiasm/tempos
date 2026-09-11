# Archive Report: default-locale-en

## Status

**Archived.** Verification passed, the canonical sync completed before this report, and no
implementation-owned task remains unchecked. The change folder moves to
`openspec/changes/archive/2026-09-11-default-locale-en/`.

## Artifacts read

- `proposal.md` — the contradiction between the two defaults, the six agreed decisions, the
  scope and the risks.
- `specs/locale-and-formats/spec.md` — the single MODIFIED requirement.
- `tasks.md` — nine implementation-owned tasks, all complete.
- `apply-progress.md` — the per-unit evidence, including the deviation this change had to
  absorb.
- `verify-report.md` — PASS, with the validation commands and their results.
- `sync-report.md` — the canonical replacement, written in the same pull request.

## Domains synced

| Domain | Operation | Canonical result |
|---|---|---|
| `locale-and-formats` | MODIFIED | `Single business locale` replaced; that requirement goes from 1 to 5 scenarios |

`openspec/specs/` still holds twelve capabilities.

## Destructive merge approvals

One `MODIFIED` replacement, which is destructive at archive time. The delta carried the
complete requirement block — the surviving existing scenario included — and the replacement
was asserted before writing, so nothing was dropped silently. No `REMOVED` requirement and no
data migration: this change touches no stored rows.

## Same-domain collisions

None. No other active change declares `locale-and-formats`.

## Unchecked tasks

No implementation-owned task remains unchecked. One parent-owned action stays open, its
intended state:

- Sync the delta into the canonical spec and archive this change — this report and the folder
  move.

## Structured status and action context

- Artifact store: `openspec` (file-backed); `actionContext.mode: repo-local` with the
  workspace root at `/home/mamull/tempos`, so every edit stayed inside the authoritative
  workspace.
- No migration ran in either direction, and `check-schema.sh` reports no drift.

## Findings carried forward

1. Five canonical specs remain delta-shaped and need normalising.
2. `openspec/README.md` still documents a `state.yaml` that no change has contained.
3. `check-labels` cannot pass because its pinned action no longer builds.
4. `reports.spec.ts:79` fails intermittently on shard 2, on `main` as well (issue #38).
5. The line-tax rounding residual lands on an unordered "last" tax (issue #51).
6. The frontend has no unit-test harness.

## Archived path

```
openspec/changes/archive/2026-09-11-default-locale-en/
```
