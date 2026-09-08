# Design: integrate-taxes-in-price-chain

Implements `openspec/changes/integrate-taxes-in-price-chain/specs/pricing/spec.md` against the tempos codebase. AGENTS.md sections 2 (stack/language rule), 5 (strict rules) and 6 (module map) are binding conventions. All new identifiers are English; Spanish domain vocabulary (`precio_venta`, `costo_actual`, `margen_pct`, góndola) is preserved.

Codebase anchors verified against current source:

- `backend/app/crud.py:162` — `_compute_precio_venta` (to be replaced).
- `backend/app/crud.py:169-201` — `create_product` / `update_product` / `_sync_product_taxes`.
- `backend/app/crud.py:434-560` — line-tax breakdown inside `create_document` / `_create_document_in_tx` (currently `monto = subtotal_line × rate%` on the gross base).
- `backend/app/crud.py:728-733` — `DocumentLineTax` row construction (`aplicado=True`).
- `backend/app/crud.py:901` and `crud.py:1049` — `aplicado` filters when regenerating `tax_ids` for the void NC and the quote→invoice conversion.
- `backend/app/crud.py:1151-1163` — `_apply_reference_cost` (reference-supplier cost confirmation recompute).
- `backend/app/models.py:297-360` — `ProductBase` / `ProductCreate` / `ProductUpdate`; `models.py:765-824` — `BusinessSettings`; `models.py:829-844` — `Tax`; `models.py:1530-1573` — `ProductPublic` / `ProductListItemPublic`.
- `backend/app/api/routes/reports.py:198-258` — `margin_report` (margin over gross revenue today).
- `backend/app/demo_data.py:52-61, 90-105` — `_margin_pct` + demo product seeding.

---

## Decision (a): `precio_neto` is a persisted computed column on `Product`

**Decision: persisted cache column, exactly like `precio_venta`.** Add `Product.precio_neto: Decimal` (`Numeric(12, 2)`, `NOT NULL`, default `0`), recomputed by the single chain helper at every write path (product create, product update, reference-cost confirmation `_apply_reference_cost`, seeds/demo data).

**Rationale (vs on-the-fly schema property):**

1. **Idempotency is preserved either way** — the chain always recomputes from `(costo_actual, margen_pct, taxes, settings)` and never reads back a previously stored price, so a cache column cannot drift *through the write paths* because there is exactly one writer (the chain helper).
2. **Price-list sorting/filtering.** `ProductListItemPublic` is a server-side paginated list (`routes/products.py`, `DataTable` client-side on top of `Page[T]`). The price list must expose neto and góndola columns (spec: Reports/price-list requirement). A computed property would have to derive `costo × (1 + margen/100)` per row in Python for every page — fine — but any future *sort or filter by precio_neto* (the obvious next step for a price list) would need it as a SQL expression anyway. A persisted column keeps list queries trivial and indexable, and matches the existing `precio_venta` cache convention (AGENTS.md §6 "stock_current cache" pattern applied to prices).
3. **OpenAPI shape stays flat.** `ProductPublic` / `ProductListItemPublic` are plain `SQLModel` schemas populated directly from `Product` rows; a derived property would require per-route assembly or computed-field plumbing duplicated across the two public schemas (and the sell screen's product search, which also returns product rows). A column flows through `model_validate` like `precio_venta` does today.
4. **Spec consistency clause.** The spec says `precio_neto` "MUST always be consistent with the chain" — with a column, consistency is enforced by the single-recompute-helper invariant (see "Chain helpers" below) plus a test that reads every seeded/API-created product and asserts the identity.
5. **Cost of the column is low**: one `Numeric(12,2)` column, one more assignment in the same three write paths that already write `precio_venta`, no extra invalidation surface because taxes/rounding changes only reach products through those same write paths (tax assignment changes go through `update_product`'s `tax_ids`, which now also triggers recompute — see "Recompute triggers").

The costo con impuestos value remains **display-derived only** (decision 2 of the proposal; no column), exposed in the API schemas as a computed read-only field (see "Schema changes").

## Decision (b): cent-level reconciliation rule for `neta + Σ montos == subtotal_bruto`

**Decision: "adjust the last percent tax" (deterministic adjust-last rule).** At document-creation decomposition time, for each line:

Inputs: `subtotal_bruto` (2-dec, after line discount), the line's percent taxes `T_p = [(tax_id, rate), ...]` in the deterministic order of `line_in.tax_ids` when provided, else the product's tax assignment order (the same order that already feeds `taxes` in the current code), and the line's fixed taxes `T_f` (their `Tax.rate` is already an exact 2-dec `Numeric(5,2)` amount because `is_percent=false`).

Algorithm (all arithmetic in `Decimal`, quantization `ROUND_HALF_UP` with `Decimal("0.01")` — see quantization note below):

1. `fixed_total = Σ monto_f for monto_f in T_f` (exact, no quantization needed; each addend is already 2-dec).
2. `neta = round_2((subtotal_bruto − fixed_total) / (1 + Σ rates_p / 100))`.
3. For each percent tax in order: `monto_i = round_2(neta × rate_i / 100)`.
4. `residual = subtotal_bruto − fixed_total − neta − Σ monto_i`.
5. **Reconciliation:** add `residual` to the **last percent tax's monto** (`monto_last += residual`). If the line has **no percent taxes**, add `residual` to `neta` instead (adjust-last becomes adjust-the-net).
6. Store `DocumentLineTax(base=neta, monto=monto_i)` per tax, with the row order preserved from step 3.

By construction `neta + Σ montos = subtotal_bruto` **exactly** (all addends 2-dec, residual absorbs the drift into a single row), and the rule is deterministic: same inputs always produce the same rows. Largest-remainder was rejected because it distributes drift across several rows (harder to explain on a printed Factura A, and any tie-breaking ordering rule is harder to test than a single writer); adjusting the **last** tax mirrors the accountant's habit of putting the "cent" in the final line of the breakdown. With a single IVA tax (the overwhelmingly common case, enforced by decision (e)) the last tax *is* the IVA, so the breakdown printed on vouchers stays natural.

**Quantization:** every `round_2` is `value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`. Note the existing `_money()` helper in `crud.py` uses the default context rounding (`ROUND_HALF_EVEN`); the new chain helpers specify `ROUND_HALF_UP` explicitly and do **not** change `_money` (document totals and existing math are untouched — AGENTS.md §5.13: no unrelated-behavior changes). The one-cent difference between the two roundings is absorbed by the residual rule anyway.

**Immutability of historical breakdowns:** the decomposition runs only at creation time inside `_create_document_in_tx`. No code path may read the new rule to rewrite stored `DocumentLineTax` rows; void NCs and quote conversions *re-run* the decomposition for the **new** document from the copied `precio_unit` + regenerated `tax_ids` (which is correct — the NC is a new document), while the original document's rows are never updated.

**`aplicado` toggle coherence:** the reconciliation identity is asserted over **all** rows of a line regardless of `aplicado` (at creation every row is `aplicado=True`, per `crud.py:732`). The `aplicado` filters at `crud.py:901` (void NC) and `crud.py:1049` (quote→invoice) only decide **which tax_ids are regenerated** into the new document's lines; the new document's own breakdown is then recomputed by the same rule over its own taxes, so `neta + Σ montos == subtotal_bruto` holds there too. Toggling `aplicado` off (route-level toggle on `DocumentLineTax`) must never edit `monto` — the toggle only affects later regeneration sets; the stored breakdown (and the cent identity over the original document) stays byte-identical.

## Decision (c): `price_rounding` storage, naming, placement

**Decision: plain string column with Python-side str-enum validation** — no PostgreSQL enum type (AGENTS.md §9 gotcha: pg enums persist across migrations and poison reuse; the codebase already follows the string+`max_length` pattern for `stock_policy`, `number_format`, `default_locale`, `default_print_format`).

- **Field name:** `price_rounding` (English, technical, not domain vocabulary).
- **Python type:** `class PriceRounding(str, Enum)` with values `"none"`, `"two_decimals"`, `"psychological_90"` — placed next to the existing `StockPolicy` / `NumberFormat` enums in `models.py`.
- **Model field:** `price_rounding: PriceRounding = Field(default=PriceRounding.NONE, max_length=20)` on `BusinessSettings` (next to the product-defaults block, after `default_margen_pct`).
- **Schema exposure:** add to `BusinessSettingsPublic` (required field) and `BusinessSettingsUpdate` (`PriceRounding | None`), so `PATCH /business-settings/` accepts it with the existing `sqlmodel_update` flow and Pydantic rejects unknown strings with a 422.
- **Default for existing singletons:** migration adds the column `NOT NULL` with `server_default='none'` (same pattern as `warn_below_cost` in migration `7bc6a75d0f0a`). `none` reproduces today's raw 2-dec behavior, so the default is behavior-preserving. **No data migration** — dev volume wipe per proposal decision 4.
- **UI placement:** admin **General** tab (`frontend/src/components/Admin/GeneralSettings.tsx`), a shadcn `Select` with the three options, Spanish labels: `Sin redondeo`, `Dos decimales`, `Psicológico (.90)`; es/en i18n strings.

## Decision (d): fixed-amount line taxes in the chain

1. **Góndola:** a fixed-amount (`is_percent=false`) line tax contributes its `rate` **once** to `precio_venta`: `precio_venta = round_mode(neto + neto × Σ percent rates / 100 + Σ fixed amounts)`. It is **never** multiplied by any percent rate and **never** part of the decomposition divisor (already reflected in decision (b) step 2: the divisor base is `bruto − fixed_total`).
2. **Positivity:** a fixed-amount tax must be strictly positive. Validation at **both** ends:
   - `Tax` create/update route (`routes/taxes.py`): reject `is_percent=false` with `rate <= 0` → `400 {"code": "invalid_fixed_tax_amount"}`.
   - Defensive check in the chain helpers / decomposition: a fixed tax with `rate <= 0` raises `BusinessError("invalid_fixed_tax_amount", ...)` (never silently skipped — a zero fixed tax would make the góndola identity look inconsistent to users).
3. **Góndola sum:** included in the `precio_venta` sum (spec scenario: `150.00 + 31.50 + 2.00 = 183.50`), excluded from the percent divisor (decision (b) step 2).
4. **Negative fixed taxes are not credits:** out of scope; rejected rather than interpreted.

## Decision (e): one-IVA-per-product enforcement

**Rule:** a product may have **at most ONE assigned tax of tipo IVA, counting `exento` as an IVA marker** — i.e. `exento` cannot coexist with any other IVA-type tax either. Rationale: the spec's normative sentence says "at most one tipo IVA that is not `exento`", but an `exento` marker alongside an IVA 21% is fiscally incoherent on a Factura A/B breakdown, and the proposal's decision 3 ("at most ONE tax of tipo IVA per product") reads naturally as one-IVA-total. The spec's own scenarios (exento alone valid; no IVA = 0%; IIBB coexists) are all satisfied by the stricter rule. Flagged in the spec's direction: error message/code identical for both variants.

- **Error code:** `multiple_iva_taxes` (dedicated code, mapped in `handleError` + es/en i18n).
- **Enforcement point (single validator, two call sites):** new `_validate_product_taxes(taxes: Sequence[Tax]) -> None` in `crud.py` next to `_sync_product_taxes`. It counts `tipo == TaxType.IVA` taxes (regardless of `exento`) and raises `BusinessError("multiple_iva_taxes", ...)` when > 1. Called from:
  1. `create_product` / `update_product` **before** `_sync_product_taxes` persists anything (no partial assignment — spec scenario requires atomicity; `_sync_product_taxes` deletes-then-inserts in one session commit, and validation happens before that commit).
  2. The product create/update **routes** (`routes/products.py`) pre-validate the incoming `tax_ids` via a shared helper so the user gets the 400 `{"code": "multiple_iva_taxes", ...}` shape used by `handleError` (routes already use this exact pattern for `stock_maximo_below_minimo` / `product_in_use`).
- Because the products routes translate `BusinessError`-style detail dicts, the validator raising `BusinessError` is caught and re-raised as `HTTPException(400, {"code": "multiple_iva_taxes", "message": ...})` in the route (same shape as existing codes).
- **UI:** AddProduct/EditProduct render the IVA choice as a **single-select** (radio-style picker listing tipo-IVA taxes plus "Sin IVA / 0%"), while other tax tipos (IIBB, Interno, PercGan, Otro) remain a multi-select. The form disables submission and shows the translated error if the picker ever ends up with two IVAs (defense in depth behind the backend rule).

## Chain helpers (replacement of `_compute_precio_venta`)

New helpers in `crud.py` (replacing `_compute_precio_venta`, which has exactly three call sites: `create_product`, `update_product`, `_apply_reference_cost`):

```python
def _read_price_rounding(session: Session) -> PriceRounding:
    """Read the BusinessSettings singleton's price_rounding (default none)."""

def _compute_precio_neto(costo_actual: Decimal, margen_pct: Decimal) -> Decimal:
    """neto = costo_actual * (1 + margen_pct/100), ROUND_HALF_UP 2-dec. Exact 2-dec always."""

def _apply_price_rounding(raw_gondola: Decimal, mode: PriceRounding) -> Decimal:
    """none/two_decimals: quantize(0.01, HALF_UP); psychological_90: round UP to next .90."""

def _compute_product_prices(session, product: Product) -> tuple[Decimal, Decimal]:
    """Full chain from persisted inputs: reads product.taxes + settings singleton.
    Returns (precio_neto, precio_venta); writes nothing."""
```

`_apply_price_rounding` `psychological_90` semantics (exact Decimal spec): `base = raw.quantize(Decimal("1"), ROUND_FLOOR); candidate = base + Decimal("0.80"); if candidate < raw: candidate += Decimal("1"); return candidate`. Verified: `181.50 → 181.90`, `181.95 → 182.90`, `181.90 → 181.90` (never down), `181.00 → 181.90` (always up to the **next** `.90`).

**Recompute triggers (all go through `_compute_product_prices`, in the same transaction as the triggering write):**

1. `create_product` — after tax sync, before commit.
2. `update_product` — recompute when `costo_actual`/`margen_pct` changed **or** `tax_ids` was provided (tax change alters the góndola sum even with fixed cost/margin; `needs_recompute` today only checks cost/margin — this is extended).
3. `_apply_reference_cost` (`crud.py:1151`) — cost confirmation recomputes neto from the existing `margen_pct` and the góndola from current taxes + the settings rounding mode (spec: cost-change recompute). Always derived from `(costo_actual, margen_pct, taxes, settings)`; never from the previous `precio_venta`, so repeated recomputes are idempotent even under `psychological_90`.

**Rounding mode is read per recompute** (fresh read of the `BusinessSettings` singleton in `_compute_product_prices`) so admin changes to the mode apply on the next price formation without redeploy — spec's "configurable in admin" scenario. Existing products are **not** lazily rewritten on mode change (they reprice on their next write/cost recompute); the admin UI copy states this.

## Schema changes (OpenAPI shape)

- `ProductPublic`, `ProductListItemPublic`: add `precio_neto: Decimal` and `costo_con_impuestos: Decimal` (the four prices). `costo_con_impuestos` is **display-derived**: `costo_actual + IVA monto over cost`, where the IVA monto = `round_2(costo_actual × iva_rate / 100)` for the product's single percent IVA tax; `0` when there is no IVA or the IVA is `exento`/0%. Populated in the routes from the already-loaded `product.taxes` relationship (no extra query). Fixed-amount taxes are **not** included here (costo con impuestos is IVA-only by proposal decision 2).
- Per-product tax summary: already present as `taxes: list[TaxPublic]` — unchanged; the UI derives badges (IVA rate, IIBB, etc.) from it.
- `BusinessSettingsPublic` / `BusinessSettingsUpdate`: `price_rounding` (decision (c)).
- No changes to document schemas (`DocumentLineTaxPublic` already exposes `tax_id/base/monto/aplicado`).

## Alembic migration plan

Single migration `add_price_rounding_and_precio_neto` (one conceptual change: the pricing chain, AGENTS.md §5.12), generated with `uv run alembic revision --autogenerate -m "..."`, then hand-edited:

1. `op.add_column("businesssettings", sa.Column("price_rounding", sa.String(length=20), nullable=False, server_default="none"))`.
2. `op.add_column("product", sa.Column("precio_neto", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"))`.
3. **Hand-remove** the spurious `op.drop_index(...)`/DROP of the hand-written partial unique index `uq_cashregistersession_single_open` (AGENTS.md §9 known autogenerate spurio).
4. `downgrade()` drops exactly those two columns.
5. **No data migration**: server defaults keep existing rows valid; the dev volume is wiped (`docker compose down -v`) and re-seeded, so stored neto/góndola values are consistent with the new chain everywhere that matters.

## Seeds and demo data

- `demo_data.py`: `_margin_pct(costo_actual, precio_venta)` is replaced by `_margin_pct_from_gondola(costo_actual, gondola, taxes)` that **inverts the new chain**: with IVA 21% (the only tax demo products carry), `neto = gondola / (1 + 21/100)`, `margen_pct = round_2((neto / costo_actual − 1) × 100)`; the product row is then built by the same chain helper math (`precio_neto = round_2(costo × (1 + margen/100))`, `precio_venta = neto + neto × 21/100`), so the stored góndola matches the target demo price after chain recomputation. The `# precio_venta carries IVA inside` comment is rewritten to describe margin-over-net. Demo products keep exactly one IVA (`IVA21`) — one-IVA rule respected.
- `init_db` (`core/db.py`) tax seeds unchanged (IVA 21/10.5/27/0 + exento; IVA 21% is the single seeded `is_default`, which AddProduct preselects — now rendered as the single-select IVA picker). No new permissions (AGENTS.md §5.9 n/a).
- After `docker compose down -v` + reseed, every seeded product satisfies `precio_venta = round_mode(neto + Σ line taxes)` (spec scenario; asserted by a test iterating all seeded products).

## Reports: margin over net

`margin_report` (`routes/reports.py:198`): revenue base changes from gross line subtotal to **net revenue** = `subtotal_line − Σ(aplicado percent + fixed line tax montos of the line)` using the stored `DocumentLineTax` rows (post-change these are the exact decomposition, so net revenue equals what the chain called `neta`). `MarginRow` gains `revenue_neto: Decimal`; `margin = revenue_neto − cost`; `margin_pct = margin / revenue_neto × 100`. `MarginTab.tsx` shows `Ingreso neto` next to `Ingreso bruto` and computes the displayed margin over net. Historical (pre-wipe) documents are irrelevant in dev (volume wipe), and after the wipe all documents carry exact decompositions, so the identity `neta + Σ montos == bruto` makes net revenue exact. The VAT report (`/reports/vat`) is code-unchanged but its `base`/`monto` values become the exact net bases — verify `VatTab` displays coherently (it will now match Factura A net+IVA display).

## Frontend touch points

1. **Client regen first:** after the backend model/schema change, `bash ./scripts/generate-client.sh` from repo root, then `bunx tsc -p tsconfig.build.json --noEmit` and fix hand-written code only (client types are generated, AGENTS.md §5.3).
2. `AddProduct.tsx` / `EditProduct.tsx`: four-price display (live-computed chain preview from costo/margen/taxes/rounding setting), single-select IVA picker + multi-select other taxes (decision (e) UI), `multiple_iva_taxes` surfaced via `handleError`.
3. `ProductDetailSheet.tsx`: show the four prices (costo_actual, costo con impuestos, precio_neto, precio_venta).
4. `productsColumns.tsx`: price list gains `Precio neto` and keeps `Precio venta` (góndola) columns.
5. `MarginTab.tsx`: margin over net (with new `revenue_neto` column from the regenerated client).
6. `GeneralSettings.tsx` (admin General tab): `price_rounding` select (decision (c)).
7. `src/i18n/*`: es/en strings for the new labels + `multiple_iva_taxes` / `invalid_fixed_tax_amount` error codes.
8. **Untouched:** `/sell` and `/buy` (they consume `precio_venta` / `costo_actual`), payments, ledgers, printing templates (voucher prints gross subtotals — unchanged convention).

## Test plan

New backend tests (`backend/tests/api/routes/`):

- `test_products_pricing.py`:
  - Chain math: costo 100 / margen 50 / IVA 21% / rounding `none` → `precio_neto=150.00`, `precio_venta=181.50` (API round-trip).
  - Percent + fixed coexist: `precio_venta = 183.50` (fixed 2.00 added once, outside the divisor).
  - No line taxes → góndola = neto.
  - Rounding: `none`, `two_decimals`, `psychological_90` (`181.50→181.90`, `181.95→182.90`, `181.90→181.90`) applied only to `precio_venta`; neto/costo stay exact 2-dec.
  - One-IVA validation: second IVA rejected 400 `multiple_iva_taxes`; `exento` alone accepted (0% chain); `exento` + IVA 21 rejected; IIBB + IVA accepted.
  - `costo_con_impuestos` derivation: switch IVA assignment 21% → 10.5% via PATCH; API reflects 110.50 without any product-price edit.
  - Cost-change recompute: confirm reference-supplier cost → neto from margin, góndola per taxes+mode; idempotent second recompute under `psychological_90` (`363.00 → 363.90` stable).
- `test_documents.py` additions:
  - Decomposition identity: `neta + Σ montos == subtotal_bruto` exactly for single IVA, multi-percent, and percent+fixed lines (cent-exact assertions).
  - Document totals unchanged (gross convention) with the new breakdown.
  - Historical immutability: create document, change product taxes, assert stored `DocumentLineTax` rows byte-identical.
  - `aplicado` toggle → void NC regenerates only `aplicado` taxes; regenerated NC breakdown satisfies the identity.
- `test_demo_data.py` / setup tests: every demo product satisfies the chain identity and the one-IVA rule.
- `test_business_settings.py`: `price_rounding` round-trip via PATCH; invalid value → 422.

Existing tests that will need updates:

- Any document tests asserting the **old** breakdown math (`monto = bruto × rate`) — bases/montos change to the exact decomposition.
- Products tests asserting `precio_venta = costo × (1 + margen/100)` (no taxes) still hold, but tests with default IVA assignment now see the góndola including IVA.
- Demo-data margin assertions (old IVA-inclusive convention).
- Margin report tests (base changes to net).

Frontend: `bunx tsc -p tsconfig.build.json --noEmit`, `bun run lint` (biome), and re-run the Playwright critical-flow suite (sell flow untouched but regressed-checked, AGENTS.md proposal risk table).

Validation gates (AGENTS.md §5.4): `bash backend/scripts/test.sh`, `bash backend/scripts/lint.sh` (mypy --strict + ty + ruff), client regen + tsc, `bun run lint`.

## Risks and rollout

| Risk | Mitigation |
|------|------------|
| Breakdown base change confuses Factura A/B display | Identity test per line; manual check of the printed voucher net+IVA block; VatTab values now match the breakdown |
| `psychological_90` non-idempotency | Chain always recomputes from `(costo, margen, taxes, settings)`; dedicated idempotency test |
| Margin semantics change silently | Accepted: dev volume wipe + seeds; CHANGELOG note that pre-change `margen_pct` interpretation is discarded |
| One-IVA rule vs AddProduct preselecting every `is_default` tax | Only one IVA (`IVA21`) is seeded as default; validation is tipo-based; UI single-select makes the rule self-evident |
| Migration spurio DROP of `uq_cashregistersession_single_open` | Hand-remove before applying (AGENTS.md §9) |
| Client regen tsc breakage | Regen immediately after schema change; fix hand-written code only |

**Rollout:** backend-first PR, then frontend PR on the regenerated client (sdd-tasks forecasts the split). Deploy/dev sequence: apply migration (additive only) → `docker compose down -v` → reseed via `docker compose watch` + prestart → regen client. Rollback: `git revert` + `uv run alembic downgrade -1` (drops only the two added columns; no ledger/document tables touched, append-only integrity preserved).

**Explicitly out of scope (unchanged):** `/sell`, `/buy`, document totals/voiding/payments/allocations, AFIP hooks (`cae`/`cae_vto`), real purchase-invoice IVA recovery.
