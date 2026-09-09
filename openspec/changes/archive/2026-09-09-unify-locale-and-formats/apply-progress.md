# Apply Progress: Unify locale and derive number/date formats

## Completed

- Phase 1 (backend): RED test `test_number_format_setting_removed` (observed
  failure before the model change), removal of `NumberFormat` enum +
  `number_format` from `BusinessSettings`/`BusinessSettingsUpdate`/
  `BusinessSettingsPublic`, migration `41820b782d4f` (drops the column and the
  `numberformat` enum type; downgrade re-creates both with `server_default='EN'`),
  `alembic upgrade head` applied against the compose Postgres.
- Phase 2: `bash ./scripts/generate-client.sh` run; `number_format` absent from
  `types.gen.ts`/`schemas.gen.ts`.
- Phase 3 (frontend core): `i18n/locale.ts` added (locale enum + BCP-47 tags +
  `toLocale`); `i18n/index.tsx` rewritten (no localStorage; business
  `default_locale` is the single source; pre-load default `es`; context exposes
  derived `numberFormat` + business `timezone`; static locale mirror via
  `setStaticLocale`); `lib/format.ts` extended with null-safe static
  number/money helpers and `formatDate`/`formatDateTime`/`formatTime`
  (locale tag + business timezone); `LanguageSettings.tsx` removed together
  with its User Settings tab (superuser `slice(0, 2)` keeps the danger zone
  hidden from superusers); number-format control removed from
  `GeneralSettings.tsx`; unused i18n keys removed.
- Phase 4 (sweep): 53 files changed — all `numberFormat` prop plumbing removed
  (grep outside i18n/lib-format: zero matches); `reportFormat.money/qty/pct`
  delegate to the shared helpers; local `money`/date helpers in Documents,
  Sell, Reports, Admin replaced; all scattered `toLocaleString`/
  `toLocaleDateString` calls replaced with centralized static helpers
  (grep outside helpers/datePresets: zero matches).
- Phase 5 (validation):
  - `cd backend && bash scripts/test.sh` → 361 passed
  - `cd backend && bash scripts/lint.sh` (mypy/ty/ruff) → clean
  - `bash ./scripts/generate-client.sh` → regenerated + frontend lint clean
  - `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` → 0 errors
  - `cd frontend && bun run lint` → exit 0 (pre-existing Playwright
    `test-results` permission diagnostic only)
  - `cd frontend && bunx playwright test` → 121 passed, 0 failed
- Manual spot-check: not performed interactively (voucher print and sell
  screen under both locales) — left as a user smoke-test item.

## TDD Cycle Evidence

| Phase | RED | GREEN | TRIANGULATE |
|---|---|---|---|
| Backend model/migration | `test_number_format_setting_removed` failed (field still present) | 361 tests passed after removal + migration | Tests asserting settings round-trips still pass; E2E 121 green |

## Deviations from design

- `qty`/`pct` in `reportFormat.ts` keep their original rendering (plain
  `String(Number(...))` / `toFixed(2)`) — only `money` delegates to the static
  helpers; changing `qty` rendering was not part of the change.
- The design's "static helpers bound at module load" is implemented as a
  module-level mirror object in both `i18n/index.tsx` and `lib/format.ts`,
  synced by `LocaleProvider` on every render/effect — same behavior, simpler.
- The running backend container needed a rebuild (`docker compose build
  backend && docker compose up -d backend`) because the image embeds the code;
  the pre-existing container 500'd against the migrated DB during E2E setup.

## Remaining work

- User smoke-test: voucher print + sell screen money/date rendering under
  `es` and `en` (manual, recorded here).
- Parent-owned lifecycle: bounded review / delivery per ordinary repository
  policy (receipt-driven development is not enabled).
