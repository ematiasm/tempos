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
- **E2E artifacts break the local lint.** Playwright writes `frontend/test-results/`
  and `frontend/playwright/.auth/`. They are gitignored, but `biome check ./` still
  scans them, so `bun run lint` fails right after an E2E run with a formatting error in
  files nobody edited. Remove them, or run the lint before the E2E suite.
- **Disk fills during E2E rebuilds.** `docker builder prune` frees the space.

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

Known flake: `tests/reports.spec.ts` › `Daily sales shows today's sales` fails
intermittently in CI shard 2 with the total row missing, on `main` as well. It does not
reproduce locally, even with the browser pinned to UTC. It is tracked separately; when
it fails, check whether it is that spec before assuming a regression.

## What CI runs

`test-backend` (the backend suite), `test-docker-compose` (the stack comes up),
`pre-commit` (hooks over the diff, including `typos`, `ruff`, `mypy`, `ty` and the client
generation check), `test-playwright` sharded four ways with the `changes` job skipping it
for documentation-only diffs, and `zizmor` over the workflows. `check-labels` currently
fails for every pull request because the pinned `agilepathway/label-checker` action
cannot build its own image any more (an expired `bullseye-security` repository breaks its
`apt-get update`); the label requirement it enforces — one of `breaking`, `security`,
`feature`, `bug`, `refactor`, `upgrade`, `docs`, `lang-all`, `internal` — still applies
by convention.
