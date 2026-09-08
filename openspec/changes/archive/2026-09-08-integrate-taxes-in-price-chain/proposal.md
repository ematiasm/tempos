# Proposal: Integrate Taxes in the Product Price Formation Chain

## Intent

Today tempos forms the shelf price as `precio_venta = costo_actual × (1 + margen_pct/100)`, so the margin is effectively computed over a price that already carries IVA inside — the retailer does not get the margin percentage it asked for over its real net price. At the same time, line taxes (`aplica_a = linea`) are computed as an *informational breakdown* with the wrong base: `monto = subtotal_bruto × rate%` applies the tax rate on top of a gross price that already contains the tax, so the breakdown is mathematically wrong (double-counts IVA) instead of being an exact decomposition.

This change makes taxes a first-class citizen of the price formation chain:

1. **Margin over net**: `precio_neto = costo_actual × (1 + margen_pct/100)`; the shelf price becomes `precio_venta = precio_neto + Σ(line-level taxes)` (IVA + IIBB + internos). Margin becomes real and homogeneous across products.
2. **Exact tax decomposition**: line taxes become an exact decomposition of the gross line price (`linea neta = bruto / (1 + Σ rates)`, tax montos derived from that net). The document **total convention is preserved**: line taxes never change the total (`total = subtotal - descuento_total + Σ percepciones`); only the breakdown becomes mathematically exact.

All business decisions in this proposal were explicitly discussed and approved by the user (see "Agreed decisions" per item); the language rule is respected: new technical identifiers in English, Spanish domain vocabulary (`precio_venta`, `costo_actual`, `margen_pct`, `CONSUMIDOR_FINAL`, ...) is NOT renamed.

## Agreed Business Decisions (user-approved — binding for spec/design)

1. **Chain**: margin over net. `precio_neto = costo_actual × (1 + margen_pct/100)` (exact 2-dec). Shelf price `precio_venta = precio_neto + impuestos de línea`, **all** line-level taxes included (IVA + IIBB + PercGan + Internos + Otro where `aplica_a = linea`). Margin becomes real over net.
2. **Four exposed values** (product model/API/UI): `costo_actual` (neto), **costo con impuestos** = `costo_actual + IVA del producto` — display-derived only, **no model change** —, `precio_neto`, `precio_venta` (góndola con impuestos).
3. **Validation**: at most **ONE tax of tipo IVA per product** (distinct from `exento`). Products with no IVA assigned = 0%. Other line taxes (IIBB, internos) may coexist freely.
4. **No data migration**: dev-only volume wipe (`docker compose down -v`) + updated seeds / `demo_data.py` so seeded prices are consistent with the new chain. Existing dev data with old-chain prices is discarded.
5. **Rounding of the shelf price**: NEW configurable mode in `BusinessSettings` — `price_rounding` enum: `none` (raw 2-dec as today), `two_decimals` (plain 2-dec), `psychological_90` (round **UP** to next value ending in `.90`, never down: `181.50 → 181.90`, `181.95 → 182.90`). Applies **only** to `precio_venta` (góndola); `precio_neto` and `costo_actual` are always exact 2-dec. Field naming/positioning in the admin General tab is design's call.
6. **UI scope**: product add/edit form + product detail (show the 4 prices), product price list (neto + góndola columns), margin reports (margin real over net). Sell screen (`/sell`) and purchase entry are OUT of scope — they already consume `precio_venta` / `costo_actual` and keep working unchanged.
7. **Cost-change recompute**: when the reference-supplier cost confirmation recomputes `precio_venta` (`crud.py` ~1156), it follows the new chain: recompute `precio_neto` from margin, then góndola = neto + line taxes, rounded per `price_rounding`.
8. **Language rule**: new technical identifiers in English; Spanish domain vocabulary NOT renamed (AGENTS.md §2).

## Scope

### In Scope

1. **Backend pricing chain** (`app/crud.py`, `app/models.py`): replace `_compute_precio_venta` with the neto→góndola chain; apply it at product create/update and at the reference-supplier cost-change recompute. New validation: max one IVA-type tax per product.
2. **Exact line-tax decomposition** in document creation (`crud.py` ~434-560): `linea neta = subtotal_bruto / (1 + Σ rates)`; per-tax `monto` derived from that net; `Document.subtotal`/`total` unchanged (gross convention preserved).
3. **`BusinessSettings.price_rounding`** + Alembic migration (**new column only, no data migration**; safe default `none`).
4. **Seeds & demo data** (`init_db`, `demo_data.py`): prices consistent with the new chain; updated tax assignments.
5. **Frontend**: product add/edit form (neto + góndola + validation of one-IVA), product detail (4 prices incl. display-only costo con impuestos), product price list (neto + góndola columns), margin reports over net, admin General tab rounding setting.
6. **OpenAPI client regeneration** + downstream type fixes (`scripts/generate-client.sh`, `tsc --noEmit`).

### Out of Scope

- Sell screen (`/sell`) and purchase entry (`/buy`) — already consume `precio_venta` / `costo_actual`; no changes needed.
- Real purchase-invoice IVA on cost (IVA crédito fiscal recovery flow) — the costo con impuestos view is display-derived only.
- AFIP/ARCA hooks (`cae`, `cae_vto`) — remain untouched and reserved (AGENTS.md §7).
- Any change to `Document` totals, ledgers, numbering, voiding, payments, or allocations — document totals stay gross; `DocumentLineTax` rows remain non-total-affecting.
- Product schema changes: `precio_neto` and rounding are NOT persisted on `Product` (neto is derivable; design decides whether it is a column or computed — see Open Questions).

## Capabilities

> Contract with sdd-spec. Existing specs under `openspec/specs/`: payments, post-sale-actions, print-configuration, product-search, sell-screen — none of them covers pricing; this change modifies/creates catalog/pricing domains.

### New Capabilities

- `pricing`: the price formation chain (margin over net, góndola with line taxes, rounding modes, one-IVA validation, cost-change recompute, four-price exposure).

### Modified Capabilities

- None of the existing five spec'd capabilities is modified (pricing touches none of them). sdd-spec should treat `pricing` as new and explicitly declare that the document line-tax *breakdown semantics* (base change) live under it, not under a documents capability — no document capability spec exists today to modify.

## Approach

Backend-first, frontend follows the regenerated client:

1. `models.py`: add `BusinessSettings.price_rounding` (enum-backed string, default `none`); no `Product` schema change (four prices: `costo_actual` exists; `precio_venta` exists; `precio_neto` + costo con impuestos are computed in API schemas).
2. `crud.py`: new `_compute_prices(costo_actual, margen_pct, product_taxes, settings)` replacing `_compute_precio_venta`; used at create/update and cost-change recompute. ProductTax assignment validation: ≤ 1 tipo IVA.
3. Document creation: rewrite the line-tax breakdown as exact decomposition (`bruto / (1 + Σrates)`), keeping `aplicado` toggles and the gross-total convention intact. Handle `is_percent=false` taxes and the exact-sum of montos back to `bruto - neta` (cent-level reconciliation — design decision, see Open Questions).
4. Alembic migration for the settings column only; hand-check the known autogenerate spurio (AGENTS.md §9).
5. Seeds + `demo_data.py` regenerated under the new chain (dev volume wipe replaces old data — no data migration).
6. Frontend: Products form/detail/price-list/reports + admin General rounding setting; `generate-client.sh`; i18n es/en; fix tsc.

**Size estimate**: ~800–1,200 authored lines across ~15–20 files (backend chain + decomposition + tests ~40%, frontend ~40%, seeds/i18n/client ~20%). Close to the single-PR budget; sdd-tasks should forecast and consider a backend-PR + frontend-PR split.

## Affected Areas

| Area | Impact |
|------|--------|
| `backend/app/models.py` | `BusinessSettings.price_rounding`; API schema computed fields (`precio_neto`, costo con impuestos) |
| `backend/app/crud.py` | New pricing chain (create/update, cost-change recompute ~1156); exact line-tax decomposition (~434-560); one-IVA validation |
| `backend/app/alembic/versions/` | New migration: `businesssettings.price_rounding` column (default, no data migration) |
| `backend/app/core/db.py`, `backend/app/initial_data.py` / `demo_data.py` | Seeds consistent with the new chain |
| `backend/tests/` | New/updated tests: chain math, rounding modes, one-IVA validation, decomposition exactness, cost-change recompute |
| `frontend/src/client/*` (autogenerated) | Regenerated via `scripts/generate-client.sh` |
| `frontend/src/components/Products/` | Add/Edit form (neto+góndola, IVA validation), detail (4 prices), price list columns |
| `frontend/src/components/Reports/` | Margin over net |
| `frontend/src/routes/_layout/admin.tsx` + `frontend/src/components/Admin/` | General tab: rounding setting |
| `frontend/src/i18n/*` | es/en strings |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `DocumentLineTax` base semantics change: breakdown must now sum exactly to `bruto - neta`; Factura A/B net+IVA display must stay coherent (subtotal line vs per-tax montos vs printed detail) | Med | Design specifies cent-level reconciliation rule (largest-remainder or adjust-last-tax); tests assert `neta + Σ montos == bruto` exactly; verify Factura A/B printed breakdown |
| Margin redefinition silently changes meaning of existing `margen_pct` values | High (but accepted) | No data migration by decision 4: dev volume wipe + updated seeds; docs/CHANGELOG note that old margen interpretation dies with the wipe |
| Rounding mode interplay with recompute-on-cost-change: `psychological_90` may make góndola differ from neto+taxes by cents; repeated recomputes must be idempotent (always from costo+margen, never from previous góndola) | Med | Chain always recomputes from `(costo_actual, margen_pct, taxes, settings)`; tests cover rounding-mode recompute stability |
| One-IVA validation conflicts with seeded/default flows (AddProduct preselects every `is_default` tax; multiple defaults allowed) | Med | Validation is tipo-based, not default-based; seed only one IVA default remains user-manageable; design defines error code (e.g. `multiple_iva_taxes`) |
| Barcode/sell flow regressions | Low | `/sell` and `/buy` untouched; Playwright E2E of critical flows re-run |
| Alembic migration: settings column with proper default; known autogenerate spurio (partial unique index DROP) | Low | Hand-remove spurio; migration scoped to one conceptual change (AGENTS.md §5.12) |
| Client regen breaks tsc downstream | Med | Regen + `bunx tsc -p tsconfig.build.json --noEmit` right after backend schema change; fix hand-written code (client types are generated) |

## Rollback Plan

- `git revert` of the change PR(s).
- Backend: `uv run alembic downgrade -1` drops only the `BusinessSettings.price_rounding` column; no ledger or document tables touched (append-only integrity preserved).
- Data: dev-only `docker compose down -v` re-seeds old-chain prices if ever needed (no production data migration exists to undo).
- Client: re-run `scripts/generate-client.sh` on the reverted backend.

## Success Criteria

- [ ] New product with IVA 21% and margen 50% shows the exact 4-price chain: costo 100 → neto 150 → góndola 181.50 (display shows costo con impuestos 121.00) — with `price_rounding = none`.
- [ ] Document line breakdown: `linea neta + Σ tax montos == subtotal_bruto` **exactly** (to the cent) for every line; document `subtotal`/`total` unchanged (gross).
- [ ] Factura A/B display of net + IVA stays coherent with the exact decomposition (also on the printed voucher).
- [ ] Rounding modes behave as specified: `none` raw, `two_decimals` plain, `psychological_90` rounds UP to next `.90` (181.50→181.90, 181.95→182.90) and applies only to `precio_venta`.
- [ ] Confirming a reference-supplier cost change recomputes neto from margin and góndola per taxes + rounding mode.
- [ ] At most one IVA-type tax per product is enforced (backend validation + UI); products without IVA = 0%.
- [ ] Margin reports compute margin over net (not over gross).
- [ ] Seeds and `demo_data.py` produce new-chain-consistent prices after `docker compose down -v`.
- [ ] All AGENTS.md §4 validation gates pass: `bash backend/scripts/test.sh`, `bash backend/scripts/lint.sh` (mypy --strict + ty + ruff), client regen + `bunx tsc -p tsconfig.build.json --noEmit`, `bun run lint`.

## Open Questions (for spec/design — do NOT reopen decided items)

1. `precio_neto`: persisted as a `Product` column (denormalized, kept in sync on every recompute) or computed in API schemas from `costo_actual × margen_pct`? Column simplifies price-list queries; computed avoids sync drift. (Decision 2 allows either.)
2. Exact decomposition arithmetic: with 2-dec net and per-tax montos, `neta + Σ montos` may drift by cents from `bruto` — design must pick the reconciliation rule (e.g. adjust the IVA monto as last writer) and whether `neta` itself is rounded or carried raw.
3. `price_rounding` storage: plain string with enum validation vs Postgres enum type (AGENTS.md §9 enum-reuse gotcha favors plain string or `create_type=False`).
4. Non-`is_percent` (fixed-amount) line taxes: how do they enter the góndola chain and the decomposition? Design must define (likely fixed amount added to góndola, not part of the divisor).
5. Behavior when a product's line taxes change AFTER products were sold: documents already carry snapshots (line prices + tax montos locked at creation) — confirm no recompute touches historical documents.
