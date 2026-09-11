# Apply Progress: fix-line-tax-residual

## Status

Complete and archived. One work unit in one pull request (#59), with the canonical sync and
the archive performed alongside the verification report.

## Work Unit 1 — Assign the residual deterministically

### TDD Cycle Evidence

| Task | RED | GREEN | TRIANGULATE / REFACTOR |
|------|-----|-------|------------------------|
| Deterministic residual | Observed before the fix, and recorded in issue #51: `tests/api/routes/test_documents.py` failed **2 of 4 runs** with `assert iva["monto"] == "31.58"` receiving `31.59`. The residual cent landed on IIBB or on IVA depending on which one Postgres returned last, because `Product.taxes` carries no ordering | The assignment now picks the percent tax with the largest `monto`, ties broken by tax id, so the result cannot depend on input order: **6 of 6 runs** of that file passed, where it used to flip | The full backend suite is `384 passed`, which proves no other assertion depended on the previous outcome; `lint.sh` is clean |

### Files changed

| File | Change |
|------|--------|
| `backend/app/crud.py` | `_decompose_line_taxes` assigns the residual by value; the docstring no longer claims a determinism the code did not have |
| `backend/tests/api/routes/test_documents.py` | The test asserts the rule instead of a position and carries its new name |
| `openspec/changes/fix-line-tax-residual/**` | Proposal, spec delta and tasks |

### Commands and observed results

| Command | Result |
|---------|--------|
| `uv run pytest tests/api/routes/test_documents.py -q` (before) | `1 failed, 36 passed` in 2 of 4 runs — the flip reproduced |
| `uv run pytest tests/api/routes/test_documents.py -q` (after, six consecutive runs) | `37 passed` every time |
| `uv run bash scripts/test.sh` | `384 passed` |
| `uv run bash scripts/lint.sh` | `Success: no issues found in 48 source files`; ty and ruff clean |

### Deviations from the proposal

None.

### Remaining work

- Parent-owned: sync the `pricing` delta into `openspec/specs/` and archive the change after
  verification.

### Workload / PR boundary

Single pull request, ~250 changed lines including the artifacts: low risk, no chain.

## Note on stored data

Nothing is rewritten. The rule applies to documents created from now on; historical
`DocumentLineTax` rows keep what they stored, which the `pricing` requirement already
demands. There is no migration in this change, in either direction.
