# Changelog

## Unreleased

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
