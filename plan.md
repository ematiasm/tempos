# Tempos — Master Development Plan

A retail / mixed-business management system built on the the upstream template.
Scope: single store, single currency (ARS), single warehouse.

---

## A. Design Decisions (LOCKED)

| Topic | Decision |
|---|---|
| Project name | **tempos** |
| Code / docs / comments language | **English** (conversation: Spanish) |
| Base stack | the upstream template (extend, don't modify) |
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
- `FinancialAccount` (name, saldo signed, currency="ARS") — pure balance container
- `PaymentMethod` (name, financial_account_id N:1, marks_paid default true, requiere_conciliacion); `marks_paid=false` = current-account/credit method (neither counts as paid nor generates `AccountMovement`)
- `AccountMovement` (financial_account_id, document_id?, payment_method_id?, transfer_id?, monto signed, tipo, fecha, fecha_acreditacion?, conciliado, user_id, created_at)
- `Transfer` (from_account_id, to_account_id, monto, fecha, descripcion, user_id)

### Current-account ledger (append-only)
- `CustomerAccountMovement` (customer_id, document_id, monto signed, created_at). Sum = `Customer.saldo`; credit sales (unpaid remainder or `marks_paid=false` payments) increase it
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
| **6+7** | Unified ledgers: `StockMovement` (append-only, negative-stock validation, atomic `Product.stock_current` UPDATE) + finance (`AccountMovement`, `Transfer`, card commission + deferred accreditation, `CustomerAccountMovement`/`SupplierAccountMovement` with atomic `saldo` UPDATE, `limite_credito` validation on credit sales). Activates the 4a hooks in the document transaction. (`FinancialAccount`/`PaymentMethod` tables + seeds already landed in 4a for `DocumentPayment`). ✅ Done |
| **5** | Costs (`SupplierProduct` N:M + history). Purchase trigger is suggestion-only: `POST /documents` returns `cost_change_suggestions` only for lines whose price exceeds `Product.costo_actual` (never mutates anything by itself); the user confirms via the buy screen. Confirming a suggestion promotes the pair to `es_referencia`, replacing any previous reference. The reference supplier (`es_referencia`) drives `Product.costo_actual` + `precio_venta` recompute atomically. UI: Costs tab in the product detail sheet. ✅ Done |
| **8** | Operational UX (Sales, Purchases, Stock) + reports (sales/day, margin per product, VAT/perceptions, low stock, to-order with supplier/category filter, cash/bank movements, current accounts) + HTML voucher view with `window.print()`. ✅ Done |
| **9** | i18n/es (react-intl, default es + en, locale switch in User Settings) + Playwright E2E of critical flows (73 specs green, template specs migrated to Spanish UI) + deploy (DO VPS + Traefik; `scripts/deploy.sh` + `docs/DEPLOY.md` + `.env.production.example`). ✅ Done. Detail: below |

Each phase: Alembic autogenerate migration + Pytest tests + regenerate OpenAPI client (`bash ./scripts/generate-client.sh` from the repo root).

### Phase 9 — i18n/es + E2E + deploy (locked plan)

#### 9a — i18n with react-intl (es default + en)
- Add `react-intl`. Messages as typed modules (`src/i18n/messages/en.ts`, `es.ts`; `Messages = typeof en` so missing keys fail at compile time).
- `IntlProvider` mounted at the app root; locale preference in `localStorage` (`tempos.locale`), **default `es`**; language switch exposed in User Settings.
- Dates/numbers via `intl.formatDate` / `formatNumber` (ARS currency, es-AR dates).
- Migration order (largest value first): Sell, Buy, Stock, Reports, Documents (incl. voucher + print), sidebar/nav + page titles, Customers/Suppliers, Products, Admin (users/roles, catalog, finance, settings), auth screens. Voucher text follows the same catalogs.
- **Backend errors**: keep backend messages in English, but add a stable machine `code` in `detail` (`{"code": "insufficient_stock", "message": "..."}`) on the UX-critical endpoints (stock, credit limit, voiding/NC, document numbers, taxes). Frontend `handleError` maps `code` → `intl.formatMessage`; unknown codes fall back to the raw message.
- Toasts, empty states and DataTable labels use messages.
- No new tables; locale is device-level (per-user locale persisted in `User` is a possible later follow-up, not part of this phase).

#### 9b — Playwright E2E of critical flows
- Migrate the template specs (login, sign-up, items, admin, user-settings, reset-password) to the Spanish UI text (default locale es).
- New specs, seeding data through the backend API via Playwright `request` where setup is not the flow under test:
  1. `catalog.spec.ts` — create UoM/Tax/Product in admin; verify computed `precio_venta` and searchability in Sell.
  2. `sell.spec.ts` — cart → customer (Consumidor Final) → payment → issue; success screen; voucher preview with `window.print` stubbed.
  3. `buy.spec.ts` — purchase with lines; cost suggestion panel; apply suggestion → product cost updated.
  4. `stock.spec.ts` — positive/negative adjustments; negative-stock warning.
  5. `documents.spec.ts` — list, detail, void sale → NC issued, original flips to voided.
  6. `reports.spec.ts` — tabs render and show seeded data.
- Runs against the local stack (db + backend + `bun run dev`); `playwright.config.ts` keeps baseURL `http://localhost:5173`.

#### 9c — Deploy (DO VPS + Traefik)
- `compose.prod.yml`: postgres (persistent volume) + backend (prestart migrations, `ENVIRONMENT=production`) + frontend (nginx serving `dist`) + traefik integration (TLS via Let's Encrypt, `https-redirect` middleware; routers for `DOMAIN` and `traefik.DOMAIN`).
- `.env.production.example`: `DOMAIN`, `ENVIRONMENT=production`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `FIRST_SUPERUSER_*`, `BACKEND_CORS_ORIGINS=https://DOMAIN`, `VITE_API_URL`.
- Validate/adapt the existing `deploy-staging.yml` / `deploy-production.yml` workflows and add `scripts/deploy.sh` if missing.
- `docs/DEPLOY.md`: DO droplet setup (docker install, DNS A record, `.env.production`, `docker compose -f compose.prod.yml up -d`), backups (`pg_dump`) and restore steps, logs/rollback.
- CI smoke (`smokeshow.yml`) already present; verify it points at the new specs.

---

## D. `AGENTS.md` outline (to be created in Phase 0)

1. Project purpose and scope (tempos, retail/mixed-business, single-store ARS)
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
