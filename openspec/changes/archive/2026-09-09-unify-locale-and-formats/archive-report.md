# Archive Report: unify-locale-and-formats

**Status: archived (pass)** — 2026-09-09

## Preconditions

- `verify-report.md`: **PASS** (no FAIL/BLOCKED/CRITICAL).
- `tasks.md`: 15/15 implementation + 2/2 parent checkboxes complete; re-read
  before the move confirmed zero unchecked `- [ ]` lines (Final Task
  Completion Gate).
- `sync-report.md`: present (file-backed sync completed first; canonical spec
  `openspec/specs/locale-and-formats/spec.md` created).
- No destructive delta (new-domain copy only) — no destructive-merge approval
  needed.
- No stale-checkbox reconciliation required.

## Artifacts read

proposal.md, specs/locale-and-formats/spec.md, design.md, tasks.md,
apply-progress.md, verify-report.md, sync-report.md, openspec/config.yaml.

## Canonical spec result

- Domain `locale-and-formats` created in `openspec/specs/` with 5
  requirements: Single business locale, Formats derived from the locale,
  Centralized formatting helpers, Locale change propagation, Extensible
  locale enumeration.

## Archived path

`openspec/changes/archive/2026-09-09-unify-locale-and-formats/`

## Implementation traceability

- Commits: `547a384` (backend: model + migration 41820b782d4f + tests),
  `511271a` (frontend core: i18n resolution, static format helpers, settings
  UI, client regen), `e85d254` (53-file sweep), `0c2b60e` (SDD artifacts +
  apply-progress), plus the verify/sync/archive artifact commit.
- Validation: 361 backend tests, mypy/ty/ruff clean, tsc 0 errors, biome
  clean, 125 Playwright E2E passed.

## Notes

- Non-critical manual smoke-test (voucher print + sell screen under both
  locales) remains recorded in apply-progress.md as a user item; it does not
  block archive per verify-report.
