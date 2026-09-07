# Pricing Specification

## Purpose

Define the product price formation chain for the retail catalog: margin is computed over a real net price, line-level taxes (IVA, IIBB, internos, etc. where `aplica_a = linea`) are first-class citizens added on top of the net price to form the góndola (shelf) price, and line taxes on documents form an exact decomposition of the gross line price. This domain owns the tax-breakdown semantics for document lines; no separate documents capability spec exists, and this change modifies no existing spec'd capability.

Domain vocabulary in Spanish (`precio_venta`, `costo_actual`, `margen_pct`, góndola) is preserved; new technical identifiers are in English.

## Requirements

### Requirement: Price formation chain (margin over net)

The system MUST compute `precio_neto = costo_actual × (1 + margen_pct / 100)` (exact 2 decimals) and the shelf price as `precio_venta = precio_neto + Σ(line-level taxes of the product)` where the sum includes ALL line-level taxes assigned to the product (`aplica_a = linea`): IVA, IIBB, percepciones, internos, and other percent or fixed-amount taxes. Margin over net SHALL be the single margin definition used everywhere prices are formed or reported.

- Percent line taxes contribute `precio_neto × rate / 100`.
- Fixed-amount (`is_percent = false`) line taxes contribute their fixed amount (NOT part of any percent divisor).
- Price formation MUST always recompute from `(costo_actual, margen_pct, product taxes, settings)`; it MUST NOT derive prices from a previously stored `precio_venta` (recompute idempotency).

#### Scenario: New product with IVA 21% and margin 50% (rounding none)

- GIVEN `costo_actual = 100.00`, `margen_pct = 50`, the product has an IVA tax of 21% (`aplica_a = linea`) and `price_rounding = none`
- WHEN the product is created (or prices recomputed)
- THEN `precio_neto = 150.00` and `precio_venta = 181.50` (150.00 + 31.50 IVA)

#### Scenario: Percent and fixed line taxes coexist in the góndola

- GIVEN a product with `costo_actual = 100.00`, `margen_pct = 50` (`precio_neto = 150.00`), an IVA 21% line tax, and a fixed-amount line tax of `2.00`
- WHEN prices are formed
- THEN `precio_venta = 150.00 + 31.50 + 2.00 = 183.50`, with the fixed amount added once and not multiplied by the IVA rate

#### Scenario: Product with no line taxes

- GIVEN a product with `costo_actual = 100.00`, `margen_pct = 50` and no line-level taxes assigned
- WHEN prices are formed
- THEN `precio_neto = 150.00` and `precio_venta = 150.00`

### Requirement: Four-price exposure

The product API schemas and UI MUST expose four prices: `costo_actual` (net cost), costo con impuestos, `precio_neto`, and `precio_venta` (góndola). The costo con impuestos value SHALL be display-derived only (`costo_actual + IVA del producto`) and MUST NOT require a persisted model field. `precio_neto` MAY be persisted or computed, but MUST always be consistent with the chain. The four prices MUST be shown in the product form (add/edit) and product detail view.

#### Scenario: Product detail shows the full chain

- GIVEN the product from the chain scenario above (costo 100, margen 50, IVA 21%, `price_rounding = none`)
- WHEN a user opens the product detail view
- THEN the view shows `costo_actual = 100.00`, costo con impuestos = `121.00`, `precio_neto = 150.00`, and `precio_venta = 181.50`

#### Scenario: costo con impuestos is derived, not stored

- GIVEN a product whose IVA tax assignment is changed from 21% to 10.5%
- WHEN the API returns the product without any product-table migration or edit
- THEN the costo con impuestos value reflects the new IVA rate (derived from the current tax assignment), while `costo_actual` is unchanged

### Requirement: One-IVA-per-product validation

The system MUST enforce that a product has at most ONE assigned tax of tipo IVA that is not `exento`. A product with no IVA tax assigned SHALL be treated as 0% IVA. Other line taxes (IIBB, percepciones, internos) MAY coexist freely with the single IVA. Assigning a second non-exento IVA-type tax to a product MUST be rejected by backend validation with a dedicated error code (e.g. `multiple_iva_taxes`), and the UI MUST surface the same rule before submission.

#### Scenario: Second IVA tax rejected

- GIVEN a product already assigned an IVA 21% line tax
- WHEN a user (via API or product form) attempts to assign an additional IVA 10.5% tax to the same product
- THEN the assignment is rejected with error code `multiple_iva_taxes` (or an equivalent dedicated code) and no partial assignment is persisted

#### Scenario: Exempt product is valid

- GIVEN a product assigned an `exento` tax marker and no non-exento IVA tax
- WHEN the product is saved
- THEN the save succeeds and the product is treated as 0% IVA in the chain

#### Scenario: IIBB coexists with the single IVA

- GIVEN a product assigned one IVA 21% tax
- WHEN an IIBB line tax is also assigned to the product
- THEN the save succeeds and both taxes enter the `precio_venta` sum

### Requirement: Rounding modes for the shelf price

`BusinessSettings` MUST expose a configurable `price_rounding` mode with values `none`, `two_decimals`, and `psychological_90`. Rounding applies ONLY to `precio_venta` (góndola); `precio_neto` and `costo_actual` SHALL always remain exact 2-decimal values.

- `none`: raw 2-decimal result of the chain (as computed).
- `two_decimals`: plain round to 2 decimals.
- `psychological_90`: round UP to the next value ending in `.90`, never down: `181.50 → 181.90`, `181.95 → 182.90`.

The mode MUST be configurable in the admin General tab and MUST be applied consistently at product create/update and cost-change recompute.

#### Scenario: psychological_90 rounds up only

- GIVEN `price_rounding = psychological_90` and a chain result of `181.50`
- WHEN `precio_venta` is formed
- THEN the góndola price is `181.90`
- GIVEN a chain result of `181.95`
- WHEN `precio_venta` is formed
- THEN the góndola price is `182.90` (never rounded down to a previous `.90`)

#### Scenario: Rounding never touches neto or costo

- GIVEN `price_rounding = psychological_90` and a chain where `precio_neto` computes to `150.003`
- WHEN prices are formed
- THEN `precio_neto` is stored/exposed as an exact 2-decimal value (`150.00`), and only `precio_venta` receives the psychological rounding

#### Scenario: Rounding mode is configurable in admin

- GIVEN an admin user on the General settings tab
- WHEN they select `psychological_90` and save
- THEN subsequent price formation for all products uses the psychological_90 mode without backend redeployment or data migration

### Requirement: Document line tax decomposition (exact)

For document lines, the system MUST decompose the gross line price exactly: line net = `subtotal_bruto / (1 + Σ percent tax rates)`, with each percent tax's `monto` derived from that net base. Fixed-amount line taxes are NOT part of the divisor and are added as their fixed amounts. The decomposition MUST reconcile at cent level: `neta + Σ tax montos = subtotal_bruto` EXACTLY for every line (the design MUST specify a deterministic reconciliation rule, e.g. adjusting the last tax monto, so the identity always holds). The line-tax breakdown remains informational: document totals keep the gross convention (`total = subtotal - descuento_total + Σ percepciones`) and `DocumentLineTax` rows MUST NOT affect totals. Historical documents MUST keep their stored breakdown immutable — no recompute may touch already-created documents.

#### Scenario: Exact decomposition of a gross line with IVA 21%

- GIVEN a document line with `subtotal_bruto = 181.50` and a single IVA 21% line tax
- WHEN the line-tax breakdown is computed at document creation
- THEN `neta = 150.00` and the IVA `monto = 31.50`, satisfying `neta + monto = 181.50` exactly to the cent

#### Scenario: Multi-tax line sums back to gross

- GIVEN a document line with `subtotal_bruto = 183.50`, an IVA 21% line tax, and a fixed line tax of `2.00`
- WHEN the breakdown is computed
- THEN the fixed tax `monto = 2.00` (outside the percent divisor), the IVA monto derives from the net base, and `neta + Σ montos = 183.50` exactly

#### Scenario: Document totals remain gross

- GIVEN a document created with lines whose tax breakdown is the exact decomposition above
- WHEN the document totals are calculated
- THEN `total = subtotal - descuento_total + Σ percepciones` using gross subtotals, identical to the pre-change convention, and the breakdown taxes change no total

#### Scenario: Historical documents are immutable

- GIVEN documents created before a product's tax assignment changed
- WHEN any later product or tax edit occurs
- THEN the stored `DocumentLineTax` breakdowns and totals of those historical documents remain byte-identical (no recompute)

### Requirement: Cost-change recompute

When a reference-supplier cost confirmation updates `costo_actual`, the system MUST recompute the full chain: `precio_neto` from the existing `margen_pct`, then `precio_venta = precio_neto + Σ product line taxes`, rounded per the active `price_rounding` mode. The recompute MUST derive from `(costo_actual, margen_pct, taxes, settings)` — never from the previous góndola — so repeated recomputes are idempotent.

#### Scenario: Cost confirmation recomputes the chain

- GIVEN a product with `margen_pct = 50`, IVA 21%, `price_rounding = none`, and a confirmed reference-supplier cost change to `costo_actual = 200.00`
- WHEN the cost confirmation is processed
- THEN `precio_neto = 300.00` and `precio_venta = 363.00`

#### Scenario: Recompute is idempotent under psychological_90

- GIVEN `price_rounding = psychological_90` and the product above yielding a raw góndola of `363.00` (→ `363.90`)
- WHEN the cost-change recompute runs a second time without any input change
- THEN `precio_venta` is `363.90` again (not compounded from the previously rounded góndola)

### Requirement: Seeds and demo data consistent with the chain

The seed data (`init_db`, `demo_data.py`) MUST produce products whose `precio_neto` and `precio_venta` are consistent with the margin-over-net chain, the tax assignments, and the default `price_rounding` mode. There is NO data migration: upgrading environments use a dev volume wipe (`docker compose down -v`) and re-seed.

#### Scenario: Fresh volume produces consistent prices

- GIVEN a wiped database volume and the updated seeds applied
- WHEN any seeded product's four prices are inspected
- THEN `precio_venta = round_mode(precio_neto + Σ line taxes)` and `precio_neto = costo_actual × (1 + margen_pct / 100)` hold for every seeded product

#### Scenario: Demo data respects one-IVA rule

- WHEN `demo_data.py` assigns taxes to demo products
- THEN no product ends up with more than one non-exento IVA-type tax

### Requirement: Reports compute margin over net

Margin reports MUST compute margin as the real margin over `precio_neto` (net of line taxes), never over the gross `precio_venta`. The product price list MUST expose neto and góndola columns.

#### Scenario: Margin report uses net

- GIVEN a product with `costo_actual = 100.00`, `margen_pct = 50`, IVA 21% (so `precio_neto = 150.00`, `precio_venta = 181.50`)
- WHEN the margin report is generated
- THEN the reported margin is 50% (computed against `precio_neto`), not the lower margin that a gross base would produce
