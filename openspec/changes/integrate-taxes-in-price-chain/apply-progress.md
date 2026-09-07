# Apply Progress: integrate-taxes-in-price-chain

Artifact store: openspec (authoritative). Branch: `pricing-tax-chain-backend`. Delivery: stacked PRs — PR 1 backend slice (WU1–WU5 + WU8 + WU9 backend gates), PR 2 client regen + frontend (WU6–WU7).

This file was reconstructed by the second `sdd-apply` continuation run: the first run completed WU1 + WU2 (11 checkboxes, 29 tests green, migration `05cf4ac88022_add_price_rounding_and_precio_neto.py` created and applied) but timed out early in WU3 and never persisted progress (no prior file, no Engram topic). Progress below merges the reconstructed prior state with this run's work.

## Completed (cumulative)

### WU1 — price_rounding setting + migration (prior run, verified in tree)
- `PriceRounding` str-enum + `BusinessSettings.price_rounding` (String(20) col, default `none`), exposed in `BusinessSettingsPublic`/`BusinessSettingsUpdate`.
- `Product.precio_neto` Numeric(12,2) NOT NULL default 0.
- Migration `05cf4ac88022_add_price_rounding_and_precio_neto.py` (spurious index drop removed) created and applied.
- Tests: `test_business_settings.py` round-trip / 422 / default (green).

### WU2 — pricing chain helpers + recompute (prior run, verified in tree)
- `crud.py`: `_round2`, `_read_price_rounding`, `_compute_precio_neto`, `_apply_price_rounding` (psychological_90: floor → +0.90, +1 if candidate < raw), `_product_line_taxes`, `_compute_product_prices`; `_compute_precio_venta` deleted; recompute wired in `create_product`, `update_product` (cost/margin change OR tax_ids), `_apply_reference_cost`.
- Tests: `test_products_pricing.py` chain math, percent+fixed coexist, no-taxes identity, rounding modes (góndola only), reference-cost recompute, psychological_90 idempotency, PATCH tax_ids recompute (all green).

### WU3 — one-IVA validation + fixed-tax positivity (previous run had started; completed + verified this run)
- `_validate_product_taxes` / `validate_product_tax_ids` in `crud.py` (counts tipo IVA regardless of `exento`, `BusinessError("multiple_iva_taxes")` before `_sync_product_taxes` persists — no partial assignment).
- Route pre-validation `_ensure_single_iva` in `routes/products.py` (create + update, `400 {"code": "multiple_iva_taxes"}`), same pattern as `stock_maximo_below_minimo`.
- `routes/taxes.py`: `_ensure_valid_fixed_amount` on create + update (`is_percent=false` with `rate <= 0` → `400 {"code": "invalid_fixed_tax_amount"}`; percent may be 0).
- Defensive `BusinessError("invalid_fixed_tax_amount")` in `_product_line_taxes` + `_decompose_line_taxes`.
- Tests: `test_products_pricing.py` second-IVA rejected (update + create, no partial assignment), `exento` alone, `exento`+IVA rejected, IIBB+IVA accepted (`186.00`); `test_taxes.py` fixed-positivity create/update with stored rate untouched. **Note:** the previous run's plan to seed an IIBB tax in `conftest.py` was unnecessary — the tests self-provision IIBB via the taxes API (the conftest diff is only an import sort).

### WU4 — exact document line-tax decomposition (previous run had tests + impl mostly in tree; completed + verified this run)
- `_decompose_line_taxes(subtotal_bruto, taxes)` in `crud.py`: `neta = round2((bruto − fixed_total) / (1 + Σ rates/100))`, percent montos in tax order, residual added to the LAST percent tax (or to `neta` when no percent taxes); all Decimal + ROUND_HALF_UP; runs only inside `_create_document_in_tx` (stored rows never rewritten).
- Tests in `test_documents.py`: single-IVA exact (181.50 → 150.00 + 31.50), adjust-last-percent (186.50 → residual 0.01 on IIBB), fixed outside divisor (183.99 → residual 0.01 on IVA), historical immutability after tax PATCH, void-NC regenerates only `aplicado` taxes + identity holds on the NC, quote→invoice conversion identity + row equality.
- REFACTOR of old-math tests:
  - `test_create_sale_document_computes_totals_and_taxes`: default `margen` 21.00 → 0.00 (neto 100.00, góndola 121.00 preserves all totals); breakdown assertions moved from old `monto = bruto × rate` to exact decomposition (`217.80 → 180.00 + 37.80`; `90.00 → 74.38 + 15.62`).
  - `test_document_level_percepciones_add_to_total`: product without line taxes now prices at neto 100.00 (was 121.00); doc-level percepción base 200.00 / monto 6.00 / total 206.00.
- `test_document_voids.py`, `test_document_convert.py`, `test_products.py`, `test_items.py`: unchanged and green.

### WU5 — API schemas + margin-over-net report
- `models.py`: `Product.costo_con_impuestos` display-derived property (`costo + round2(costo × single percent-IVA rate/100)`, 0.00 when no percent IVA / exento / 0%; fixed taxes excluded) read from the already-loaded `taxes` relationship — no extra query, no route plumbing (FastAPI/`model_validate` pick up the property via `from_attributes`).
- `costo_con_impuestos` added to `ProductPublic` + `ProductListItemPublic` (four prices complete for `/sell` search and lists).
- `routes/reports.py` `margin_report`: `revenue_neto = Σ (subtotal_line − Σ aplicado line-tax montos)` from stored `DocumentLineTax` rows; `margin = revenue_neto − cost`; `margin_pct = margin / revenue_neto × 100`; `MarginRow.revenue_neto` added; gross `revenue` unchanged.
- Tests: `test_products_pricing.py::test_costo_con_impuestos_derivation` (121.00 → PATCH IVA 10.5% → 110.50 → exento → 0.00, no price edit); `test_reports.py::test_margin_report_computes_over_net_revenue` (181.50 gross / 150.00 net / margin 50.00 / 33.33%); existing margin report test (no taxes) still green.

### WU8 — demo data chain inversion + CHANGELOG
- `demo_data.py`: `_margin_pct` → `_margin_pct_from_gondola(costo_actual, gondola, percent_rates)` (neto = gondola/(1+Σ rates/100), margen = round2 HALF_UP); rows built BY the chain: `crud._compute_product_prices` after flushing the IVA21 link, so stored (neto, góndola) are exactly what recomputation reproduces (idempotent); "precio_venta carries IVA inside" comment rewritten.
- `core/db.py` tax seeds unchanged (IVA 21/10.5/27/0 + exento; IVA21 single default) — task marked done as "unchanged" per design.
- `test_setup.py::test_demo_products_satisfy_pricing_chain` (RED→GREEN): renames leftover demo-named products (deletion unsafe — document FKs), reloads, asserts for every demo product: ≤1 tipo-IVA tax and `precio_neto`/`precio_venta` == independently reimplemented chain math (`round_mode(neto + Σ line taxes)`).
- `CHANGELOG.md` (new file): pricing-chain semantics change + rollout note (migration → `docker compose down -v` volume wipe → reseed → client regen; pre-change `margen_pct` interpretation discarded; rollback path).

### WU9 — backend validation gates
- `cd backend && uv run bash scripts/test.sh`: **371 passed** (full suite, docker db up). Note: `scripts/test.sh` needs the repo-root venv on PATH (`uv run bash scripts/test.sh`) because `coverage` is not installed globally.
- `cd backend && uv run bash scripts/lint.sh`: mypy --strict clean (49 files), ty clean, ruff clean, ruff format clean (one import-sort + one format fix applied to `demo_data.py`/`crud.py`).

## Files changed (working tree, uncommitted; parent owns git)

- `backend/app/models.py` (PriceRounding, BusinessSettings.price_rounding, Product.precio_neto, Product.costo_con_impuestos property, ProductPublic/ProductListItemPublic four prices, MarginRow.revenue_neto)
- `backend/app/crud.py` (chain helpers, validate_product_tax_ids, _decompose_line_taxes, recompute wiring, _apply_reference_cost)
- `backend/app/api/routes/products.py` (_ensure_single_iva pre-validation)
- `backend/app/api/routes/taxes.py` (_ensure_valid_fixed_amount)
- `backend/app/api/routes/reports.py` (margin_report over revenue_neto)
- `backend/app/demo_data.py` (chain inversion + chain-built rows)
- `backend/app/alembic/versions/05cf4ac88022_add_price_rounding_and_precio_neto.py` (new, prior run)
- `backend/tests/conftest.py` (import sort only)
- `backend/tests/api/routes/test_business_settings.py`, `test_products_pricing.py` (new), `test_taxes.py`, `test_documents.py`, `test_reports.py`, `test_setup.py`
- `CHANGELOG.md` (new)

## Deviations from design

- `design.md` states the psychological_90 formula as `base + 0.80` — internally inconsistent with its own verified examples (181.50→181.90). Implementation (prior run, WU2) uses `base + 0.90`, which matches the verified examples and the passing tests. Kept; tests are the truth.
- `costo_con_impuestos` implemented as a `Product` property rather than per-route population: design said "populated in the routes"; the property achieves the same (read from loaded `taxes`, no extra query) across every product-returning route (list, search, create, update) without duplicating plumbing. OpenAPI shape identical.
- WU3 conftest IIBB seed from the previous run's notes: not needed (tests self-provision IIBB via API); `test_setup.py` deletes/renames demo leftovers by renaming (not deleting) because demo products can be FK-referenced by documents from other tests.

## Remaining (deferred to PR 2 — NOT part of this backend slice)

- `- [ ]` WU6 client regeneration (`bash ./scripts/generate-client.sh` + frontend tsc) — **explicitly skipped per parent instruction (do NOT run generate-client.sh)**.
- `- [ ]` WU7 all frontend tasks (AddProduct, ProductDetailSheet, productsColumns, MarginTab/VatTab, GeneralSettings, i18n).
- `- [ ]` WU9 frontend gates: `cd frontend && bunx tsc -p tsconfig.build.json --noEmit`, `cd frontend && bun run lint`, Playwright critical-flow suite.
- Parent-owned rows (preserved byte-for-byte): bounded review; post-apply deployment-sequence verification; pre-archive success-criteria walkthrough.

## TDD Cycle Evidence (this run)

| Task | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| WU3 one-IVA + fixed positivity | new tests failed vs absent validation (prior run started RED) | `test_products_pricing.py` 12 passed, `test_taxes.py` 10 passed | no-partial-assignment assertions; naming vs `_sync_product_taxes` |
| WU4 decomposition | `test_create_sale_document_computes_totals_and_taxes` red on old math; new identity tests red vs old `monto=bruto×rate` | `test_documents.py` 29 passed | old-math assertions updated to exact decomposition; voids/convert suites re-run green |
| WU5 four prices + net margin | `test_costo_con_impuestos_derivation`, `test_margin_report_computes_over_net_revenue` failed (missing field/`revenue_neto`) | pricing 13 passed, reports 13 passed, items green | property-based derivation, no extra query |
| WU8 demo chain | `test_demo_products_satisfy_pricing_chain` red (`precio_neto` 0 vs chain) | `test_setup.py` 7 passed | loader reuses `crud._compute_product_prices` |

## Status

- Backend slice (PR 1 scope: WU1–WU5, WU8, WU9 backend gates) COMPLETE. 29/29 checkboxes implementation-owned and in-scope are `[x]`; remaining unchecked rows are WU6/WU7/WU9-frontend (deferred to PR 2) and parent-owned gates.
- Strict TDD active and followed per WU (evidence table above).
- `actionContext` warnings: none beyond the inherited status fields; no `workspace-planning` mode; all edits inside `/home/mamull/tempos`.
- Not done (by instruction): generate-client.sh, frontend validation, no commits.
