# Delta for Pricing

## MODIFIED Requirements

### Requirement: Document line tax decomposition (exact)

For document lines, the system MUST decompose the gross line price exactly: line net = `subtotal_bruto / (1 + Σ percent tax rates)`, with each percent tax's `monto` derived from that net base. Fixed-amount line taxes are NOT part of the divisor and are added as their fixed amounts. The decomposition MUST reconcile at cent level: `neta + Σ tax montos = subtotal_bruto` EXACTLY for every line. The residual cent MUST be assigned to the percent tax with the largest `monto`, ties broken by tax id, so the stored breakdown never depends on the order the product's taxes are read in. The line-tax breakdown remains informational: document totals keep the gross convention (`total = subtotal - descuento_total + Σ percepciones`) and `DocumentLineTax` rows MUST NOT affect totals. Historical documents MUST keep their stored breakdown immutable — no recompute may touch already-created documents.

(Previously: the requirement delegated the choice — "the design MUST specify a deterministic reconciliation rule, e.g. adjusting the last tax monto" — and the implementation adjusted the last percent tax of a sequence whose order was undefined, which made the stored breakdown non-deterministic.)

#### Scenario: Exact decomposition of a gross line with IVA 21%

- GIVEN a document line with `subtotal_bruto = 181.50` and a single IVA 21% line tax
- WHEN the line-tax breakdown is computed at document creation
- THEN `neta = 150.00` and the IVA `monto = 31.50`, satisfying `neta + monto = 181.50` exactly to the cent

#### Scenario: Multi-tax line sums back to gross

- GIVEN a document line with `subtotal_bruto = 183.50`, an IVA 21% line tax, and a fixed line tax of `2.00`
- WHEN the breakdown is computed
- THEN the fixed tax `monto = 2.00` (outside the percent divisor), the IVA monto derives from the net base, and `neta + Σ montos = 183.50` exactly

#### Scenario: The residual cent does not depend on tax order

- GIVEN a line of `186.50` carrying IVA 21% and IIBB 3% over the same net base, whose rounded montos leave a residual cent
- WHEN the breakdown is computed
- THEN the cent lands on IVA, the percent tax with the larger monto, and the same line computed with its taxes supplied in the opposite order stores the identical breakdown

#### Scenario: Ties break by tax id

- GIVEN two percent taxes on the same line whose rounded montos are equal
- WHEN the residual cent is assigned
- THEN it lands on the one with the lower tax id, so the outcome stays deterministic

#### Scenario: Document totals remain gross

- GIVEN a document created with lines whose tax breakdown is the exact decomposition above
- WHEN the document totals are calculated
- THEN `total = subtotal - descuento_total + Σ percepciones` using gross subtotals, identical to the pre-change convention, and the breakdown taxes change no total

#### Scenario: Historical documents are immutable

- GIVEN documents created before a product's tax assignment changed
- WHEN any later product or tax edit occurs
- THEN the stored `DocumentLineTax` breakdowns and totals of those historical documents remain byte-identical (no recompute)
