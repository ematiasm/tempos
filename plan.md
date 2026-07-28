# Fastapyme — Master Development Plan

A retail / mixed-business management system built on the Full Stack FastAPI Template.
Scope: single store, single currency (ARS), single warehouse.

---

## A. Design Decisions (LOCKED)

| Topic | Decision |
|---|---|
| Project name | **FastEmpre** |
| Code / docs / comments language | **English** (conversation: Spanish) |
| Base stack | Full Stack FastAPI Template (extend, don't modify) |
| RBAC | Dynamic editable roles + `resource.action` permissions; 1 user = 1 role (M:N link table ready for future multi-role) |
| Scope | Single store, single currency (ARS), **single warehouse** |
| Documents | Unified `Document` + `DocumentType` model (Odoo-style); types seeded, **individually editable** |
| Seeded types | Factura A/B/C, Ticket, Cotizacion, NC, ND, OC, NC Compra, ND Compra, Remito, Ajuste Stock |
| Numbering | `YYYY-PREFIX-NUM` (prefix editable in admin); **restarts each year; no gaps on void** (voided retains number) |
| Numbering concurrency | `DocumentSequence` table + `SELECT FOR UPDATE` in same tx as INSERT |
| Document status | `active` / `voided` (no draft, no partial state) |
| Cards | Commission % + deferred accreditation date (conciliation) |
| Payment method → account | N:1 (multiple methods → 1 financial account) |
| VAT / taxes | Product → N taxes (`Tax` table + `product_tax` M:N); perceptions (IIBB / PercGan) **auto-applied, removable per line** |
| Default customer | "Consumidor Final" seeded in `init_db` |
| Cost | Last cost from **reference supplier** |
| Sale price | `cost * (1 + margin)`, single margin per product; **precio_venta carries IVA inside** (shelf price): line taxes are an informational breakdown, only document-level taxes (percepciones) add to the total |
| Phase order | After 4c: unified **6+7** (stock + finance ledgers activate the 4a hooks in the same tx, including `limite_credito` validation), then 5 (costs), 8, 9 |
| Product without supplier | Cost/price entered manually on create; trigger activates when reference supplier is assigned |
| Variants | Global toggle in admin; configurable attributes only when enabled |
| Navigation | Operational sidebar + `/admin` with tabs |
| Discounts | Per line and per document |
| Voiding | Total or partial (NC against original with partial amount) |
| Quote → Invoice | 1 click, keeps link to origin document |
| Internal transfers | Yes, between financial accounts |
| Customer | `limite_credito` (0 = no limit; != 0 → validate on credit sale) |
| Supplier | No `limite_credito` |
| Customer/Supplier balance | Single **signed** field (>0 owes, <0 credit in favor, 0 settled) + append-only ledger `CustomerAccountMovement` / `SupplierAccountMovement` |
| Credit-in-favor imputation | Pre-checked at checkout; user confirms or removes |
| Supplier credit in favor | Yes, symmetric to customers |
| Negative stock | Configurable from admin; **default blocked** |
| Stock min/max | On `Product` (nullable) for "to order" report |
| Tax condition | On `BusinessSettings` and `Customer`; DocumentType A/B/C by combo |
| Cash close | No; runtime impact |
| 80mm thermal printing | **Discarded** (will come with future POS) |
| PDF printing | HTML view + `window.print()` (no backend lib) |
| Saldo cache concurrency | Atomic `UPDATE ... SET saldo = saldo + :delta` in same tx as ledger INSERT (Postgres row-level lock) |
| Known bug | `deps.py:36` (Py2 syntax) → fix in Phase 0 |

---

## B. Final Data Schema

### Auth / Core
- `User` (existing, +role_id), `Role`, `Permission`, `role_permission`, `user_role`
- `BusinessSettings` (singleton: business_name, address, phone, email, cuit, condicion_fiscal, allow_negative_stock=false, enable_variants=false, default_iva fallback)

### Catalog
- `Category` (self-ref hierarchical), `UoM` (name, abbreviation, decimal_places)
- `Product` (name, sku, category_id, uom_id, margen_pct, costo_actual, precio_venta computed, stock_current cache, stock_minimo?, stock_maximo?, description, is_active) — **no `iva_rate`** (uses `product_tax`)
- `ProductVariant`, `Barcode` (N per product/variant, code unique), `Attribute`, `AttributeValue`, `ProductVariantAttribute`
- `Tax` (name, code, tipo [IVA/IIBB/PercGan/Interno/Otro], rate, is_percent, aplica_a [linea/documento], `is_default`, is_active) — seeded; IVA 21% is the seeded default (`is_default` name chosen because `default` is a SQL reserved word)
- `product_tax` (M:N)
- `DocumentLineTax` (snapshot of taxes per line) and `DocumentTax` (aggregate per tax_id with base+amount)

### Counterparties
- `Customer` (razon_social, documento **nullable, unique when present** — CUIT/CUIL only: 11 digits, mod-11 check digit; DNIs rejected until the ARCA padron lookup can resolve them, phone, email, address, condicion_fiscal, limite_credito=0, saldo signed, is_active) — "Consumidor Final" seeded without document, protected from delete/deactivation
- `Supplier` (razon_social, documento same rule as Customer, phone, email, address, condicion_fiscal, saldo signed, is_active)

### Documents
- `DocumentType` (name, prefix editable, operation_type, signo_stock, signo_caja, es_fiscal, tipo_contraparte)
- `DocumentSequence` (document_type_id, year, last_number) — with `SELECT FOR UPDATE`
- `Document` (type_id, numero string, year, fecha, contraparte_type/id, user_id, estado [active/voided], subtotal, descuento_total, total, parent_document_id nullable for NC and quote→invoice, cae?, cae_vto?)
- `DocumentLine` (product_id, variant_id, cantidad, precio_unit, `costo_unitario` — snapshot at sale time, needed for historical margin reports, descuento_pct, descuento_monto, subtotal_line)
- `DocumentLineTax` (tax_id, base, monto, aplicado bool default true)
- `DocumentTax` (tax_id, base, monto)
- `DocumentPayment` (payment_method_id, monto, comision_pct?, fecha_acreditacion?, conciliado)

### Costs
- `SupplierProduct` (supplier_id, product_id, costo_anterior, costo_actual, fecha_actualizacion, es_referencia, es_default) composite PK

### Stock ledger (append-only, immutable)
- `StockMovement` (product_id, variant_id, document_id, document_line_id, signo, cantidad signed, motivo, user_id, created_at)

### Finance (append-only ledger)
- `FinancialAccount` (name, tipo [efectivo/banco/tarjeta/digital/cuenta_cliente/cuenta_proveedor], saldo signed, currency="ARS")
- `PaymentMethod` (name, financial_account_id N:1, requiere_conciliacion)
- `AccountMovement` (financial_account_id, document_id?, payment_method_id?, transfer_id?, monto signed, tipo, fecha, fecha_acreditacion?, conciliado, user_id, created_at)
- `Transfer` (from_account_id, to_account_id, monto, fecha, descripcion, user_id)

### Current-account ledger (append-only)
- `CustomerAccountMovement` (customer_id, document_id, monto signed, created_at)
- `SupplierAccountMovement` (mirror)

---

## C. Execution Phases

| Phase | Deliverable |
|---|---|
| **0** | `AGENTS.md` + fix `deps.py:36` + refactor `Page[T]` + `PaginationDep` with bounds |
| **1** | RBAC (Role, Permission, link tables, `require_permissions`, seed) + `BusinessSettings` + admin tab "General" + admin "Users and Roles" |
| **2** | Catalog (`Tax` + `product_tax`, `Product` with stock_min/max, `Category`, `UoM`, `Barcode`, variants with toggle) + Catalog section |
| **3** | Counterparties (`Customer` with limite=0→free + Consumidor Final seed, `Supplier` without limite) + Customers and Suppliers sections |
| **4a** | Document structure: seeded `DocumentType` (prefixes per section F) + `DocumentSequence` (`SELECT FOR UPDATE`) + `Document` + `DocumentLine` (with `costo_unitario` snapshot) + `DocumentLineTax` + `DocumentTax` + `DocumentPayment`; document creation; numbering `YYYY-PREFIX-NUM`; tax condition → A/B/C; per-line and per-document discounts; taxes auto-applied, removable per line (`aplicado` flag). Explicit hook points for costs (5), stock (6) and finance ledger (7) |
| **4b** | Voiding: total and partial (NC against original via `parent_document_id`); states `active`/`voided` |
| **4c** | Quote → Invoice in 1 click, link via `parent_document_id` |
| **6+7** | Unified ledgers: `StockMovement` (append-only, negative-stock validation, atomic `Product.stock_current` UPDATE) + finance (`AccountMovement`, `Transfer`, card commission + deferred accreditation, `CustomerAccountMovement`/`SupplierAccountMovement` with atomic `saldo` UPDATE, `limite_credito` validation on credit sales). Activates the 4a hooks in the document transaction. (`FinancialAccount`/`PaymentMethod` tables + seeds already landed in 4a for `DocumentPayment`) |
| **5** | Costs (`SupplierProduct` N:M + history); trigger on purchase: flag if new cost != current + option to update |
| **8** | Operational UX (Sales, Purchases, Stock, Catalog, Customers, Suppliers) + reports (sales/day, low stock, balances, VAT/perceptions, margin per product, current-account ledger, to-order with supplier/category filter, cash/bank movements) + HTML voucher view with `window.print()` |
| **9** | i18n/es + Playwright E2E of critical flows + deploy |

Each phase: Alembic autogenerate migration + Pytest tests + regenerate OpenAPI client (`bash ./scripts/generate-client.sh` from the repo root).

---

## D. `AGENTS.md` outline (to be created in Phase 0)

1. Project purpose and scope (FastEmpre, retail/mixed-business, single-store ARS)
2. Stack and conventions (SQLModel + Pydantic v2 + Alembic + ruff + mypy strict; react-hook-form + zod + TanStack Query/Router/Table + shadcn/ui new-york + sonner; **language: English everything**)
3. Commands (`docker compose watch`, `uv sync`, `alembic revision --autogenerate`, `alembic upgrade head`, `bash scripts/test.sh`, `bash scripts/lint.sh`, `bun install`, `bun run dev`, `bun run generate-client`, `bunx playwright test`, `uv run prek run --all-files`)
4. Where things live (models in `models.py`, CRUD in `crud.py`, routes in `api/routes/`, seed in `core/db.py`+`initial_data.py`, frontend routes in `src/routes/` file-based, services in `src/client/sdk.gen.ts` autogenerated)
5. Strict rules:
   - Do not invent business data → ask first
   - Every new table → Alembic migration
   - After touching backend → regenerate OpenAPI client
   - Validate with `scripts/test.sh` and `scripts/lint.sh`
   - Ledgers (StockMovement, AccountMovement, Customer/SupplierAccountMovement) are **append-only and immutable**; INSERT only
   - Saldo caches via atomic UPDATE `saldo = saldo + :delta` in same tx as ledger INSERT
   - Document numbering via `DocumentSequence` with `SELECT FOR UPDATE` in same tx as document INSERT
   - Pagination via `Page[T]` + `PaginationDep` (do not duplicate per-entity `XxxPublic{data,count}`)
   - Every new permission → add to `init_db` seed
   - Code/comments in **English**
6. Module map (compact schema of section B)
7. Future ARCA hooks: `cae` / `cae_vto` fields reserved in `Document` (inert until post-phase 9)
8. Known bug: `deps.py:36` fixed in Phase 0

---

## F. Open items to define at phase time (non-blocking)

These will be confirmed when reaching each phase and do not block Phase 0:

| Phase | To define on arrival |
|---|---|
| 4a | Exact `DocumentType` seed rows and prefix defaults (e.g. VEN/BTA per operation_type) |
| 8 | Extra reports beyond the prioritized ones; voucher HTML template structure |
| 9+ | ARCA padron lookup: resolve DNI → CUIT at customer save; re-tighten `documento` rules at fiscal issuance (requires the ARCA integration) |
