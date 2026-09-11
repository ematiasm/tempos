# Apply Progress: default-locale-en

## Status

Complete and archived. Two commits in one pull request (#53), the canonical sync and the
archive performed alongside the verification report.

## Work Unit 1 — Default the locale to English

### TDD Cycle Evidence

| Task | RED | GREEN | TRIANGULATE / REFACTOR |
|------|-----|-------|------------------------|
| Backend default | Not applicable by design: the API already answered `en` (the model's default), so there is no failing behaviour to observe. The new test is a **regression lock** rather than a RED step, and it passed on the first run | `test_setup_without_default_locale_falls_back_to_english` → `8 passed` in `test_setup.py` | The setup endpoint keeps accepting an omitted field, which is what the frontend relies on |
| Frontend fallbacks | Not applicable: the frontend has no unit-test harness — the repository's suites are backend pytest and Playwright — and the Playwright suite pins `default_locale: "es"` itself, so it cannot observe the fallback. Recorded as a justified exception | Every flipped site is exercised by `bunx tsc`, `bun run build` and `bun run lint`, all clean | Audited every remaining `"es"` literal: the enum lists, the zod enums, the two `SelectItem`s, the locale tuple, the type union and the docstrings are data, not defaults. The wizard keeps `name="default_locale"` with both options |

### Files changed

| File | Change |
|------|--------|
| `frontend/src/i18n/locale.ts` | `toLocale` resolves anything that is not `es` to `en`, docstring updated |
| `frontend/src/lib/format.ts` | `numberFormatFor` mirrors the locale, and the module-level static mirror starts at `en` |
| `frontend/src/i18n/index.tsx` | Context default, `staticLocaleRef` and `IntlProvider defaultLocale` start at `en` |
| `frontend/src/routes/setup.tsx` | First-run prefill flipped to `en`; the selector and both options stay |
| `backend/tests/api/routes/test_setup.py` | New regression lock: `POST /setup` without `default_locale` answers `en` |
| `backend/app/models.py` | `BusinessLocalePublic`, the one-field schema the public read returns |
| `backend/app/api/routes/business_settings.py` | `GET /business-settings/locale`: no authentication, never creates the row |
| `frontend/src/i18n/index.tsx` | `LocaleProvider` follows that public value while the settings are unreadable |
| `backend/tests/api/routes/test_business_settings.py` | Three tests: unauthenticated read, fresh install answers the default without creating the row, stored value is reflected |
| `frontend/src/client/**` | Regenerated for the new endpoint |
| `openspec/changes/default-locale-en/**` | Proposal, spec delta and tasks |

### Commands and observed results

| Command | Result |
|---------|--------|
| `uv run pytest tests/api/routes/test_setup.py -q` | `8 passed` |
| `uv run pytest tests/api/routes/test_business_settings.py tests/api/routes/test_setup.py -q` | `32 passed`, including the three public-locale tests |
| `bash ./scripts/generate-client.sh` | the new endpoint appears; only the generated files changed |
| `uv run bash scripts/test.sh` | `381 passed` (three of four runs; the fourth showed the pre-existing `test_decomposition_adjust_last_percent_reconciles` flake, unrelated and tracked as issue #51) |
| `uv run bash scripts/lint.sh` | `Success: no issues found in 48 source files`; ty and ruff clean |
| `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` | clean |
| `cd frontend && bun run build` | succeeds |
| `cd frontend && bun run lint` | clean |

### Deviations from the proposal

One addition, discovered when the first Playwright run failed on three shards: the change
made the login screen English for a Spanish business. `LocaleProvider` wraps the whole
application, but the settings endpoint requires authentication, so the pre-authentication
screens could only ever use the fallback — which used to be `es` by accident and is now
`en` by policy. The user chose to expose the locale publicly rather than accept an English
login, so this unit gained `GET /business-settings/locale` and the provider wiring that
consumes it. Everything else went as planned.

### Remaining work

- Parent-owned: sync the `locale-and-formats` delta into `openspec/specs/` and archive the
  change after verification.

### Workload / PR boundary

Single pull request, ~230 changed lines including the change artifacts: low risk, no chain.

## Environment note

The test suite failed 381 times on the first attempt of this unit because the Docker stack
was down (`connection to server at "127.0.0.1", port 5432 failed: Connection refused`), not
because of the change. The stack was restarted with `docker compose up -d` and the data
volume was intact (19 documents, 27 products, 4 conciliation rows).
