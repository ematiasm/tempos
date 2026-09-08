# Sync Report: integrate-taxes-in-price-chain

## Status

**synced** — 2026-09-08, run by the parent orchestrator (sdd-sync semantics) after PR #31 / #32 merge.

## Domains synced

| Domain | Mode | Canonical file |
|---|---|---|
| `pricing` | new canonical spec (full copy — no `openspec/specs/pricing/spec.md` existed) | `openspec/specs/pricing/spec.md` |

## Canonical files updated

- `openspec/specs/pricing/spec.md` — created (8 requirements, full domain spec: price formation chain, four-price exposure, one-IVA validation, rounding modes, exact line-tax decomposition, cost-change recompute, seeds consistency, margin-over-net reports).

## ADDED / MODIFIED / REMOVED requirements

- ADDED (new canonical domain, all 8 requirements): Price formation chain (margin over net); Four-price exposure; One-IVA-per-product validation; Rounding modes (`price_rounding`); Exact document line-tax decomposition; Cost-change recompute; Seeds/demo consistency; Reports margin over net.
- MODIFIED: none.
- REMOVED: none.

## Collisions / warnings

- No other active change touches `specs/pricing/spec.md` (verified: the only active change at sync time was `integrate-taxes-in-price-chain`).
- No delta operations applied (new-domain copy); no destructive merge performed — no REMOVED or MODIFIED sections existed, so no destructive-merge approval was needed.

## Validation

- Change spec is the merged implementation's accepted behavior (verify report: PASS; PRs #31/#32 squash-merged to `main` at `e8643c3`).
- Tautological `or True` assert flagged by the verify report was removed in the parent's post-merge cleanup (focused tests green).

## Next recommended phase

`sdd-archive` (change folder move to `openspec/changes/archive/2026-09-08-integrate-taxes-in-price-chain/`) after the parent-owned pre-archive walkthrough is recorded.
