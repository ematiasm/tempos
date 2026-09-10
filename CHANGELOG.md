# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed — purchase line-tax rows computed forward from the net subtotal

`_create_document_in_tx` decomposed **every** line subtotal as if it were a
tax-inclusive sale price. Purchase line prices are net, so an OC line of
200.00 with IVA 21% stored `base 165.29 + monto 34.71` instead of the correct
`base 200.00 + monto 42.00`. `COMPRA` operations now use `_forward_line_taxes`
(percent montos on the net base, fixed amounts once); sales, quotes and void
mirrors keep the exact gross decomposition. Historical rows are untouched
(stored rows are never rewritten) — only new documents get the corrected
breakdown. No schema change, no OpenAPI change.

### Changed — pricing chain: taxes integrated in the price (margins over net)

The pricing convention changed from "cost × margin = sale price, IVA shown
informationally" to a **neto + line-taxes chain**:

- `precio_neto = costo_actual × (1 + margen_pct / 100)` (exact 2-dec margin
  over cost, before line taxes).
- `precio_venta` (góndola) = `round_mode(neto + neto × Σ percent rates / 100
  + Σ fixed amounts)`, where `round_mode` is the new admin setting
  `price_rounding` (`none` / `two_decimals` / `psychological_90`; only the
  góndola is rounded).
- Document line-tax breakdowns are now an **exact decomposition**
  (`neta + Σ montos == subtotal_bruto`, cent-exact via adjust-last-percent);
  the report margin is computed over **net revenue** (`revenue_neto`), not
  the gross line subtotal.
- New business rule: at most **one** tipo-IVA tax per product (`exento`
  counts as an IVA marker); fixed-amount taxes must be strictly positive.

**Rollout (required, destructive to derived data):**

1. `uv run alembic upgrade head` (additive: `businesssettings.price_rounding`,
   `product.precio_neto`).
2. `docker compose down -v` — **volume wipe required**: any pre-change
   `margen_pct` interpretation (margin over gross IVA-inclusive price) is
   discarded; stale products would reprice inconsistently with the new chain.
3. Reseed: `docker compose watch` + prestart (taxes, demo data via first-run
   setup).
4. Regenerate the frontend client: `bash ./scripts/generate-client.sh`.

Rollback: `git revert` + `uv run alembic downgrade -1` (drops only the two
added columns; no ledger/document tables touched).
