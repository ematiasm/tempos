# Verify Report: integrate-taxes-in-price-chain

Status: **PASS (verification)** — implementation complete and verified; archive NOT ready while the 3 parent-owned gates remain open.

Change: `integrate-taxes-in-price-chain` · Artifact store: openspec · Strict TDD: active (`openspec/config.yaml`)
Branches: PR 1 `pricing-tax-chain-backend` @ `9b16a63` (backend slice WU1–WU5 + WU8 + backend WU9), PR 2 `pricing-tax-chain-frontend` @ `877a8d4` (WU6–WU7 + frontend WU9, stacked on PR 1).

## 1. Task checkbox scan

Scanned `tasks.md` for `^\s*- \[ \]`. **No unchecked implementation tasks remain.** The only unchecked rows are the 3 parent-owned gate lines, which are explicitly out of implementation scope:

- `- [ ] Start or reuse bounded review. <!-- sdd-owner: parent -->`
- `- [ ] After apply: verify deployment sequence — ... <!-- sdd-owner: parent -->`
- `- [ ] Before archive: success-criteria walkthrough from proposal.md ... <!-- sdd-owner: parent -->`

(The fourth parent row — delivery decision — is marked `[x]` with the resolved 2-stacked-PR decision recorded inline.) Archive readiness therefore rests on the parent gates, not on incomplete implementation.

## 2. Spec coverage (`specs/pricing/spec.md`)

| Requirement | Implementation evidence | Test evidence |
|---|---|---|
| Price formation chain (margin over net) | `crud.py::_compute_precio_neto` / `_compute_product_prices` (reads only `(costo, margen, taxes, settings)`; `_compute_precio_venta` deleted); recompute wired in `create_product`, `update_product` (incl. `tax_ids`), `_apply_reference_cost` | `test_products_pricing.py`: chain math 181.50, percent+fixed 183.50 (fixed outside divisor), no-taxes neto==venta, PATCH-tax_ids recompute |
| Four-price exposure | `Product.precio_neto` persisted; `costo_con_impuestos` as `Product` display `@property`; both on `ProductPublic`/`ProductListItemPublic`; frontend `PriceChainPreview.tsx` shows all four in AddProduct + ProductDetailSheet; `productsColumns.tsx` adds `Precio neto` | `test_costo_con_impuestos_derivation` (121.00 → PATCH to 10.5% → 110.50 → exento → 0.00, no product edit) |
| One-IVA-per-product validation | `crud.py::_validate_product_taxes` + `validate_product_tax_ids` before `_sync_product_taxes`; route pre-validation in `routes/products.py`; `countSelectedIvas` + single-select IVA picker + disabled submit in frontend | second IVA rejected 400 `multiple_iva_taxes` on create AND update, with no-partial-assignment assertions; `exento` alone OK; `exento`+IVA rejected; IIBB+IVA accepted (186.00) |
| Rounding modes | `PriceRounding` enum + `BusinessSettings.price_rounding`; `_apply_price_rounding` (psychological_90: floor → +0.90, +1 if candidate < raw) applied ONLY to góndola; admin GeneralSettings Select | round-trip/422/default tests in `test_business_settings.py`; `test_rounding_modes_apply_only_to_gondola` (neto stays exact); **idempotency**: `test_recompute_idempotent_under_psychological_90` (363.00→363.90 stable, never compounded) |
| Document line tax decomposition (exact) | `crud.py::_decompose_line_taxes`: `neta = round2((bruto − fixed_total)/(1+Σ rates))`, montos in tax order, residual to LAST percent tax (or to neta when no percent taxes); runs only inside `_create_document_in_tx` | `test_documents.py`: single-IVA exact (150.00+31.50=181.50), adjust-last-percent (IIBB 4.52 residual), fixed outside divisor (183.99), historical immutability (byte-identical rows after tax PATCH), void-NC regenerates only `aplicado` taxes + identity on NC, quote→invoice identity; `_assert_identity(doc)` helper on each |
| Cost-change recompute | `_apply_reference_cost` → `_compute_product_prices` | `test_recompute_cost_change_via_reference_confirmation` (costo 200 → neto 300 / venta 363.00) |
| Seeds / demo data consistency | `demo_data.py::_margin_pct_from_gondola` chain inversion; rows built via `crud._compute_product_prices` (idempotent); `core/db.py` tax seeds unchanged per design | `test_setup.py::test_demo_products_satisfy_pricing_chain` — iterates all seeded products, independently reimplements the chain and the one-IVA rule |
| Reports compute margin over net | `routes/reports.py::margin_report`: `revenue_neto = Σ(subtotal_line − Σ aplicado montos)` from stored `DocumentLineTax`; `MarginRow.revenue_neto`; frontend `MarginTab.tsx` "Ingreso neto" | `test_reports.py::test_margin_report_computes_over_net_revenue` (181.50 gross / 150.00 net / margin 50.00 / 33.33%) |

All 9 spec requirements have both implementation and passing test evidence. No coverage gaps found.

## 3. Strict TDD compliance

`apply-progress.md` contains a `TDD Cycle Evidence` table covering WU3–WU8 (RED → GREEN → REFACTOR per unit; WU1/WU2 evidence was recorded in the reconstructed prior-run sections). Cross-referenced all named test files against the codebase — all exist: `test_business_settings.py`, `test_products_pricing.py` (new, 363 lines), `test_taxes.py`, `test_documents.py` (+348 lines), `test_reports.py`, `test_setup.py`. All still GREEN under the full-suite run below. Frontend has no unit-test harness; TDD evidence there is Playwright + tsc/biome (accepted by parent instruction).

## 4. Verification commands (exact results)

| Command | Result |
|---|---|
| `cd backend && uv run bash scripts/test.sh` | First run: **371 errors** — orphaned OPEN cash session in the dev DB (`BusinessError: A cash session is already open` from the setup fixture, the known setup failure mode). Closed it (`UPDATE cashregistersession SET status='CLOSED' WHERE status='OPEN'` — 1 row), re-ran: **371 passed** in 56.62s (91% coverage). |
| `cd backend && uv run bash scripts/lint.sh` | **Clean**: mypy --strict (49 files, 0 issues), ty (all checks passed), ruff check (clean), ruff format (49 files already formatted). |
| `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` | **Exit 0** (no output). |
| `cd frontend && bun run lint` | **Exit 0** (biome, 220 files checked, no fixes needed; 1 pre-existing config-migration info notice, unrelated). |
| Playwright spot-run: `bunx playwright test tests/catalog.spec.ts tests/admin.spec.ts tests/reports.spec.ts` | **25 passed** (7.2s). Full suite was run by apply at PR 2 head: 135 passed / 2 failed, both pre-existing `sign-up.spec.ts` zod-message failures reproduced at PR 1 head `9b16a63` with zero PR 2 changes — out of scope, auth untouched. |

## 5. Assertion quality audit

Overall high quality: real value assertions against independently computed expected figures (e.g. `neta = round2(186.50 / 1.24) = 150.40`), a shared `_assert_identity(doc)` helper enforcing the cent-exact decomposition identity, no-partial-assignment state re-reads after rejected updates, and a demo-data test that reimplements the chain independently rather than calling the code under test.

**One finding (WARNING, cosmetic):** `backend/tests/api/routes/test_documents.py` line ~1306 in `test_decomposition_adjust_last_percent_reconciles` contains a tautological/ghost assert:

```python
assert iva["base"] == "150.00" or True  # bases may differ per tax? No: same neta
```

It is dead code (`or True` always passes) and its comment contradicts the correct assertion on the very next line (`assert iva["base"] == iibb_row["base"] == "150.40"`, which is the real check). No test coverage is lost by removing it; fixing is left to the parent/apply since verify does not fix.

## 6. Review workload / PR boundary verification

- Forecast: ~1000–1400 lines, 2 stacked PRs, `stacked-to-main`, High 400-line risk. Confirmed in tasks.md and the resolved delivery-decision row.
- **PR 1** (`9b16a63`): only `backend/**` (15 files, +1321/−57 — roughly 900 of which are tests), `CHANGELOG.md`, and openspec artifacts. No frontend files. ✅ assigned slice only.
- **PR 2** (`877a8d4`): only `frontend/**` (12 files, +602/−37 incl. openspec; ~530 excluding openspec, of which +62/−7 is generated client) plus openspec progress/tasks updates. Zero backend files in its own commit (backend paths in the naive `main..` diff belong to stacked PR 1 — verified via `git show 877a8d4 --stat`). ✅ assigned slice only.
- Combined implementation volume (~1.85k lines incl. tests, excluding openspec docs and most of the generated client) slightly exceeds the upper forecast, driven by the +830 lines of new/updated backend tests the strict-TDD cycle demanded. No scope creep: every changed file maps to a WU in tasks.md. `size:exception` was not invoked; the user-accepted 2-PR split covered the budget risk.

## 7. Documented deviations

1. **psychological_90 uses `base + 0.90`, design.md text says `base + 0.80`.** The design's own verified examples (181.50→181.90, 181.95→182.90) are only consistent with +0.90, and the spec requirement/scenario mandates "round UP to the next value ending in `.90`". The implementation and tests match the spec; the design prose is the typo. Deviation upheld — recommend the parent note the design correction at archive.
2. **`costo_con_impuestos` as a `Product` `@property` instead of per-route population.** The spec requires display-derived, "MUST NOT require a persisted model field", and derived from the current tax assignment. The property reads the already-loaded `taxes` relationship (no extra query), is picked up by every product-returning route via `from_attributes`, and `test_costo_con_impuestos_derivation` proves it reflects a tax PATCH with no product edit. Deviation upheld — it satisfies the spec more uniformly than the design's route plumbing.
3. **WU3 conftest IIBB seed omitted** (tests self-provision IIBB via the taxes API) and demo leftovers renamed instead of deleted (document FKs) — benign, tests prove the behavior.

## Blockers

None for verification. Archive readiness is gated on the 3 parent-owned rows: bounded review, post-apply deployment-sequence verification (`alembic upgrade head` → `docker compose down -v` → reseed → client regen; rollback = `git revert` + `alembic downgrade -1`), and the pre-archive success-criteria walkthrough. Operational notes for the parent: the dev-DB OPEN cash session I closed to run the suite; `docker compose watch` left running by apply (pid in `/tmp/compose-watch.log`); the 2 pre-existing sign-up Playwright failures; and the 1 tautological assert flagged in §5.
