# tempos — Testing

How the test suites are wired and the traps that cost time when they are forgotten.
The exact commands the project gates on are owned by `openspec/config.yaml` under
`testing:`; this document explains the model behind them.

## Backend: pytest against the real database

There is **no isolated test database**. The `db` fixture in `backend/tests/conftest.py`
is session-scoped and autouse, and it runs against the same Postgres the application
uses (the Compose `db` service), applying migrations and seeding the first superuser.

Two consequences:

- You need the database up and migrated to head (`docker compose up -d db`, then
  `cd backend && uv run alembic upgrade head`).
- **The suite is not parallel-safe.** Do not add `-n auto` or run two sessions at once.

### Cleanup model

Every test touches a shared database, so `conftest.py` keeps a `CLEANUP_MODELS` tuple
and a `_BASELINE` snapshot taken when the session starts:

- Rows that appeared during the session are deleted after each test, children before
  parents.
- Rows that already existed — seeds, and any data from real use of the dev database —
  are preserved.

Two mechanics support that promise:

- **Guarded tables.** The ledgers reject `DELETE` through the append-only trigger, so
  `_clean_test_data` disables user triggers for its own transaction with
  `SET LOCAL session_replication_role = replica`. The setting needs superuser (the suite
  connects as the Compose owner) and the cleanup's commit clears it before `init_db`
  runs. Do not replace this with `TRUNCATE`: it ignores the per-row baseline and would
  discard pre-existing ledger rows while their documents and products survived.
- **Pinning a row's timestamp.** Some assertions need a ledger row in a different
  business day. Use `tests/utils/ledger.py: pin_created_at` rather than assigning the
  field directly — it uses the same transaction-scoped escape and keeps the write
  explicit.

### The cash-session fixture

`open_cash_session` is autouse: a session is opened for each test because sales require
one. If a session is already `OPEN`, the fixture **closes the stray one and continues**
instead of failing. Strays appear whenever a test fails mid-transaction — its cleanup
never runs — and before this behaviour one failure cascaded into ten consecutive
`cash_session_already_open` errors.

If you ever see that error again, the fixture is not the cause; look for a test that
poisoned its session and left a row behind.

### Running it

```bash
cd backend
uv run bash scripts/test.sh                       # full suite + coverage
uv run pytest tests/api/routes/test_users.py -x    # one file, stop at the first failure
uv run bash scripts/lint.sh                        # mypy + ty (app) + ruff (app, tests)
uv run bash scripts/check-schema.sh                # alembic check: metadata vs DB
uv run bash scripts/format.sh                      # ruff --fix + ruff format
```

`check-schema.sh` needs a reachable database migrated to head; CI runs it right after
`scripts/prestart.sh`, so it compares a schema built from scratch by
`alembic upgrade head`.

## Traps

- **Scripts need `uv run`.** `bash scripts/test.sh` fails with `coverage: orden no
  encontrada` because the binaries are not on `PATH`; use `uv run bash scripts/test.sh`.
- **The unparenthesized `except`.** `backend/app/api/deps.py` uses
  `except InvalidTokenError, ValidationError:` — valid only from Python 3.14, where
  PEP 758 allows it. Ruff is configured with `target-version = "py314"` and treats that
  form as canonical, so `ruff format --check` **fails on the parenthesized version**.
  Do not "fix" it back.
- **`bun run lint` is check-only.** It can and should fail a validation run;
  `lint:fix` is the writer, and it is what the pre-commit hook and
  `scripts/generate-client.sh` call.
- **The E2E artifacts are excluded from the lint.** Playwright writes `test-results/` and
  `frontend/playwright/.auth/` next to the code. Both are gitignored and both are listed in
  `frontend/biome.json` under `files.includes`, so `bun run lint` does not scan them. If the
  lint ever reports a file nobody edited, check whether Playwright grew a new output path and
  extend that list — it is the same shape as the existing `!**/playwright-report` entry.
- **Disk fills during E2E rebuilds.** `docker builder prune` frees the space.

## Frontend unit tests

```bash
cd frontend
bun run test:unit            # Bun's runner over src/**/*.test.ts
bun run test:unit --watch    # watch mode
```

Unit tests cover the pure logic — number and date formatting, locale resolution, payment
composition, the price chain, the CSV export, the report cells — colocated with the code they
test and scoped by `frontend/bunfig.toml`. That `[test] root = "src"` matters: Bun also
matches `*.spec.ts`, so without it the runner loads the Playwright suite and fails on its
imports. `@types/bun` is a dev dependency because the `tsc` gate typechecks everything under
`src/`, tests included.

There is no DOM environment by design: component and flow behaviour stays with Playwright.

The command typechecks the suite before running it (`tsc -p tsconfig.json --noEmit`), and
that is deliberate: `tsconfig.build.json` excludes `tests/**`, so the build gate never saw
the Playwright specs. Nothing did, which is how they carried real type errors until this was
wired up. `tests/**` has to stay type-clean now, and the same command enforces it locally.

## Frontend and E2E

```bash
cd frontend
bunx tsc -p tsconfig.build.json --noEmit   # typecheck
bun run lint                               # biome, check-only
bun run build                              # tsc + Vite build
bunx playwright test                       # E2E, requires the running stack
bunx playwright test --ui                  # interactive
```

Playwright specs run against the Compose stack and are written against the **Spanish
UI**: `tests/auth.setup.ts` pins `default_locale: "es"` through the API before the specs
run, which is why the E2E suite is unaffected by changes to the frontend's locale
fallback. Any new user-facing string must exist in both catalogs.

**Money in the suite is es-AR.** The suite pins `default_locale: "es"`, so an amount renders
with a dot for thousands and a comma for decimals. Assert that shape, not the US one: a stale
assertion expecting `1,234.50` once matched only above a thousand, where a dot happens to
appear as a thousands separator, and failed below it. It read as flakiness and was really an
assertion coupled to the amount.

## What CI runs

`test-backend` (the backend suite), `test-docker-compose` (the stack comes up),
`pre-commit` (hooks over the diff, including `typos`, `ruff`, `mypy`, `ty` and the client
generation check), `test-unit` (the frontend unit tests: seconds, no services),
`test-playwright` sharded four ways with the `changes` job skipping it for documentation-only
diffs, and `zizmor` over the workflows.

`check-labels` requires **exactly one** of `breaking`, `security`, `feature`, `bug`,
`refactor`, `upgrade`, `docs`, `lang-all`, `internal`. It reads the labels through the API
after the `labeler` job runs, because the event payload predates the labels that job adds,
and it is a **required check** on `main`: a pull request without exactly one type label
cannot merge. It replaced `agilepathway/label-checker`, whose pinned release could no longer
build its own image.
