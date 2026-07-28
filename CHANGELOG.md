# Changelog

## Unreleased

### Phase 4b — Voiding (total/partial via NC)
- `POST /documents/{id}/void` (perm `document.void`): empty `lines` voids everything pending; otherwise per-line quantities, validated against the accumulated remaining (active NCs only). Issued NC carries the same prices/taxes/cost snapshots and links via `parent_document_id` + per-line `parent_line_id`.
- The original flips to `voided` only when every line is fully reverted; the document-level discount reverses on the NC exactly then (partial NCs leave it attached to the original).
- `DocumentType.void_document_type_id`: seed-managed, rename-proof void mirror (FA/FB/FC/TCK/NDV → NCV, OC/NDC → NCC); NC/ND/quote/remito/ajuste not voidable.
- Document detail exposes per-line `cantidad_pendiente`; `/documents` detail dialog gains a "Void document" action with per-line quantities and "void all remaining".

### Phase 4a — Document structure
- Odoo-style unified documents: 12 seeded `DocumentType` (editable name/prefix; locked signs), `DocumentSequence` numbering (`YYYY-PREFIX-00000001`, `SELECT FOR UPDATE` + savepoint race fallback), `Document` with lines (sale-time `costo_unitario` snapshot), line/document tax snapshots and payments; no-op integration hooks for phases 5/6/7 inside the creation transaction.
- Pricing convention locked: `precio_venta` carries IVA inside; line taxes are informational, only percepciones add to the total; discounts per line (pct or amount) and per document.
- `GET /documents/suggest-type` resolves Factura A/B/C from the business/customer tax condition combo (RI+RI→A, RI+other→B, non-RI→C).
- `FinancialAccount`/"Caja Principal" + `PaymentMethod`/"Efectivo" tables and seeds (ledger lands in phase 6+7); `GET /payment-methods`.
- Admin tab "Document Types" + read-only `/documents` list with detail dialog.
- Roadmap reordered: unified 6+7 (stock + finance ledgers) now lands before 5 (costs) so the document hooks activate before real usage.

### Phase 0 — Foundations
- `Page[T]` pagination envelope + `PaginationDep` with bounds; `AGENTS.md` agent guide.

### Phase 1 — RBAC + Business Settings
- `Role`, `Permission`, `role_permission`, `user_role` tables; `require_permissions` dependency; "Administrador" role seed with auto-sync of new permissions.
- `BusinessSettings` singleton (identity, tax condition, `allow_negative_stock`, `enable_variants`, `default_iva`).
- Admin tabs: "General" and "Users and Roles".

### Phase 2 — Catalog
- `Tax` with `is_default` flag (IVA 21% seeded default), `Category` (hierarchical), `UoM`, `Product` (computed `precio_venta`, `stock_current` cache, min/max), `Barcode` (per product/variant), `Attribute`/`AttributeValue`/variants behind the `enable_variants` toggle.
- Admin tabs: Categories, Units, Taxes, Attributes; Products section with category tree, search, variants and deactivate UI.

### Phase 3 — Counterparties
- `Customer`/`Supplier` with CUIT/CUIL mod-11 check digit validation (`app/validators.py`), document nullable and unique when present (DNIs rejected until the future ARCA padron lookup), signed `saldo`, soft delete (deactivate).
- "Consumidor Final" customer seeded in `init_db`, protected from delete/deactivation.
- Customers and Suppliers sections with search, dialogs and balance column.
