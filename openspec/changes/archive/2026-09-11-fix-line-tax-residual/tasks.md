# Tasks: fix-line-tax-residual

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250 (the assignment ~12 lines; the test ~8; change artifacts ~230) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low
```

Reasoning: one arithmetic rule, one test and one spec delta. Nothing to chain.

Strict TDD is enabled (`openspec/config.yaml`). The change has a genuine RED already
observed: the test flipped between `31.58` and `31.59` depending on the order the database
returned the product's taxes in, failing 2 of 4 runs of that file. That observation is the
failing behaviour this unit fixes, and it is recorded in the issue with the raw assertion.

---

## Work Unit 1 — Assign the residual deterministically

- [x] RED (already observed, recorded in issue #51): the decomposition test failed 2 of 4
      runs of `tests/api/routes/test_documents.py` with
      `assert iva["monto"] == "31.58"` receiving `31.59`, because the residual cent lands on
      whichever percent tax comes last in an unordered collection. <!-- sdd-owner: implementation -->
- [x] GREEN: in `crud._decompose_line_taxes`, assign the residual to the percent tax with the
      largest `monto`, ties broken by tax id, replacing the adjust-last loop. Update the
      docstring, which claimed a determinism the code did not have.
      <!-- sdd-owner: implementation -->
- [x] Update the test to assert the rule rather than a position, and rename it accordingly.
      <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: run that file repeatedly and confirm it no longer flips; run the full
      backend suite to confirm no other assertion depended on the previous outcome.
      <!-- sdd-owner: implementation -->
- [x] Verify: `cd backend && uv run bash scripts/test.sh` and `uv run bash scripts/lint.sh`.
      <!-- sdd-owner: implementation -->
- [x] Record the result in `apply-progress.md`. <!-- sdd-owner: implementation -->

## Parent-owned lifecycle

- [x] Sync the delta into `openspec/specs/pricing/spec.md` and archive this change after
      verification. <!-- sdd-owner: parent -->
