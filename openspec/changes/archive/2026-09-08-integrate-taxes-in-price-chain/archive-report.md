# Archive Report: integrate-taxes-in-price-chain

## Status

**archived** — 2026-09-08. Moved to `openspec/changes/archive/2026-09-08-integrate-taxes-in-price-chain/`.

## Artifacts read

- `proposal.md`, `specs/pricing/spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `sync-report.md`

## Preconditions

- Verify report: **PASS** (all implementation tasks 34/34 checked; no CRITICAL issues).
- Sync report: **synced** (`openspec/specs/pricing/spec.md` created — new canonical domain, 8 requirements).
- Unchecked implementation tasks: **none**. All 4 parent-owned rows resolved (see below).
- Destructive merge: **not applicable** — new-domain full copy, no `REMOVED`/`MODIFIED` delta sections; no approval needed.

## Parent-owned actions resolution

1. **Bounded review**: formal RDD bounded review never enabled (user-owned switch off). Review coverage was provided by a read-only ARCA/AFIP-readiness review of the merged implementation (no blockers; 5 refinement findings recorded in project memory under `tempos/arca-readiness-review-pricing-chain`).
2. **Delivery decision**: resolved pre-apply (2 stacked PRs, `stacked-to-main`) — PRs #31/#32 squash-merged to `main` (`5244707`, `e8643c3`).
3. **Deployment sequence**: verified 2026-09-08 — migration `05cf4ac88022` at head (additive only), `docker compose down -v` + reseed executed (superuser + base seeds present; `/setup` first-run pending user's business data), client regen committed in the PRs, `alembic downgrade -1` drops exactly the two added columns, health check OK. Pre-wipe dump kept at `/tmp/tempos_pre_wipe_backup.sql`.
4. **Success-criteria walkthrough** (from `proposal.md`), all evidenced by tests in the merged tree:
   - 4-price chain: `costo 100 / margen 50 / IVA 21% → neto 150.00, góndola 181.50` (`test_products_pricing.py::test_...chain...`).
   - Rounding modes: `181.50→181.90`, `181.95→182.90` under `psychological_90`; `none`/`two_decimals` exact; idempotency `363.00→363.90` stable.
   - Cent-exact decomposition: `_assert_identity` over single/multi/fixed-tax cases (e.g. `186.50 → neta 150.40 + IVA 31.58 + IIBB 4.52`).
   - Gross totals: `total = subtotal − descuento_total + Σ percepciones` unchanged; breakdown never alters totals.
   - One-IVA rule: `multiple_iva_taxes` enforced (exento counts) across create/patch/quote-conversion paths.
   - Margin-over-net reports: `revenue_neto = 150.00` for the anchor case (`test_reports.py`).
   - Seeded consistency: `test_demo_products_satisfy_pricing_chain` validates every demo product against the chain.

## Post-verify parent cleanup (recorded)

- Removed the tautological `or True` assert flagged in verify §5 (focused tests green).
- Fixed design.md prose `base + 0.80` → `base + 0.90` (verify §7 deviation 1; implementation was always +0.90).
