# Tasks: default-locale-en

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~230 (six frontend fallbacks ~10; spec delta ~40; backend test ~30; change artifacts ~150) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low
```

Reasoning: one behaviour change in the frontend, one spec delta and one test. Nothing to
chain.

Strict TDD is enabled (`openspec/config.yaml`). The fallback flip lives in frontend code
that has no unit-test harness — the repository's suites are backend pytest and Playwright —
so the change is covered by a backend test that locks the API default, by typecheck, build
and lint, and by the spec scenario. The Playwright suite pins `default_locale: "es"` itself
through the API before its specs run, so it is unaffected and does not need updating.

---

## Work Unit 1 — Default the locale to English

- [x] Regression lock: extend `backend/tests/api/routes/test_setup.py` so a `POST /setup`
      **without** `default_locale` asserts `body["default_locale"] == "en"`, which is the
      model default and the contract the frontend now relies on. RED is not applicable —
      the backend already answers `en`; this test exists to keep it that way.
      <!-- sdd-owner: implementation -->
- [x] Flip the runtime fallbacks to English in `frontend/src/i18n/locale.ts` (`toLocale`:
      anything that is not `es` resolves to `en`) and `frontend/src/lib/format.ts`
      (`toNumberFormat` and the default parameter of the money formatter), keeping their
      docstrings true. <!-- sdd-owner: implementation -->
- [x] Flip the initial values in `frontend/src/i18n/index.tsx`: the context default
      (`locale` and `numberFormat`), the module-level `staticLocaleRef` and the
      `IntlProvider` `defaultLocale`. <!-- sdd-owner: implementation -->
- [x] Flip the first-run prefill in `frontend/src/routes/setup.tsx` from `"es"` to `"en"`,
      leaving the `default_locale` selector and both `SelectItem`s in place.
      <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: confirm the wizard still renders the selector, that
      `AdminSettings.general.tsx`'s existing `?? "en"` fallback now agrees with the runtime,
      and that no other `"es"` literal acts as a locale fallback (the catalogs, the
      `localeEs` label and the `es` locale tag are data, not defaults).
      <!-- sdd-owner: implementation -->
- [x] Verify: `cd frontend && bunx tsc -p tsconfig.build.json --noEmit && bun run build &&
      bun run lint`, and `cd backend && uv run bash scripts/test.sh`.
      <!-- sdd-owner: implementation -->
- [x] Record the result in `apply-progress.md`. <!-- sdd-owner: implementation -->

## Parent-owned lifecycle

- [ ] Sync the delta into `openspec/specs/locale-and-formats/spec.md` and archive this
      change after verification. <!-- sdd-owner: parent -->
