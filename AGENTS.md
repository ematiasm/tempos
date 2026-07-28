# FastEmpre — Agent Guide

This document is the source of truth for any AI agent (or human contributor)
working on the FastEmpre codebase. Read it before making any change.

> The conversation with the user happens in **Spanish**, but **every artifact
> produced in the repo** (code, comments, docstrings, README content, commit
> messages, migration messages, seed data labels) must be written in **English**.

The full product plan, design decisions, and phase breakdown live in
[`plan.md`](./plan.md). This file is the operational guide: what to do and how.

---

## 1. Project purpose and scope

FastEmpre is a retail / mixed-business management system built on top of the
[Full Stack FastAPI Template](https://github.com/fastapi/full-stack-fastapi-template).

Confirmed scope (see `plan.md` for the locked design table):

- Single store, single warehouse, single currency (ARS).
- Module set: RBAC, business settings, catalog (with variants and multiple
  barcodes), customers and suppliers (with current-account ledgers), unified
  documents (sales/purchases/quotes/credit-debit notes/stock adjustments),
  stock ledger, finance ledger (financial accounts, payment methods,
  transfers, card conciliation), reports, HTML voucher printing via
  `window.print()`.
- Future (out of current scope): multi-store, AFIP/ARCA electronic invoicing,
  80mm thermal printing, POS UI.

## 2. Stack and conventions

### Backend
- **FastAPI** + **SQLModel** (ORM) + **Pydantic v2** + **pydantic-settings**
  + **Alembic** + **PostgreSQL** (psycopg). Python `>=3.14,<4.0`.
- Type checking: `mypy --strict` + `ty check`. Formatting/lint: `ruff`.
- Pre-commit hooks via `prek` (modern pre-commit alternative).
- Auth: OAuth2 password flow + JWT (HS256), stateless, 8-day expiry.
- Tests: `pytest` with `fastapi.testclient.TestClient` against the **real**
  Postgres (the `db` fixture in `backend/tests/conftest.py` is session-scoped
  and autouse, it applies migrations + seeds the first superuser).
- Use **Pydantic v2 syntax** (`model_validate`, `model_dump(exclude_unset=...)`,
  `@model_validator`, `Annotated[...]`, generic `class Foo[T]`).

### Frontend
- **React 19** + **Vite** + **TanStack Router** (file-based, auto code-split)
  + **TanStack Query** + **TanStack Table** + **shadcn/ui** (new-york style,
  Tailwind v4) + **react-hook-form** + **zod** + **sonner** toasts.
- Client OpenAPI autogenerado con `@hey-api/openapi-ts` (axios under the hood).
- No global state store; remote state lives in React Query, theme/auth in a
  custom `ThemeProvider` + `localStorage`.
- No i18n yet (text is currently hardcoded; phase 9 adds es).

### Language rule
- All code, comments, docstrings, README content, commit messages, migration
  descriptions, seed labels: **English**.
- Conversation with the user happens in Spanish.

## 3. Commands

### Environment setup (one-time)
```bash
# Backend
cd backend && uv sync && cd ..

# Frontend
cd frontend && bun install && cd ..
```

### Local development stack (Docker Compose)
```bash
docker compose watch    # bring up db, backend, frontend, traefik, adminer, mailcatcher
docker compose down -v  # teardown + wipe volumes
```

### Backend (from `backend/`)
```bash
uv sync                                          # install/sync deps
uv run fastapi dev app/main.py                   # local dev server (no Docker)
uv run alembic revision --autogenerate -m "..."  # create migration
uv run alembic upgrade head                      # apply migrations
bash scripts/test.sh                            # run tests + coverage
bash scripts/lint.sh                             # mypy + ty + ruff check + ruff format --check
bash scripts/format.sh                           # ruff --fix + ruff format
uv run pytest tests/api/routes/test_users.py -x  # targeted tests
uv run prek run --all-files                      # run all pre-commit hooks
```

### Frontend (from `frontend/`)
```bash
bun run dev                 # local dev server (no Docker)
bun run build               # typecheck (tsc) + Vite build
bun run lint                # biome
bunx playwright test         # E2E tests (requires stack running)
bunx playwright test --ui    # interactive E2E
```

### Regenerate the OpenAPI client (MUST run after any backend schema change)
Run from the repo root:
```bash
bash ./scripts/generate-client.sh
```
This dumps `openapi.json`, regenerates `frontend/src/client/*` and runs frontend lint.

### Useful URLs (local dev)
- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- Adminer: <http://localhost:8080>
- Traefik UI: <http://localhost:8090>
- MailCatcher: <http://localhost:1080>

## 4. Where things live

### Backend (`backend/app/`)
| Concern | Location | Notes |
|---|---|---|
| SQLModel tables + API schemas | `app/models.py` | Single file today. New tables ARE added here (the template convention). |
| CRUD functions | `app/crud.py` | Currently minimal. New domain CRUD goes here. |
| FastAPI app + lifespan + CORS | `app/main.py` | |
| Aggregated API router | `app/api/main.py` | Include new routers here. |
| HTTP dependencies (`SessionDep`, `CurrentUser`, `PaginationDep`) | `app/api/deps.py` | Reusable FastAPI deps. |
| Route modules | `app/api/routes/` | One file per resource. |
| Settings | `app/core/config.py` | `pydantic-settings`, `.env` is read from repo root. |
| Security (JWT, hashing) | `app/core/security.py` | Argon2 + bcrypt hashers. |
| DB engine + first-superuser seed | `app/core/db.py` | `init_db(session)` seeds the superuser. |
| Entrypoint for initial data | `app/initial_data.py` | Called by `scripts/prestart.sh`. |
| Alembic env + versions | `app/alembic/` | `env.py`, `versions/`. |
| Email templates | `app/email-templates/` | `src/*.mjml` → `build/*.html`. |
| Tests | `backend/tests/` | `conftest.py` fixtures + per-area folders. |
| Helper scripts | `backend/scripts/` | `prestart.sh`, `test.sh`, `lint.sh`, `format.sh`. |

### Frontend (`frontend/src/`)
| Concern | Location | Notes |
|---|---|---|
| File-based routes (TanStack Router) | `src/routes/` | **Do NOT edit `routeTree.gen.ts`** — it is autogenerated by Vite. |
| Layout + auth guard | `src/routes/_layout.tsx` | |
| Admin panel | `src/routes/_layout/admin.tsx` | Currently single-view; will become tabs. |
| Settings (tabs reference pattern) | `src/routes/_layout/settings.tsx` | Use as the pattern when adding admin tabs. |
| Sidebar config | `src/components/Sidebar/AppSidebar.tsx` | Add nav items in `baseItems` (or superuser branch). |
| shadcn/ui primitives | `src/components/ui/` | Already has: button, dialog, form, input, select, table, tabs, sonner, dropdown-menu, etc. To add more: `npx shadcn@latest add switch textarea ...`. |
| Domain components | `src/components/Admin/`, `src/components/Items/` | Per-domain folders with `Add*`, `Edit*`, `Delete*`, `columns.tsx`, `*ActionsMenu.tsx`. |
| Generic DataTable | `src/components/Common/DataTable.tsx` | Built on `@tanstack/react-table` with client-side pagination. |
| Auth logic | `src/hooks/useAuth.ts` | `isLoggedIn`, `user`, `login`, `logout`, `signUp`. Token in `localStorage["access_token"]`. |
| Toast helpers | `src/hooks/useCustomToast.ts` | `showSuccessToast` / `showErrorToast` (sonner). |
| OpenAPI client (autogenerated) | `src/client/` | `sdk.gen.ts` (services), `types.gen.ts` (DTOs), `core/` (axios + OpenAPI config). **Do not edit by hand.** |
| Type utilities | `src/lib/utils.ts` | `cn()` (clsx + tailwind-merge). |
| Theme provider | `src/components/theme-provider.tsx` | Custom (not next-themes). |

### Root
| Concern | Location |
|---|---|
| Full product plan | `plan.md` |
| This agent guide | `AGENTS.md` |
| Docker Compose | `compose.yml`, `compose.override.yml`, `compose.traefik.yml` |
| Per-environment config | `.env` (read by Docker Compose and `app/core/config.py`) |
| Pre-commit config | `.pre-commit-config.yaml` (uses `prek`) |

## 5. Strict rules — READ BEFORE EACH CHANGE

1. **Do not invent business data.** When the user's request is ambiguous or
   underspecified, **ask before deciding** fields, defaults, statuses, seed
   values, label text, or anything domain-specific. The user has been explicit
   about preferring questions over guesses.

2. **Every new SQL table → Alembic migration.** Define the model in
   `app/models.py`, then:
   ```bash
   uv run alembic revision --autogenerate -m "Add <Table> model"
   uv run alembic upgrade head
   ```
   Commit both the model change and the migration file under
   `backend/app/alembic/versions/`.

3. **After any backend OpenAPI-shape change → regenerate the frontend client:**
   ```bash
   bash ./scripts/generate-client.sh
   ```
   Then run `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` to
   confirm types still line up. Fix any breakage in the React routes/components
   (the client types are auto-generated; downstream code is hand-written).

4. **Validate before finishing any task:**
   ```bash
   bash backend/scripts/test.sh     # tests + coverage
   bash backend/scripts/lint.sh     # mypy + ty + ruff check + ruff format --check
   cd frontend && bunx tsc -p tsconfig.build.json --noEmit
   cd frontend && bun run lint
   ```
   All must pass. If `ruff format --check` reports reformatting, run
   `bash backend/scripts/format.sh` and re-stage.

5. **Ledgers are append-only and immutable.** The following tables must only
   be written to via `INSERT`. Never `UPDATE` or `DELETE` rows in:
   - `StockMovement`
   - `AccountMovement`
   - `CustomerAccountMovement`
   - `SupplierAccountMovement`
   Corrections happen by inserting an opposite-sign movement that references the
   original via a `parent_*_id` / `document_id` link.

6. **Saldo caches update atomically, in the same transaction as the ledger
   INSERT.** Pattern:
   ```python
   session.add(movement)                       # ledger INSERT
   session.execute(
       update(Customer)
       .where(Customer.id == customer_id)
       .values(saldo=Customer.saldo + delta)
   )
   session.commit()
   ```
   Never read-then-write the saldo field outside a single transaction; Postgres
   row-level serializes concurrent deltas on the same row.

7. **Document numbering uses `DocumentSequence` + `SELECT FOR UPDATE`.** The
   next number for `(document_type_id, year)` must be claimed inside the same
   transaction that inserts the `Document`. Never compute the next number from
   `SELECT MAX(...)` (it races). Empty prefilled-gap on voiding is intentional
   (the voided document retains its number).

8. **Pagination is via `Page[T]` and `PaginationDep`.** Do not duplicate
   `XxxPublic { data, count }` per entity. New list endpoints:
   ```python
   from app.models import Page
   from app.api.deps import PaginationDep

   @router.get("/", response_model=Page[WidgetPublic])
   def read_widgets(session: SessionDep, pagination: PaginationDep) -> Any:
       count = session.exec(select(func.count()).select_from(Widget)).one()
       rows = session.exec(
           select(Widget).offset(pagination.skip).limit(pagination.limit)
       ).all()
       return Page[WidgetPublic](data=[...], count=count)
   ```
   `Page` is a plain `pydantic.BaseModel` (not SQLModel) so Pydantic v2 can
   emit correct `$ref` items in the OpenAPI schema.

9. **Every new permission → add to the seed in `init_db`.** Permission codes
   follow `resource.action` (e.g. `product.create`, `sale.void`, `report.view`).
   When you introduce one, also add it to the seed so the first superuser has
   it automatically on a fresh DB.

10. **Auth dependency:** prefer
    ```python
    from app.api.deps import CurrentUser, SessionDep
    ```
    Use `Depends(get_current_active_superuser)` for superuser-only endpoints
    today. Phase 1 introduces `require_permissions(...)`. Once it exists, new
    endpoints that need granular access use it instead of the superuser bool.

11. **Language rule (repeat):** Code, comments, docstrings, README content,
    commit messages, migration descriptions, seed data strings: **English**.

12. **One concern per file / per commit.** Keep migrations scoped to a single
    conceptual change. Keep route files scoped to a single resource. Keep
    components scoped to a single domain.

13. **Do not modify the template's behavior unrelated to the task.** The
    Full Stack FastAPI Template is the foundation; extend it, don't refactor
    unrelated parts without an explicit reason.

14. **Do not commit secrets.** The `.env` file is in the repo for local dev
    convenience in this template, but never commit real credentials,
    `SECRET_KEY`s, or `POSTGRES_PASSWORD`s.

## 6. Module map (compact schema reference)

This is the high-level module map. For the full locked design table, see
`plan.md` section A. For the full schema, see `plan.md` section B.

### Auth / Core
- `User` (+ `role_id`), `Role`, `Permission`, `role_permission` (M:N),
  `user_role` (M:N, currently 1:1, ready for multi-role).
- `BusinessSettings` (singleton row: business identity, tax condition,
  `allow_negative_stock` (default false), `enable_variants` (default false),
  default VAT fallback).

### Catalog
- `Category` (self-ref hierarchical), `UoM` (unit of measure with decimals).
- `Product` (margen_pct, costo_actual, precio_venta computed, stock_current
  cache, stock_minimo?, stock_maximo?, is_active). **No `iva_rate` field** —
  taxes come from `product_tax`.
- `ProductVariant` (only used when `enable_variants` is true), `Barcode`
  (N per product or variant, code unique), `Attribute`, `AttributeValue`,
  `ProductVariantAttribute` (link table).
- `Tax` (name, code, tipo [IVA/IIBB/PercGan/Interno/Otro], rate, is_percent,
  aplica_a [linea/documento], is_default, is_active) — seeded with IVA
  21/10.5/27/0 + exento; IVA 21% is the seeded `is_default` (the column is named
  `is_default` because `default` is a SQL reserved word).
- `product_tax` (M:N between Product and Tax).

### Counterparties
- `Customer` (razon_social, documento **nullable, unique when present**
  (CUIT/CUIL only: 11 digits, mod-11 check digit validated via
  `app/validators.py`; DNIs rejected until the future ARCA padron lookup can
  resolve them), phone, email, address, condicion_fiscal, `limite_credito`
  (0 = no limit; != 0 → validate on credit sale), `saldo` signed, is_active).
- `Supplier` (same shape, no `limite_credito`).
- "Consumidor Final" customer is seeded in `init_db` (no document) and is
  protected from delete/deactivation, like the "Administrador" role.

### Documents (Odoo-style unified)
- `DocumentType` (name, prefix editable (e.g. VEN/BTA), operation_type,
  signo_stock, signo_caja, es_fiscal, tipo_contraparte). Seeded types: Factura
  A/B/C, Ticket, Cotización, NC, ND, OC, NC Compra, ND Compra, Remito,
  Ajuste Stock.
- `DocumentSequence` (document_type_id, year, last_number) — used with
  `SELECT FOR UPDATE` to claim next number.
- `Document` (type_id, numero `YYYY-PREFIX-NUM`, year, fecha,
  contraparte_type/id, user_id, estado [active/voided], subtotal,
  descuento_total, total, parent_document_id nullable (for NC and
  Cotización→Factura link), `cae?`, `cae_vto?` reserved for future ARCA).
- `DocumentLine` (product_id, variant_id, cantidad, precio_unit,
  costo_unitario (sale-time cost snapshot, required for historical margin
  reports), descuento_pct, descuento_monto, subtotal_line).
- `DocumentLineTax` (tax_id, base, monto, aplicado bool default true).
- `DocumentTax` (tax_id, base, monto).
- `DocumentPayment` (payment_method_id, monto, comision_pct?,
  fecha_acreditacion?, conciliado).

### Costs
- `SupplierProduct` (supplier_id, product_id, costo_anterior, costo_actual,
  fecha_actualizacion, es_referencia, es_default) composite PK. **Reference
  supplier's `costo_actual` is the source for `Product.costo_actual`.**
  Trigger on purchase: if new cost != current cost → flag in frontend +
  option to update.

### Stock ledger (append-only, immutable)
- `StockMovement` (product_id, variant_id, document_id, document_line_id,
  signo, cantidad **signed**, motivo, user_id, created_at).
- Stock current is `Product.stock_current` cache, reconciled from the ledger
  via atomic `UPDATE Product SET stock_current = Product.stock_current + :delta`.

### Finance (append-only ledger)
- `FinancialAccount` (name, tipo [efectivo/banco/tarjeta/digital/
  cuenta_cliente/cuenta_proveedor], saldo signed, currency "ARS").
- `PaymentMethod` (name, `financial_account_id` N:1, requiere_conciliacion).
- `AccountMovement` (financial_account_id, document_id?, payment_method_id?,
  transfer_id?, monto **signed**, tipo, fecha, fecha_acreditacion?,
  conciliado, user_id, created_at).
- `Transfer` (from_account_id, to_account_id, monto, fecha, descripcion,
  user_id). For internal account-to-account movements.

### Current-account ledgers (append-only)
- `CustomerAccountMovement` (customer_id, document_id, monto signed,
  created_at). Sum = `Customer.saldo`.
- `SupplierAccountMovement` (mirror).

## 7. Reserved future hooks (do not activate yet)

- `Document.cae`, `Document.cae_vto` — reserved for AFIP/ARCA electronic
  invoicing integration in a future phase. They must remain nullable and
  unused until that integration is implemented.
- 80mm thermal printing (ESC/POS) is **explicitly out of scope** until the POS
  UI is built. Do not add printing libs or endpoints for it now.
- Multi-store / multi-warehouse: schema today is mono-store; do not add
  store/warehouse foreign keys without first consulting the user.

## 8. Phase status (matches `plan.md` section C)

- [x] **Phase 0** — `AGENTS.md`, fix `deps.py:36` Py2 syntax, refactor
  `Page[T]` + `PaginationDep` with bounds. Done.
- [x] **Phase 1** — RBAC + `BusinessSettings` + admin tabs "General" and
  "Users and Roles".
- [x] **Phase 2** — Catalog (`Tax` + `product_tax`, `Product` with stock_min/max,
  `Category`, `UoM`, `Barcode`, attributes + variants with toggle, admin tab
  "Attributes" for variant attribute data).
- [x] **Phase 3** — Counterparties (`Customer` with limite=0→free +
  Consumidor Final seed, `Supplier` without limite) + Customers and Suppliers
  sections. `documento` = nullable, unique when present, CUIT/CUIL with mod-11
  DV only.
- [ ] **Phase 4a** — Document structure: seeded `DocumentType` (+ prefixes),
  `DocumentSequence` (`SELECT FOR UPDATE`), `Document` + `DocumentLine` (with
  `costo_unitario` snapshot) + `DocumentLineTax` + `DocumentTax` +
  `DocumentPayment`; creation; tax condition → A/B/C; discounts; hook points
  for phases 5/6/7.
- [ ] **Phase 4b** — Voiding total/partial (NC via `parent_document_id`);
  states `active`/`voided`.
- [ ] **Phase 4c** — Cotización→Factura 1 click via `parent_document_id`.
- [ ] **Phase 5** — Costs (`SupplierProduct`); purchase cost trigger.
- [ ] **Phase 6** — Stock ledger (`StockMovement`); configurable negative
  stock; cache reconciliation.
- [ ] **Phase 7** — Finance: `FinancialAccount`, `PaymentMethod` (N→1),
  `AccountMovement`, `Transfer`, card commission + deferred accreditation,
  current-account ledgers with atomic saldo UPDATE.
- [ ] **Phase 8** — Operational UX (Sales, Purchases, Stock, Catalog,
  Customers, Suppliers) + reports + HTML voucher with `window.print()`.
- [ ] **Phase 9** — i18n/es + Playwright E2E of critical flows + deploy.

## 9. Known issues / footnotes

- The Full Stack FastAPI Template historically shipped with
  `except InvalidTokenError, ValidationError:` (no parentheses) at
  `backend/app/api/deps.py`. It was a syntax error pre-3.14; the project now
  requires Python >=3.14, where PEP 758 makes the tuple form valid again. The
  canonical parenthesized form is kept anyway. Phase 0 note updated accordingly.
- The `db` fixture in `backend/tests/conftest.py` uses the **real** Postgres
  instance (no isolated test DB). Tests are non-parallel-safe by default. To
  run tests you must have the Postgres service up and migrations applied.
- PostgreSQL enum types persist across migrations: when a new table reuses an
  enum created by an older migration (e.g. `taxcondition`), reference it with
  `postgresql.ENUM(..., name=..., create_type=False)` in the migration (see
  `f962c8ec15e6`), otherwise the upgrade crashes with "type already exists".
- The frontend `ThemeProvider` is custom (not `next-themes`, even though the
  dependency is listed in `package.json`). Dark mode is the default.
- The template ships a `private` API router that is only loaded when
  `ENVIRONMENT=local`. It exposes an unauthenticated `POST /private/users/`
  endpoint intended for development only. Do not promote it to other envs.