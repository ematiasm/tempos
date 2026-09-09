# Proposal: Unify locale and derive number/date formats

## Intent

Make the business-level `default_locale` the single source of truth for UI
language, number formatting, and date/time formatting. Today these concerns are
split across two independent settings (`default_locale` and `number_format`),
the per-user language choice lives only in `localStorage`, and date formatting
is inconsistent (hardcoded `es-AR`, bare `toLocaleString()`, `en-US` in
`datePresets.ts`). This change removes `number_format`, removes the per-user
locale switch (business decision: one locale for the whole business), and
derives all formats from the resolved locale.

## Motivation

- Two settings that must be kept in sync manually (`default_locale` +
  `number_format`) is error-prone: a business can have Spanish UI with US
  number format.
- Date formatting is scattered and inconsistent across ~15 components
  (`toLocaleDateString("es-AR")` hardcodes, bare `toLocaleString()` calls,
  `en-US`-fixed parsing in `datePresets.ts`), so the locale setting does not
  currently control dates at all.
- The `number_format` plumbing (a prop passed through 47 frontend files) exists
  only because formats are not derived from the locale.
- Future multilingual expansion needs one clear extension point: adding a
  language = one i18n catalog file + one backend enum value.

## Scope

### In scope

- Backend: drop the `number_format` column from `BusinessSettings` (Alembic
  migration), remove it from the update/public schemas. `default_locale`
  (persisted values `es`/`en`) stays unchanged.
- Frontend: resolve a single locale from `BusinessSettings.default_locale`
  (`es` → `es-AR`, `en` → `en-US`); remove the `tempos.locale` localStorage key
  and the per-user language switch (`LanguageSettings.tsx`).
- Frontend: derive `NumberFormat` from the resolved locale instead of the
  settings payload; stop threading `numberFormat` props (47 files).
- Frontend: add centralized `formatDate` / `formatDateTime` / `formatTime`
  helpers (locale tag + business timezone) and replace the scattered date
  formatting calls, including aligning `datePresets.ts`.
- Keep the architecture ready for future locales: adding a language is a new
  react-intl catalog + one `LocalePreference` enum value + one mapping entry.

### Out of scope

- Per-user locale preference in the database (explicitly rejected in this
  change's decision round; may be a future change).
- Backend-side localization of error messages, emails, or documents (error
  `code`s continue to be translated by the frontend `handleError`).
- Renaming the persisted enum values `es`/`en` (domain vocabulary; only the
  frontend maps them to BCP-47 tags).
- New languages beyond Spanish and English.
- The business `timezone` setting's semantics (reused as-is for date rendering).

## Affected areas

- `backend/app/models.py` (BusinessSettings + update/public schemas),
  new Alembic migration, backend tests referencing `number_format`.
- `frontend/src/i18n/index.tsx` (LocaleProvider resolution), 
  `frontend/src/lib/format.ts` (format helpers), 
  `frontend/src/components/UserSettings/LanguageSettings.tsx` (removed),
  `frontend/src/components/Admin/GeneralSettings.tsx` (drop the number-format
  control), `frontend/src/components/Reports/datePresets.ts`, and the ~45
  components that consume `numberFormat` or format dates inline.
- Regenerated OpenAPI client (`scripts/generate-client.sh`) after the schema
  change.

## Risks

- Wide but mechanical frontend sweep (47 files touching `numberFormat`);
  typecheck (`tsc`) is the main safety net, plus E2E suite for critical flows.
- Removing the per-user switch changes existing behavior: users who chose
  English via localStorage will see the business default after this change.
  Accepted by decision (single business locale).
- Date-format changes alter rendered strings in tables/reports (visual diff
  only; no data change). Print vouchers render dates too — spot-check the
  voucher templates.

## Rollback

- Backend: the migration has a downgrade that re-adds `number_format` with its
  previous server default (`EN`); reverting the code commit restores the rest.
- Frontend: revert commit; no persisted frontend state other than the removed
  `tempos.locale` key (harmless if left behind in browsers).

## Success criteria

- `BusinessSettings` exposes no `number_format`; the API and regenerated client
  type-check cleanly.
- Changing `default_locale` in Admin → General switches UI language, number
  formatting, and date formatting everywhere after reload.
- No component receives a `numberFormat` prop; no hardcoded `es-AR`/`en-US`
  date formatting outside `format.ts`/`datePresets.ts`.
- `bash backend/scripts/test.sh`, `bash backend/scripts/lint.sh`,
  `cd frontend && bunx tsc -p tsconfig.build.json --noEmit`, and
  `cd frontend && bun run lint` all pass; Playwright E2E suite green.
