# Proposal: Default the business locale to English

## Intent

The same setting has two different defaults, and the stricter one is not the one a new
install gets:

| Place | Default |
|---|---|
| `backend/app/models.py` `BusinessSettings.default_locale` | `EN` |
| Migration `b4e0259e8d9b` (`server_default`) | `'EN'` |
| `frontend/src/routes/setup.tsx:169` (first-run prefill) | `"es"` |
| `frontend/src/i18n/locale.ts:13` (`toLocale`) | anything not `"en"` becomes `"es"` |
| `frontend/src/i18n/index.tsx:66-67,75,119` (context, static mirror, `IntlProvider`) | `"es"` |
| `frontend/src/lib/format.ts:20,26` (number format) | `"es"` |
| `frontend/src/components/Admin/GeneralSettings.tsx:116` | `"en"` |

The backend already answers `en`; the frontend answers `es` at every point where a value
is missing, including the first-run wizard — which therefore renders in Spanish and
prefills Spanish before anyone has chosen anything. Number and date formats follow the
same fallback, so a fresh install also gets `es-AR` conventions.

**Decision, already taken by the user:** reconcile in `en`, the industry standard, keeping
the locale selector in the setup wizard so installing in Spanish costs one click.

## Agreed decisions (binding for spec)

1. **Default to `en` everywhere**: the runtime locale fallback, the number and date format
   fallback, the static mirror used by non-hook formatters, and the wizard prefill.
2. **The wizard keeps its selector.** English is the default, not the only choice.
3. **Existing installs are untouched.** `default_locale` is persisted per business, so this
   only changes the state before a business is configured and the value prefilled on first
   run. No data migration.
4. **The backend needs no change.** Its model default is already `EN`, and the setup API
   keeps accepting an omitted `default_locale`, which stores that default.
5. **No translation work.** Both catalogs are complete and identical in coverage (1173 keys
   each), so English is already fully rendered.

## Scope

### In Scope

- Six frontend fallbacks, one of them the wizard prefill.
- A `locale-and-formats` delta that states the pre-configuration behaviour and restores the
  per-session scenario that describes a stored choice governing every session.
- A backend test that locks the API default: `POST /setup` without `default_locale` must
  answer `en`.

### Out of Scope

- The zod messages hardcoded in Spanish (`setup.tsx`, other forms). They are a copy
  decision, not a locale fallback, and translating them is its own change.
- Any change to existing installations, and any data migration.
- The user-facing language of documents, vouchers or seeds: domain vocabulary stays as it
  is.

## Capabilities

> Contract with sdd-spec. Existing specs under `openspec/specs/`: twelve capabilities. Only
> `locale-and-formats` is affected: it owns locale resolution and format derivation.

### Modified Capabilities

- `locale-and-formats`: MODIFIED `Single business locale` — adds the behaviour for the
  state before a locale is configured, and restores the scenario that the stored choice
  governs every session. This is the only spec change; nothing else in the capability moves.

## Risks

| Risk | Mitigation |
|------|-----------|
| Existing installs could flip language | They cannot: the value is persisted per business, and only the pre-configuration fallback and the prefill change |
| The wizard could render in a language the installer does not read | The selector stays and is prefilled, so one click switches the whole flow |
| An unknown locale value could silently become English | That is the intended default, and `toLocale` documents it: anything that is not `es` resolves to `en` |
| The frontend has no unit-test harness, so the fallback flip is not covered by tests | Stated as a finding: the automated coverage is the backend default test plus typecheck, build and lint; the E2E suite pins its own locale and is unaffected |

## Rollback

Reverting the six fallbacks restores the previous behaviour with no data implications. No
migration runs in either direction.

## Success Criteria

1. A database without `BusinessSettings` renders `en` everywhere, including the first-run
   wizard, and the wizard still offers both locales.
2. Completing the wizard with Spanish stores `es` and every subsequent screen renders in
   Spanish.
3. `POST /setup` without `default_locale` answers `en`.
4. Existing installations keep their stored locale.
5. `locale-and-formats` states the pre-configuration behaviour with a testable scenario.
