# Verify Report: unify-locale-and-formats

**Status: PASS** — 2026-09-09 (verification executed inline after the sdd-verify
subagent failed without output; all checks below were observed directly).

## Spec coverage

| Requirement | Evidence | Result |
|---|---|---|
| Single business locale | `tempos.locale`/`LOCALE_KEY` grep: 0 matches; `LanguageSettings.tsx` removed; User Settings has no language tab; `LocaleProvider` resolves from `settings.default_locale` (`frontend/src/i18n/index.tsx:90-97`) | PASS |
| Formats derived from the locale | `number_format` grep in backend: 0; in regenerated client: 0; `GeneralSettings.tsx` has no number-format control; `lib/format.ts` derives via `LOCALE_TAGS` (`es`→`es-AR`, `en`→`en-US`) | PASS |
| Centralized formatting helpers | `numberFormat` occurrences outside i18n/`lib/format.ts`/client: 0; scattered `toLocale*` calls outside helpers/`datePresets.ts`: 0; hardcoded `"es-AR"`/`"en-US"` in component formatting: 0 | PASS |
| Locale change propagation | `GeneralSettings` PATCH sends `default_locale`; `LocaleProvider` effect applies it on settings change; admin E2E flow green | PASS |
| Extensible locale enumeration | Adding a language = catalog file + `LocalePreference` enum value + `LOCALE_TAGS`/`locales` entry; documented in design (D6) | PASS |

## Task completion

- `tasks.md`: 15/15 implementation checkboxes `- [x]`; 2/2 parent-owned
  checkboxes `- [x]`. No unchecked `- [ ]` lines remain.

## Validation commands (observed)

| Command | Result |
|---|---|
| `cd backend && uv run bash scripts/test.sh` | 361 passed |
| `cd backend && uv run bash scripts/lint.sh` | mypy: Success (48 files); ty: All checks passed; ruff check/format: clean |
| `bash ./scripts/generate-client.sh` (earlier this session) | client regenerated without `number_format` |
| `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` | 0 errors |
| `cd frontend && bun run lint` | exit 0 (pre-existing Playwright `test-results` permission diagnostic only) |
| `cd frontend && bunx playwright test` | 125 passed, 0 failed |

## Strict TDD compliance

- RED: `test_number_format_setting_removed` observed failing before the model
  change (recorded in apply-progress.md).
- GREEN: same test passes after removal + migration; full suite green.
- TRIANGULATION: settings round-trip tests and 125 E2E specs cover the
  behavior change; no tautological or smoke-only tests were added.
- Assertion quality: the added test asserts absence of the `number_format`
  key in the API payload — behavioral, not implementation-detail.

## Review workload findings

- Forecast was High (>400 lines); implementation delivered as 3 chained
  work-unit commits (backend → frontend core → sweep) as resolved by the
  user; sweep stayed within the declared scope (53 files, no unrelated
  refactors — `qty`/`pct` rendering intentionally preserved).

## Blockers

None.

## Notes (non-blocking)

- Manual visual smoke-test (voucher print + sell screen under both locales)
  was not performed in-session; left recorded as a user item in
  apply-progress.md. It does not block archive (rendering covered by E2E).
- The `sdd-verify` subagent run failed without actionable output; this report
  was produced by the orchestrator executing the same checks directly.
