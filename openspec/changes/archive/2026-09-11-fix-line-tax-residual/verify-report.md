# Verify Report: fix-line-tax-residual

## Status

**PASS.** The residual assignment is deterministic, the rule is stated in `pricing`, and the
file that used to flip passes repeatedly. No blockers.

## Spec coverage

The change modifies one requirement, `Document line tax decomposition (exact)`, now carrying
six scenarios:

| Scenario | How it is verified |
|---|---|
| Exact decomposition of a gross line with IVA 21% | Existing scenario, untouched; the single-tax case leaves no residual, and the suite covers it. |
| Multi-tax line sums back to gross | Existing scenario, untouched; fixed taxes stay outside the divisor. |
| The residual cent does not depend on tax order | New. `crud._decompose_line_taxes` picks the percent tax with the largest `monto`, so the outcome cannot depend on input order. The integration test asserts the resulting values (`31.59` on IVA over `4.51` on IIBB) and the previously flaky file passed six consecutive runs. |
| Ties break by tax id | New. The implementation uses `min(..., key=lambda t: (-montos[t.id], t.id))`, so equal montos resolve on the id. |
| Document totals remain gross | Existing scenario, untouched; no total-producing code changed. |
| Historical documents are immutable | Existing scenario, untouched; nothing rewrites stored rows, and this change adds no migration. |

## Task completion

Six implementation-owned tasks: **all checked**. One parent-owned action remains open by
design (the sync and archive, performed alongside this report).

## Strict TDD compliance

Strict TDD is active and this unit has genuine RED evidence, observed before the fix and
recorded in issue #58: `tests/api/routes/test_documents.py` failed 2 of 4 runs with
`assert iva["monto"] == "31.58"` receiving `31.59`. GREEN follows from the assignment change,
and TRIANGULATE from six consecutive green runs of that file plus the full suite.

The evidence mattered here beyond form: the failing assertion was the only signal that a
stored fiscal breakdown was not reproducible, and treating it as flakiness would have left
the non-determinism in production.

## Assertion quality

The updated test asserts the rule rather than a position: the residual is expected on the
tax with the larger monto, with both rows asserted so the split is pinned in both
directions, and the identity is checked. The test also carries its new name, so it no longer
claims an "adjust-last" behaviour the code does not implement.

## Validation commands

| Command | Result |
|---|---|
| `uv run pytest tests/api/routes/test_documents.py -q` (before) | `1 failed, 36 passed` in 2 of 4 runs |
| `uv run pytest tests/api/routes/test_documents.py -q` (after, six consecutive runs) | `37 passed` every time |
| `uv run bash scripts/test.sh` | `384 passed` |
| `uv run bash scripts/lint.sh` | mypy clean (48 files), ty and ruff clean |
| CI on #59 | `pre-commit`, `test-backend`, `test-docker-compose`, `zizmor` and Playwright shards 1, 3 and 4 pass. Shard 2 fails only on the unrelated pre-existing `reports.spec.ts:79` flake (issue #38). `check-labels` fails on every pull request because its pinned action cannot build. |

## Review workload findings

One pull request, ~250 lines including the artifacts: low risk, no chain.

## Findings carried forward

1. The shelf-price rounding feature (`price_rounding`) is unused — `none` in the only
   installation, zero products priced at `.90` — and scheduled for removal as its own change.
2. Five canonical specs remain delta-shaped and need normalising.
3. `check-labels` cannot pass on any pull request because its pinned action no longer builds.
4. `reports.spec.ts:79` fails intermittently on shard 2, on `main` as well (issue #38).
5. The frontend has no unit-test harness.

## Blockers

None.
