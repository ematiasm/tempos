# Tasks: integrate-taxes-in-price-chain

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1000–1400 (backend chain/decomposition/tests ~40%, frontend ~40%, seeds/i18n/migration ~20%; generated client excluded) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: backend (WU1–WU5 + WU8 backend seeds) → PR 2: client regen + frontend (WU6–WU7 + i18n) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Reasoning: ~15–20 files, new migration, document-decomposition rewrite with test updates, OpenAPI shape change forcing client regen, and frontend across Products/Reports/Admin. Exceeds a single 400-line PR; backend-first split per design "Rollout". Chain/delivery decision is deferred to the user (ask-on-risk) before apply.

Strict TDD is enabled (`openspec/config.yaml`): every behavior work unit is sequenced RED → GREEN → TRIANGULATE → REFACTOR. Backend tests require the docker compose db service up and migrations applied; they are non-parallel-safe.

---

## Work Unit 1 — Backend: `price_rounding` setting + migration

- [x] RED: add failing tests to `backend/tests/api/routes/test_business_settings.py` — `price_rounding` round-trip via `PATCH /business-settings/` (`none` / `two_decimals` / `psychological_90`), invalid value → 422, default `none` on the singleton. <!-- sdd-owner: implementation -->
- [x] GREEN: add `PriceRounding(str, Enum)` (`none`, `two_decimals`, `psychological_90`) next to `StockPolicy`/`NumberFormat` in `backend/app/models.py`; add `price_rounding: PriceRounding = Field(default=PriceRounding.NONE, max_length=20)` to `BusinessSettings` after `default_margen_pct`; expose in `BusinessSettingsPublic` (required) and `BusinessSettingsUpdate` (`PriceRounding | None`). Verify GREEN via `cd backend && uv run pytest tests/api/routes/test_business_settings.py -x`. <!-- sdd-owner: implementation -->
- [x] Also in `backend/app/models.py` (same unit, per the single-migration plan): add `Product.precio_neto: Decimal = Field(default=Decimal("0"), max_digits=... via sa.Numeric(12,2), nullable=False)` so the one migration covers both columns; WU2 wires recompute. <!-- sdd-owner: implementation -->
- [x] Generate `backend/app/alembic/versions/<rev>_add_price_rounding_and_precio_neto.py` with `uv run alembic revision --autogenerate -m "add_price_rounding_and_precio_neto"`; hand-edit: (a) `businesssettings.price_rounding` `sa.String(20)` NOT NULL `server_default="none"`; (b) `product.precio_neto` `sa.Numeric(12,2)` NOT NULL `server_default="0"`; (c) **hand-remove the spurious `op.drop_index` for `uq_cashregistersession_single_open`** (AGENTS.md §9); (d) `downgrade()` drops exactly those two columns; no data migration. Confirm no other spurious diffs. <!-- sdd-owner: implementation -->
- [x] Apply migration and verify RED→GREEN: `uv run alembic upgrade head` then `cd backend && uv run pytest tests/api/routes/test_business_settings.py -x`. <!-- sdd-owner: implementation -->
- [x] REFACTOR: keep enum placement/naming consistent with existing str-enum pattern; run `cd backend && bash scripts/lint.sh`. <!-- sdd-owner: implementation -->

## Work Unit 2 — Backend: pricing chain helpers + `precio_neto` recompute (replaces `_compute_precio_venta`)

- [x] RED: create `backend/tests/api/routes/test_products_pricing.py` — chain-math API round-trip scenarios: costo 100 / margen 50 / IVA 21% / `none` → `precio_neto=150.00`, `precio_venta=181.50`; percent+fixed coexist → `183.50` (fixed added once, outside divisor); no line taxes → `góndola = neto = 150.00`. <!-- sdd-owner: implementation -->
- [x] GREEN: in `backend/app/crud.py` add `_read_price_rounding`, `_compute_precio_neto`, `_apply_price_rounding` (`psychological_90`: `base = raw.quantize(1, ROUND_FLOOR); candidate = base + 0.80; if candidate < raw: candidate += 1`; verified `181.50→181.90`, `181.95→182.90`, `181.90→181.90`, `181.00→181.90`), and `_compute_product_prices(session, product) -> (neto, venta)` reading `product.taxes` + settings singleton fresh, `ROUND_HALF_UP` to `0.01`; delete `_compute_precio_venta` (`crud.py:162`) and set `precio_neto` + `precio_venta` in `create_product` (`crud.py:169`), `update_product` (extend `needs_recompute` to fire when `tax_ids` provided, not only cost/margin), and `_apply_reference_cost` (`crud.py:1151-1163`). <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: extend `test_products_pricing.py` — rounding modes (`none`/`two_decimals`/`psychological_90`, applied ONLY to `precio_venta`; neto/costo stay exact 2-dec); cost-change recompute via reference-supplier confirmation (`costo 200 → neto 300, venta 363.00`); idempotent second recompute under `psychological_90` (`363.00 → 363.90` stable, never compounded); PATCH of `tax_ids` alone triggers góndola recompute. <!-- sdd-owner: implementation -->
- [x] REFACTOR: verify idempotency invariant (chain reads only `(costo_actual, margen_pct, taxes, settings)`), helper naming vs existing crud style; run `cd backend && uv run pytest tests/api/routes/test_products_pricing.py tests/api/routes/test_products.py -x`. <!-- sdd-owner: implementation -->

## Work Unit 3 — Backend: one-IVA-per-product + fixed-tax positivity validation

- [x] RED: extend `test_products_pricing.py` — second IVA rejected `400 {"code": "multiple_iva_taxes"}` with no partial assignment; `exento` alone accepted (0% chain); `exento` + IVA 21 rejected (same code); IIBB + IVA accepted and both enter the góndola sum. Add fixed-positivity cases to `backend/tests/api/routes/test_taxes.py` — create/update `is_percent=false` with `rate <= 0` → `400 {"code": "invalid_fixed_tax_amount"}`. <!-- sdd-owner: implementation -->
- [x] GREEN: in `backend/app/crud.py` add `_validate_product_taxes(taxes)` next to `_sync_product_taxes` (`crud.py:200`) counting `tipo == TaxType.IVA` taxes regardless of `exento`, raising `BusinessError("multiple_iva_taxes", ...)`; call from `create_product`/`update_product` BEFORE `_sync_product_taxes` persists; add shared route-level pre-validation in `backend/app/api/routes/products.py` translating to the `HTTPException(400, {"code": "multiple_iva_taxes"})` shape (same pattern as `stock_maximo_below_minimo`). In `backend/app/api/routes/taxes.py` reject `is_percent=false` with `rate <= 0` → `400 {"code": "invalid_fixed_tax_amount"}`; add the defensive `BusinessError("invalid_fixed_tax_amount")` check in the chain helpers/decomposition (never silently skipped). <!-- sdd-owner: implementation -->
- [x] TRIANGULATE + REFACTOR: assert no partial tax assignment persists after a rejected update (product taxes unchanged); run `cd backend && uv run pytest tests/api/routes/test_products_pricing.py tests/api/routes/test_taxes.py -x`. <!-- sdd-owner: implementation -->

## Work Unit 4 — Backend: exact document line-tax decomposition (adjust-last-percent reconciliation)

- [x] RED: extend `backend/tests/api/routes/test_documents.py` — cent-exact identity `neta + Σ montos == subtotal_bruto` for: single IVA (`181.50` → `neta 150.00 + 31.50`); multi-percent; percent + fixed (`183.50`: fixed `2.00` outside the divisor); document totals remain gross (`total = subtotal - descuento_total + Σ percepciones`); historical immutability (create doc, change product taxes, stored `DocumentLineTax` rows byte-identical); `aplicado` toggle → void NC regenerates only `aplicado` taxes (`crud.py:901`) and the regenerated NC breakdown satisfies the identity; quote→invoice conversion (`crud.py:1049`) likewise. <!-- sdd-owner: implementation -->
- [x] GREEN: rewrite the line-tax breakdown in `backend/app/crud.py` (`create_document`/`_create_document_in_tx`, ~434–560, and `DocumentLineTax` construction ~728–733) per design decision (b): `fixed_total = Σ T_f`; `neta = round_2((bruto − fixed_total) / (1 + Σ rates_p/100))`; per-tax `monto_i = round_2(neta × rate_i/100)` in `tax_ids` order; `residual` added to the LAST percent tax's monto (or to `neta` when no percent taxes); all arithmetic `Decimal` + `ROUND_HALF_UP` `0.01`; do NOT change `_money()`; decomposition runs only at creation inside `_create_document_in_tx` (no path rewrites stored rows). <!-- sdd-owner: implementation -->
- [x] REFACTOR: update any existing document tests asserting the old `monto = bruto × rate` math to the exact decomposition; verify `aplicado` toggles never edit `monto`; run `cd backend && uv run pytest tests/api/routes/test_documents.py tests/api/routes/test_document_voids.py tests/api/routes/test_document_convert.py -x`. <!-- sdd-owner: implementation -->

## Work Unit 5 — Backend: API schemas, margin-over-net report, route wiring

- [x] RED: extend `test_products_pricing.py` — `costo_con_impuestos` derivation (PATCH IVA 21% → 10.5% reflects `110.50` without product edit); extend `backend/tests/api/routes/test_reports.py` — margin report computed over net revenue with `revenue_neto` in `MarginRow`. <!-- sdd-owner: implementation -->
- [x] GREEN: in `backend/app/models.py` add `precio_neto: Decimal` and `costo_con_impuestos: Decimal` (display-derived: `costo_actual + round_2(costo_actual × iva_rate/100)`, `0` when no IVA / `exento` / 0%; fixed taxes excluded) to `ProductPublic` and `ProductListItemPublic` (`models.py:1530-1573`); populate in `backend/app/api/routes/products.py` (and any product-row search route feeding `/sell`) from the already-loaded `product.taxes` relationship. In `backend/app/api/routes/reports.py` (`margin_report`, ~198–258): revenue base = `subtotal_line − Σ(aplicado line tax montos)` from stored `DocumentLineTax` rows; `margin = revenue_neto − cost`; `margin_pct = margin / revenue_neto × 100`; add `revenue_neto` to `MarginRow`. <!-- sdd-owner: implementation -->
- [x] REFACTOR: verify `/sell` product search returns the four prices with no extra query; run `cd backend && uv run pytest tests/api/routes/test_products_pricing.py tests/api/routes/test_reports.py tests/api/routes/test_items.py -x`. <!-- sdd-owner: implementation -->

## Work Unit 6 — Client regeneration

- [x] From repo root: `bash ./scripts/generate-client.sh`, then `cd frontend && bunx tsc -p tsconfig.build.json --noEmit`; fix hand-written code only (client types under `frontend/src/client/` are generated, AGENTS.md §5.3). Commit regenerated client with the backend PR or as PR 2 head per the delivery decision. <!-- sdd-owner: implementation -->

## Work Unit 7 — Frontend: forms, detail, price list, reports, admin setting, i18n

- [x] `frontend/src/components/Products/AddProduct.tsx`: single-select IVA picker (radio-style listing tipo-IVA taxes + "Sin IVA / 0%"), other tipos (IIBB, Interno, PercGan, Otro) stay multi-select; disable submit + translated `multiple_iva_taxes` error on two IVAs; live-computed four-price chain preview from costo/margen/taxes/rounding setting. <!-- sdd-owner: implementation -->
- [x] `frontend/src/components/Products/ProductDetailSheet.tsx` (product edit AND detail — there is no `EditProduct.tsx`; editing routes through this file's `updateProduct`): show the four prices (`costo_actual`, costo con impuestos, `precio_neto`, `precio_venta`); apply the same single-IVA picker to its edit form; surface `multiple_iva_taxes` / `invalid_fixed_tax_amount` via `handleError`. <!-- sdd-owner: implementation -->
- [x] `frontend/src/components/Products/productsColumns.tsx`: add `Precio neto` column, keep `Precio venta` (góndola). <!-- sdd-owner: implementation -->
- [x] Amendment (user follow-up): editable Precio neto in AddProduct and ProductDetailSheet deriving `margen_pct` via `margenPctFromNeto` (frontend-only translation, no API change); negative-margin warning in PriceChainPreview; i18n es/en. <!-- sdd-owner: implementation -->
- [x] `frontend/src/components/Reports/MarginTab.tsx`: show `Ingreso neto` (`revenue_neto`) next to `Ingreso bruto`; compute displayed margin over net. Verify `frontend/src/components/Reports/VatTab.tsx` displays the now-exact net bases coherently (code-unchanged). <!-- sdd-owner: implementation -->
- [x] `frontend/src/components/Admin/GeneralSettings.tsx`: `price_rounding` shadcn `Select` (Sin redondeo / Dos decimales / Psicológico (.90)) with copy stating existing products reprice on their next write/cost recompute. <!-- sdd-owner: implementation -->
- [x] `frontend/src/i18n/*`: es/en strings for new labels plus `multiple_iva_taxes` / `invalid_fixed_tax_amount` error codes. <!-- sdd-owner: implementation -->

## Work Unit 8 — Seeds, demo data, CHANGELOG rollout note

- [x] `backend/app/demo_data.py`: replace `_margin_pct` (`demo_data.py:52-61`) with `_margin_pct_from_gondola(costo_actual, gondola, taxes)` inverting the new chain (IVA 21%: `neto = gondola / 1.21`, `margen_pct = round_2((neto/costo − 1) × 100)`); build rows via the chain math (`precio_neto = round_2(costo × (1 + margen/100))`, `precio_venta = neto + neto × 21/100`); rewrite the `# precio_venta carries IVA inside` comment; keep exactly one IVA per demo product. <!-- sdd-owner: implementation -->
- [x] `backend/app/core/db.py` (`init_db` tax seeds) unchanged (IVA 21/10.5/27/0 + exento; IVA 21 the single `is_default`); RED→GREEN: every seeded/demo product satisfies `precio_venta = round_mode(neto + Σ line taxes)` and the one-IVA rule (assertion test iterating all seeded products; extend the demo-data/setup tests). <!-- sdd-owner: implementation -->
- [x] `CHANGELOG.md`: rollout note — margin-over-net semantics change, `docker compose down -v` volume wipe required, pre-change `margen_pct` interpretation discarded, deploy sequence (apply migration → wipe → reseed → regen client). <!-- sdd-owner: implementation -->

## Work Unit 9 — Full validation gates

- [x] `cd backend && bash scripts/test.sh` (full suite, docker db up, migrations applied, non-parallel-safe). <!-- sdd-owner: implementation -->
- [x] `cd backend && bash scripts/lint.sh` (ruff + mypy --strict + ty). <!-- sdd-owner: implementation -->
- [x] `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` and `cd frontend && bun run lint` (biome). <!-- sdd-owner: implementation -->
- [x] Re-run Playwright critical-flow suite (`cd frontend && bunx playwright test`) — sell flow regression check (`/sell` and `/buy` untouched). <!-- sdd-owner: implementation -->

## Parent-owned: review and delivery gate

- [x] Start or reuse bounded review. <!-- sdd-owner: parent --> DONE 2026-09-08: formal bounded review (RDD) never enabled (user-owned switch off); review coverage was provided by a read-only ARCA/AFIP-readiness review of the merged implementation (no blockers; findings recorded in project memory).
- [x] Present the delivery decision (ask-on-risk): confirm the PR 1 backend / PR 2 frontend split and chain strategy (`stacked-to-main` vs other) before apply; forecast is High risk / >400 lines. RESOLVED by user: apply now, 2 stacked PRs (PR 1 backend WU1–5+8 → PR 2 client regen + frontend WU6–7), stacked-to-main. <!-- sdd-owner: parent -->
- [x] After apply: verify deployment sequence — `uv run alembic upgrade head` (additive only), `docker compose down -v` + reseed via `docker compose watch` + prestart, `bash ./scripts/generate-client.sh` if not already committed; confirm rollback readiness (`git revert` + `uv run alembic downgrade -1` drops only the two added columns). <!-- sdd-owner: parent --> DONE 2026-09-08: `05cf4ac88022` at head (additive), `down -v` + reseed verified (superuser + base seeds; `/setup` pending user's business data), client regen committed in PRs, downgrade drops exactly the two columns, health check OK.
- [x] Before archive: success-criteria walkthrough from `proposal.md` (4-price chain, cent-exact decomposition, gross totals, rounding modes, one-IVA rule, margin-over-net reports, seeded consistency) and warn before any destructive-delta merge. <!-- sdd-owner: parent --> DONE 2026-09-08: all 7 criteria evidenced by tests (181.50 chain anchor, 181.90/182.90/363.90 rounding, multiple_iva_taxes, revenue_neto=150.00, cent-exact identity, demo seed chain test); new-domain full-copy sync (no REMOVED/MODIFIED deltas) so no destructive merge occurred.
