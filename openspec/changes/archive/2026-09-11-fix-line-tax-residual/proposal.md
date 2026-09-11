# Proposal: Make the line-tax residual deterministic

## Intent

Every document line decomposes its gross price into a net base plus its taxes, and the
decomposition must reconcile exactly to the cent. Because rounding each percent tax on its
own can leave a residual cent, one of them has to absorb it. The code assigned it to **the
last percent tax** of the sequence it received — and that sequence came from
`Product.taxes`, a relationship declared without an ordering:

```python
taxes: list["Tax"] = Relationship(back_populates="products", link_model=ProductTax)
```

So "the last percent tax" was undefined. With two percent taxes the cent lands on a
different row depending on the order Postgres happens to return the link rows in, which
makes the *stored* breakdown non-reproducible: two identical sales can keep different
`DocumentLineTax.monto` values, and the breakdown printed on a voucher cannot be derived
from the inputs again. The identity always held, so nothing else failed — the only signal
was a test that flipped between two expected values.

Found while validating an unrelated change, tracked as issue #51 with the evidence: the
assertion observed `31.59` where it expected `31.58`, and the file failed 2 of 4 runs.

## Agreed decisions (binding for spec)

1. **The residual goes to the percent tax with the largest `monto`**, ties broken by tax id.
   Choosing by value rather than by position is what makes the result order-independent.
2. **No data migration.** Stored breakdowns are never rewritten, so historical documents
   keep what they have; the rule applies to every document created from now on.
3. **The rule is stated in `pricing`**, replacing the delegation ("the design MUST specify a
   deterministic reconciliation rule") with the rule itself, plus a scenario that pins the
   order-independence.

## Scope

### In Scope

- `crud._decompose_line_taxes`: assign the residual by largest monto with an id tie-break.
- The test that flipped, updated to assert the rule rather than position.
- The `pricing` requirement, modified to carry the rule and a scenario for it.

### Out of Scope

- The shelf-price rounding feature (`price_rounding`): it is a separate concern, scheduled
  separately, and unrelated to this arithmetic.
- Any rewrite of stored `DocumentLineTax` rows: historical documents are immutable.

## Capabilities

> Contract with sdd-spec. One capability is affected: `pricing` owns the exact line-tax
> decomposition.

### Modified Capabilities

- `pricing`: MODIFIED `Document line tax decomposition (exact)` — the delegation to a
  "deterministic rule" becomes the rule, and a scenario pins that the assignment does not
  depend on the order the taxes arrive in.

## Risks

| Risk | Mitigation |
|------|-----------|
| Stored history could look inconsistent with the new rule | Stored rows are never rewritten, so nothing changes retroactively; the spec already required historical immutability |
| Another test could assert the old outcome | The whole suite runs green: 384 passed, and the identity was never affected |
| The tie-break could be missed when two taxes have equal montos | Ties break by tax id, stated in the spec and implemented in one comparable key |

## Rollback

Reverting the assignment restores the previous rule, with no data implications.

## Success Criteria

1. The residual cent lands on the percent tax with the largest monto, ties by id.
2. The same line computed with its taxes in either order stores an identical breakdown.
3. `pricing` states the rule instead of delegating it.
4. The backend suite passes repeatedly, including the test that used to flip.
