# Tasks: Unify locale and derive number/date formats

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500–800 (mostly mechanical prop removal across ~45 files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: backend (model + migration + tests + client regen) → PR 2: frontend core (i18n context, format.ts, GeneralSettings, remove LanguageSettings) → PR 3: mechanical sweep (numberFormat props + date helpers) |
| Delivery strategy | chained work-unit commits (resolved by user) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved: chained commits, 3 work units)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Phase 1 — Backend (RED → GREEN)

- [ ] Write a failing route test: `GET /business-settings` response contains no `number_format` key, and `BusinessSettingsUpdate` ignores it. Confirm RED. `backend/tests/api/routes/test_business_settings.py` (or existing settings test file). <!-- sdd-owner: implementation -->
- [ ] Remove `NumberFormat` enum, `BusinessSettings.number_format`, and the fields in `BusinessSettingsUpdate`/`BusinessSettingsPublic` in `backend/app/models.py`; run the targeted test to GREEN. <!-- sdd-owner: implementation -->
- [ ] Generate the Alembic migration dropping `businesssettings.number_format` (downgrade re-adds with `server_default='EN'`), hand-remove any spurious `uq_cashregistersession_single_open` drop, and `uv run alembic upgrade head`. <!-- sdd-owner: implementation -->
- [ ] Run `cd backend && bash scripts/test.sh` and `cd backend && bash scripts/lint.sh` — both green. <!-- sdd-owner: implementation -->

## Phase 2 — Client regeneration

- [ ] Run `bash ./scripts/generate-client.sh` and confirm `frontend/src/client/types.gen.ts` no longer contains `number_format`; fix any regenerated-type breakage in hand-written code. <!-- sdd-owner: implementation -->

## Phase 3 — Frontend core

- [ ] `frontend/src/i18n/index.tsx`: drop `localStorage` (`LOCALE_KEY`, `getLocale`, `hasStoredLocale`), resolve locale from `settings.default_locale` with `"es"` pre-load default, expose derived `numberFormat` and `timezone` on the context; add the `LOCALE_TAGS` map. <!-- sdd-owner: implementation -->
- [ ] `frontend/src/lib/format.ts`: add `formatDate`/`formatDateTime`/`formatTime` (Intl, locale tag + optional timezone) plus static-locale variants mirroring `formatStatic`. <!-- sdd-owner: implementation -->
- [ ] Remove `LanguageSettings.tsx` and its User Settings tab wiring; remove the number-format control + zod field from `GeneralSettings.tsx`. <!-- sdd-owner: implementation -->
- [ ] Refactor `datePresets.ts` to consume the resolved locale for displayed labels (keep `en-US` only for internal part-parsing if needed). <!-- sdd-owner: implementation -->

## Phase 4 — Mechanical sweep

- [ ] Replace every `numberFormat` prop with `useLocale().numberFormat` (React components) or shared-helper calls (pure renderers) across the ~45 files under `src/components/` and affected routes; grep must show zero `numberFormat` props remaining. <!-- sdd-owner: implementation -->
- [ ] Replace scattered date formatting (`toLocaleString()`, `toLocaleDateString("es-AR")`, etc.) with the centralized helpers; grep must show no hardcoded locale tags in formatting calls outside `format.ts`/`datePresets.ts`. <!-- sdd-owner: implementation -->

## Phase 5 — Validation

- [ ] `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` and `cd frontend && bun run lint` green. <!-- sdd-owner: implementation -->
- [ ] Full `bash backend/scripts/test.sh` + lint re-run green. <!-- sdd-owner: implementation -->
- [ ] Playwright E2E: `cd frontend && bunx playwright test` green (locale-dependent specs updated if they assert old formats). <!-- sdd-owner: implementation -->
- [ ] Manual spot-check (record in apply-progress): voucher print dates and sell-screen money rendering under both `es` and `en` locales. <!-- sdd-owner: implementation -->

## Parent-owned actions

- [x] Decide delivery shape — resolved: chained work-unit commits (backend → frontend core → sweep), validated per unit. <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review after apply completes. <!-- sdd-owner: parent -->
