# tempos — Architecture

Reference for how the repository is laid out and why. Behaviour lives in
`openspec/specs/`; this document is orientation, not contract.

## Stack

### Backend

- **FastAPI** + **SQLModel** (ORM) + **Pydantic v2** + **pydantic-settings** +
  **Alembic** + **PostgreSQL** (psycopg). Python `>=3.14,<4.0`.
- Type checking `mypy --strict` + `ty check`; formatting and linting `ruff`.
- Pre-commit hooks run through `prek`, a modern pre-commit alternative.
- Auth is an OAuth2 password flow with stateless JWTs (HS256), 8-day expiry.
- Tests run against the **real** Postgres instance — see [TESTING.md](./TESTING.md).
- Prefer Pydantic v2 syntax: `model_validate`, `model_dump(exclude_unset=...)`,
  `@model_validator`, `Annotated[...]`, generic `class Foo[T]`.

### Frontend

- **React 19** + **Vite** + **TanStack Router** (file-based, auto code-split) +
  **TanStack Query** + **TanStack Table** + **shadcn/ui** (new-york style, Tailwind v4)
  + **react-hook-form** + **zod** + **sonner**.
- The API client is generated with `@hey-api/openapi-ts` (axios underneath).
- There is no global state store: remote state lives in React Query, and theme and auth
  live in a custom `ThemeProvider` plus `localStorage`.
- i18n uses react-intl (`src/i18n/`) with `es` and `en` catalogs, resolved from the
  business default locale; backend error `code`s are mapped in `handleError`.

## Where things live

### Backend (`backend/app/`)

| Concern | Location | Notes |
|---|---|---|
| SQLModel tables + API schemas | `app/models.py` | Single file today; new tables are added here |
| CRUD functions | `app/crud.py` | Domain CRUD: documents, voiding, receipts, ledgers |
| FastAPI app + lifespan + CORS | `app/main.py` | |
| Aggregated API router | `app/api/main.py` | Include new routers here |
| HTTP dependencies | `app/api/deps.py` | `SessionDep`, `CurrentUser`, `PaginationDep`, `require_permissions` |
| Route modules | `app/api/routes/` | One file per resource |
| Settings | `app/core/config.py` | `pydantic-settings`; `.env` is read from the repo root |
| Security | `app/core/security.py` | Argon2 + bcrypt hashers |
| DB engine + first-superuser seed | `app/core/db.py` | `init_db(session)` seeds the superuser |
| Initial-data entrypoint | `app/initial_data.py` | Called by `scripts/prestart.sh` |
| Alembic env + revisions | `app/alembic/` | `env.py`, `versions/` |
| Email templates | `app/email-templates/` | `src/*.mjml` → `build/*.html` |
| Tests | `backend/tests/` | `conftest.py` fixtures plus per-area folders |
| Helper scripts | `backend/scripts/` | `prestart.sh`, `test.sh`, `tests-start.sh`, `lint.sh`, `format.sh`, `check-schema.sh` |

### Frontend (`frontend/src/`)

| Concern | Location | Notes |
|---|---|---|
| File-based routes | `src/routes/` | **Do not edit `routeTree.gen.ts`** — Vite generates it |
| Layout + auth guard | `src/routes/_layout.tsx` | |
| Admin panel | `src/routes/_layout/admin.tsx` | Tabs: General, Users and Roles, Categories, Units, Taxes, Attributes, Document Types, Finance, Backups |
| Settings | `src/routes/_layout/settings.tsx` | The reference pattern for adding admin tabs |
| Finance section | `src/routes/_layout/finance.tsx` | Account cards, transfers, transfer history |
| Sidebar config | `src/components/Sidebar/AppSidebar.tsx` | Add nav items in `baseItems` (or the superuser branch) |
| shadcn/ui primitives | `src/components/ui/` | Already present: button, dialog, form, input, select, table, tabs, sonner, dropdown-menu. Add more with `npx shadcn@latest add switch textarea ...` |
| Domain components | `src/components/{Admin,Customers,Documents,Finance,Payments,Products,Reports,Sell,Suppliers}/` | Per-domain folders with `Add*`, `Edit*`, `Delete*`, `columns.tsx`, `*ActionsMenu.tsx` |
| Generic DataTable | `src/components/Common/DataTable.tsx` | TanStack Table with client-side pagination |
| Auth logic | `src/hooks/useAuth.ts` | Token in `localStorage["access_token"]` |
| Toast helpers | `src/hooks/useCustomToast.ts` | `showSuccessToast` / `showErrorToast` |
| Generated API client | `src/client/` | `sdk.gen.ts`, `types.gen.ts`, `core/`. **Never edit by hand** |
| Type utilities | `src/lib/utils.ts` | `cn()` (clsx + tailwind-merge) |
| Shared helpers | `src/lib/permissions.ts`, `src/lib/format.ts` | Permission checks, money and date formatting |
| Theme provider | `src/components/theme-provider.tsx` | Custom, not `next-themes`, even though the dependency is installed. Dark mode is the default |

### Root

| Concern | Location |
|---|---|
| Agent guide (index) | `AGENTS.md` |
| Changelog | `CHANGELOG.md` |
| Compose stack | `compose.yml`, `compose.override.yml`, `compose.traefik.yml` |
| Per-environment config | `.env` (read by Compose and `app/core/config.py`) |
| Production config example | `.env.production.example` |
| Pre-commit config | `.pre-commit-config.yaml` (uses `prek`) |
| Helper scripts | `scripts/` — `generate-client.sh`, `deploy.sh`, `test.sh`, `test-local.sh`, `add_latest_release_date.py` |
| Deployment guide | `docs/DEPLOY.md` |
| Reference docs | `docs/ARCHITECTURE.md` (this file), `docs/TESTING.md` |

## Development commands

```bash
# One-time setup
cd backend && uv sync && cd ..
cd frontend && bun install && cd ..

# Full local stack: db, backend, frontend, traefik, adminer, mailcatcher
docker compose watch
docker compose down -v          # teardown and wipe volumes

# Backend, from backend/
uv run fastapi dev app/main.py                   # dev server without Docker
uv run alembic revision --autogenerate -m "..."  # create a migration
uv run alembic upgrade head                      # apply migrations

# Frontend, from frontend/
bun run dev                  # dev server without Docker
bun run build                # tsc + Vite build
bun run lint                 # biome, check-only
bunx playwright test         # E2E, requires the stack running

# Regenerate the OpenAPI client, from the repo root (after any OpenAPI-shape change)
bash ./scripts/generate-client.sh
```

Test, lint and schema commands live in [TESTING.md](./TESTING.md), and the exact gate
commands are owned by `openspec/config.yaml` under `testing:`.

Local URLs: frontend <http://localhost:5173>, backend <http://localhost:8000>,
Swagger <http://localhost:8000/docs>, ReDoc <http://localhost:8000/redoc>,
Adminer <http://localhost:8080>, Traefik <http://localhost:8090>,
MailCatcher <http://localhost:1080>.

**The backend container runs code baked into its image** — Compose mounts only
`/backups` and `/uploads`, not the source. A local edit does not reach the running
container until you rebuild it:

```bash
docker compose build backend && docker compose up -d backend
```

That matters as soon as a migration changes the schema: a stale image against an
already-migrated database fails at insert time with a missing-column error.

## Database invariants and why they are declared in metadata

Three invariants are enforced by the database rather than by convention:

1. **Append-only ledgers.** `stockmovement`, `accountmovement`,
   `customeraccountmovement`, `supplieraccountmovement`, `transfer` and the
   `conciliation` log reject `UPDATE` and `DELETE` through a `BEFORE UPDATE OR DELETE`
   trigger (`1809708fd773`, extended by `9337de9c4513`). Corrections are new
   opposite-sign rows produced by the reversing document.
2. **One open cash session.** A partial unique index, declared in `app/models.py`.
3. **Stock levels coherent per product.** A check constraint, declared in `app/models.py`.

Alembic autogenerate does **not** reflect triggers, and `app/alembic/env.py` declares no
custom comparators, so `alembic check` cannot see the append-only guard at all. That is
exactly how `d61ddf38636a` dropped the partial unique index and the check constraint and
left them missing for eleven revisions. Consequences to keep in mind:

- Anything that must be lost-proof belongs in SQLModel metadata, where
  `bash backend/scripts/check-schema.sh` (`alembic check`) protects it.
- The trigger cannot live in metadata, so it is protected by a test instead:
  `tests/api/routes/test_ledger_immutability.py` asserts its presence in `pg_trigger`
  for every protected table. Do not remove that test.

## Migration traps

- **Read every generated migration before applying it.** An autogenerated revision can
  carry an unrelated `drop_*` operation; leaving it in is how the invariants above went
  missing.
- **PostgreSQL enum types persist.** When a new table reuses an enum created by an older
  migration, reference it with `postgresql.ENUM(..., name=..., create_type=False)`, as
  `f962c8ec15e6` does, or the upgrade fails with "type already exists".
- **Hand-written migrations are the house style for database objects Alembic cannot
  express.** Follow `39c9148ae5e4`: a docstring that explains the loss it prevents,
  `CREATE OR REPLACE` where the object may already exist, an explicit `downgrade()` that
  touches no data, and data backfills that refuse to run when existing rows make the
  object impossible to create.

## What comes from the upstream template

tempos is forked from `fastapi/full-stack-fastapi-template`. Extend it instead of
refactoring it, and treat these as template-provided rather than tempos domain:

- **Backups** (`Backup`, `BackupSchedule`, `app/core/backup.py`, `restore_worker.py`).
  Functional and exposed under the admin Backups tab; the detached worker exists so a
  uvicorn restart cannot kill an in-flight dump.
- **The `private` API router**, loaded only when `ENVIRONMENT=local`. It exposes an
  unauthenticated `POST /private/users/` for development. Never promote it to other
  environments.
- **`ThemeProvider`**, custom rather than `next-themes`.
- The dev `.env` is tracked on purpose (Compose and CI read it); production secrets live
  only on the server and `.env.production` stays ignored.
