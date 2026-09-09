# Design: Unify locale and derive number/date formats

## Decisions

### D1 — Keep persisted enum values `es`/`en`; map to BCP-47 in the frontend

`LocalePreference` values `es`/`en` are persisted data (domain vocabulary,
AGENTS.md section 2). Renaming them to `es-AR`/`en-US` would require a data
migration and would break the API contract for no functional gain. The backend
keeps storing `es`/`en`; the frontend owns a single mapping:

```ts
const LOCALE_TAGS: Record<Locale, string> = { es: "es-AR", en: "en-US" }
```

`NumberFormat` stays as a frontend-only type in `lib/format.ts`, but it is now
*derived* from the resolved locale rather than read from settings. The backend
enum `NumberFormat` is deleted along with the column.

### D2 — Business locale only; user switch removed

Decision from the change's question round: one locale for the whole business.
Consequences:

- `LocaleProvider` no longer reads/writes `localStorage["tempos.locale"]`.
  Resolution is: `settings.default_locale` (backend, `es`/`en`) → `"es"` while
  the settings query loads (avoids a flash for the Spanish-majority case; the
  business default replaces it once loaded).
- `LanguageSettings.tsx` and its User Settings tab entry are removed.
- Migration safety: existing browsers may still hold a `tempos.locale` key;
  it is simply ignored (no cleanup needed).

### D3 — Remove `number_format` end to end

- `models.py`: delete `NumberFormat` enum, `BusinessSettings.number_format`,
  the field in `BusinessSettingsUpdate` and `BusinessSettingsPublic`.
- Alembic migration: `op.drop_column("businesssettings", "number_format")`
  (upgrade) / re-add with `server_default="EN"` (downgrade, matching the
  original migration `b4e0259e8d9b`).
- Frontend: `GeneralSettings.tsx` loses the number-format control and its
  zod field; `types.gen.ts`/`sdk.gen.ts` regenerated.
- No backend logic reads `number_format` today (verified), so no behavioral
  code changes server-side.

### D4 — Centralized date helpers

Add to `lib/format.ts`:

```ts
function formatDate(value: string | Date, locale: Locale, timezone?: string): string
function formatDateTime(value: string | Date, locale: Locale, timezone?: string): string
function formatTime(value: string | Date, locale: Locale, timezone?: string): string
```

implemented with `Intl.DateTimeFormat(LOCALE_TAGS[locale], { timeZone, ... })`.
The business `timezone` comes from the same settings query the i18n context
already holds, so the context exposes `timezone` alongside `locale`.

Call-site policy:

- Table cells and sheets that already have `useLocale()` in scope use the
  context directly.
- Non-hook contexts (column definitions, `formatStatic`-style code) use
  context-free helpers bound at module load through a small
  `setStaticLocale()`/`getStaticLocale()` pair already implied by
  `formatStatic`; static date helpers mirror that pattern.
- `datePresets.ts` keeps `en-US` **only** for its internal
  part-parsing (`Intl.DateTimeFormat` used to extract date parts for range
  math — parsing, not display) but is refactored to take the display locale
  from the context where it renders labels.

### D5 — Prop-thread removal strategy

47 files reference `numberFormat`. The mechanical sweep:

1. Components under a React tree: replace `numberFormat` props with
   `useLocale().numberFormat` (kept as a derived convenience on the context) —
   minimal diff per file.
2. Pure helpers (`columns.tsx`, cell renderers): call
   `formatMoney`/`formatNumber`/date helpers bound to the static locale or,
   where the file is a React component module, the hook.
3. The context keeps exposing `numberFormat: "es" | "en"` so `format.ts`
   signatures stay stable during the sweep; it is computed, never stored.

### D6 — Future multilingual path (not implemented now)

Adding a language = (a) new catalog file in `i18n/messages/`, (b) new
`LocalePreference` enum value (Alembic enum type addition), (c) one entry in
`LOCALE_TAGS` + `locales` array, (d) General Settings selector option. No other
layer changes. The design forbids anything that would make step (c) insufficient.

## Data flow

```text
Admin → General: PATCH /business-settings { default_locale }
    → BusinessSettings row (es|en)
LocaleProvider (React Query: business-settings)
    → locale: "es" | "en"          (language + IntlProvider)
    → numberFormat (derived)       (formatNumber / formatMoney / money)
    → timezone (settings)          (formatDate / formatDateTime / formatTime)
```

## File changes

| Area | Files |
|---|---|
| Backend model | `backend/app/models.py` (3 removals + enum deletion) |
| Migration | `backend/app/alembic/versions/<new>_drop_number_format.py` |
| Backend tests | update any fixture/payload sending `number_format` |
| i18n core | `frontend/src/i18n/index.tsx` |
| Formatting | `frontend/src/lib/format.ts`, `frontend/src/components/Reports/datePresets.ts` |
| Removed | `frontend/src/components/UserSettings/LanguageSettings.tsx` (+ tab wiring) |
| Settings UI | `frontend/src/components/Admin/GeneralSettings.tsx` |
| Sweep | ~45 components under `src/components/` + a few routes replacing `numberFormat` props and inline date formatting |

## Test plan

- Backend (strict TDD): a route test asserting `number_format` is absent from
  `GET /business-settings` and that PATCH rejects/ignores it (RED first).
- Migration: upgrade + downgrade against the compose Postgres during apply.
- Frontend: `tsc --noEmit` is the sweep safety net; biome lint; targeted
  Playwright run of the admin settings flow and one report tab for locale
  rendering.
- Manual spot-check: voucher print (dates) and the sell screen (money) with
  both locales.

## Risks & mitigations

- **Wide sweep regression**: mitigated by keeping `format.ts` signatures stable
  (context-derived `numberFormat`), `tsc` gate, and E2E critical flows.
- **Static-locale staleness** (non-hook contexts): static helpers are only used
  for rendering after settings load; the locale changes at most on reload —
  same behavior as today's `formatStatic`.
- **Voucher print dates change format**: intentional (success criterion);
  flagged for manual review in tasks.
