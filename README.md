# tempos

Retail / mixed-business management system for a single store, single warehouse
and single currency (ARS). Built on a full-stack template: FastAPI + SQLModel +
PostgreSQL backend, React 19 + TanStack Router + TanStack Query + shadcn/ui
frontend.

## Features

- RBAC (roles, permissions) and business settings.
- Catalog: products with variants, barcodes, attributes, taxes (IVA/IIBB),
  categories and units of measure.
- Customers and suppliers with current-account ledgers and credit limits.
- Unified documents: sales, purchases, quotes, credit/debit notes, stock
  adjustments, receipts — with Odoo-style numbering, voiding via mirror NCs
  and quote-to-invoice conversion.
- Costs: per-supplier cost history and a reference supplier that drives the
  product cost and sale price.
- Stock ledger (append-only) with negative-stock control.
- Finance: financial accounts, payment methods, transfers, card conciliation,
  account movements (append-only).
- Reports and HTML voucher printing via `window.print()`.
- i18n (Spanish default, English available) and Playwright E2E coverage.

## Documentation

- [`AGENTS.md`](./AGENTS.md) — operational guide and module map.
- [`CHANGELOG.md`](./CHANGELOG.md) — feature history per phase.
- [`docs/DEPLOY.md`](./docs/DEPLOY.md) — production deployment (DO VPS + Traefik).

## Requirements

- [Docker](https://www.docker.com/) with Docker Compose for the full stack.
- [uv](https://docs.astral.sh/uv/) for the backend (Python >=3.14).
- [Bun](https://bun.sh/) for the frontend.

## Local development

```bash
docker compose watch    # db, backend, frontend, traefik, adminer, mailcatcher
docker compose down -v  # teardown + wipe volumes
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000 (Swagger UI at `/docs`, ReDoc at `/redoc`)
- Traefik UI: http://localhost:8090
- Adminer: http://localhost:8080
- MailCatcher: http://localhost:1080

## Commands

Backend (from `backend/`):

```bash
uv sync                          # install/sync deps
uv run fastapi dev app/main.py   # local dev server
uv run alembic revision --autogenerate -m "..."   # new migration
uv run alembic upgrade head      # apply migrations
bash scripts/test.sh             # tests + coverage
bash scripts/lint.sh             # mypy + ty + ruff check + ruff format --check
bash scripts/format.sh           # ruff --fix + ruff format
```

Frontend (from `frontend/`):

```bash
bun install
bun run dev        # local dev server
bun run build      # typecheck (tsc) + Vite build
bun run lint       # biome
bunx playwright test   # E2E tests (requires the stack running)
```

After any backend OpenAPI-shape change, regenerate the frontend client:

```bash
bash ./scripts/generate-client.sh
```

## License

MIT
