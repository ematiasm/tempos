# Verify Report: default-locale-en

## Status

**PASS.** The frontend default is now English, the screens that cannot read the settings
resolve the business locale through a public endpoint, and the change states all of it in
`locale-and-formats`. No blockers.

## Spec coverage

The change modifies one requirement, `Single business locale`, now carrying five scenarios:

| Scenario | How it is verified |
|---|---|
| English before the business decides | The i18n fallback, the number-format derivation, the static mirror, the `IntlProvider` fallback and the wizard prefill all resolve to `en`; the wizard keeps its selector with both options. Audited by reading every `"es"` literal in the frontend: only data remains. |
| The stored choice governs every session | `LocaleProvider` still takes the stored value as the source of truth once the settings query resolves, and the authenticated E2E suite (which pins `es`) passes on three shards. |
| Choosing Spanish in the wizard takes one click | The setup form keeps `name="default_locale"` with the `es` and `en` options; the API stores whatever it receives. |
| The pre-authentication screens follow the configured locale | Covered by `GET /business-settings/locale` plus three tests: the read works without authentication, a fresh install answers `en` without creating the settings row, and a stored value is reflected. The Playwright suite confirms it end to end, since `auth.setup.ts` clicks a Spanish label on the login screen. |
| No per-user switch | Unchanged and untouched by this change. |

## Task completion

Nine implementation-owned tasks: **all checked**. One parent-owned action remains open by
design (the sync and archive, performed alongside this report).

## Strict TDD compliance

Strict TDD is active. The behaviour change lives in frontend fallbacks, which have no
unit-test harness in this repository — the suites are backend pytest and Playwright — so it
is recorded as a justified exception. The backend additions are **regression locks** rather
than RED steps, and that is stated where they are written:

- `POST /setup` without `default_locale` answers `en` (the model default the frontend relies on).
- `GET /business-settings/locale` is readable without authentication, answers the default on
  a fresh install without completing setup, and reflects a stored value.

The first Playwright run supplied the RED evidence this change did not have on paper: three
shards failed on `auth.setup.ts` clicking "Iniciar sesión", which is exactly the defect the
public endpoint fixes. It was observed, diagnosed and fixed before merge.

## Assertion quality

The new tests assert behaviour: a status code, the exact enum value, and — importantly — that
a fresh install does **not** create the settings row, which is the property that keeps the
public read from silently completing setup. No tautologies, no type-only assertions.

## Validation commands

| Command | Result |
|---|---|
| `uv run pytest tests/api/routes/test_business_settings.py tests/api/routes/test_setup.py -q` | `32 passed` |
| `uv run bash scripts/test.sh` | `384 passed` |
| `uv run bash scripts/lint.sh` | mypy clean (48 files), ty and ruff clean |
| `uv run bash scripts/check-schema.sh` | `No new upgrade operations detected` — the schema change is a response model, no migration |
| `cd frontend && bunx tsc -p tsconfig.build.json --noEmit` | clean |
| `cd frontend && bun run build` | succeeds |
| `cd frontend && bun run lint` | clean |
| `bash ./scripts/generate-client.sh` | regenerated for the new endpoint |
| CI on #53 | `pre-commit`, `test-backend` (91% coverage), `test-docker-compose`, `zizmor` and Playwright shards 1, 3 and 4 pass. Shard 2 fails only on the pre-existing `reports.spec.ts:79` flake (issue #38). `check-labels` fails on every pull request because its pinned action cannot build. |

## Review workload findings

One pull request, two commits: ~450 lines including the change artifacts and the regenerated
client, well under the budget. No chain needed.

## Findings carried forward

1. Five canonical specs are still delta-shaped and need normalising (`payments`,
   `post-sale-actions`, `print-configuration`, `product-search`, `sell-screen`).
2. `openspec/README.md` documents a `state.yaml` that no change has contained.
3. `check-labels` cannot pass on any pull request because its pinned action no longer builds.
4. `reports.spec.ts:79` fails intermittently on shard 2, on `main` as well (issue #38).
5. The line-tax rounding residual lands on an unordered "last" tax, making the stored
   breakdown non-deterministic (issue #51).
6. The frontend still has no unit-test harness, so fallback logic can only be verified
   through Playwright or by reading the code.

## Blockers

None.
