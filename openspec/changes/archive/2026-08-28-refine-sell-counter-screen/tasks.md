# Tasks: refine-sell-counter-screen

Strict TDD active (`openspec/config.yaml`: `strict_tdd: true`, `apply.tdd: true`). Every behavioral task is RED (failing test, correct code) → GREEN (minimal implementation). Slice numbers = design `## Commit Slicing` (9 slices = 9 commit groups; 1:1 kept — merging 5+7 was evaluated and declined: email backend and payments UX share no review context). Backend tests run against real Postgres (docker db up, non-parallel-safe).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,400 (additions+deletions; backend+frontend incl. tests; generated client excluded) |
| 400-line budget risk | High |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 9 work units = design slices 1–9; frontend order 6 → 7 → 8 → 9 |
| Delivery strategy | single-pr |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: High
Decision: forecast exceeds both the 400 and 800 budgets under `single-pr` — before apply, the maintainer must approve `size:exception` for the single PR or switch to chained slices (design slices 1–9 are chain-ready stacked units).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 (S1) | Search CASE tiers + `uom` payload | PR1/c1 | `cd backend && uv run pytest tests/api/routes/test_products.py -x` | `GET /products/search` with barcode/name fixtures | revert products.py, models.py, test additions |
| 2 (S2) | Payment validations + favor contract | c2 | `uv run pytest tests/api/routes/test_documents.py -x` | `POST /documents` overpay compositions | revert crud validations + tests |
| 3 (S3) | Settings print fields (M2) | c3 | `uv run pytest tests/api/routes/test_business_settings.py -x` | settings read/PATCH round-trip | `alembic downgrade -1` + revert models/tests |
| 4 (S4) | Document.notes (M1) + PATCH | c4 | `uv run pytest tests/api/routes/test_document_notes.py -x` | create/read/PATCH notes via API | `alembic downgrade -1` + revert |
| 5 (S5) | Document email + email-status | c5 | `uv run pytest tests/api/routes/test_document_email.py -x` | SMTP on/off/fail (dev/MailCatcher) | revert route + template + seed |
| 6 (S6) | /sell mechanical extraction | c6 | `cd frontend && bunx tsc -p tsconfig.build.json --noEmit && bun run lint` | `bunx playwright test tests/sell.spec.ts` (green, zero behavior change) | revert new Sell/* files + sell.tsx rewrite |
| 7 (S7) | Quick/split payment UX + gate | c7 | `bunx playwright test tests/sell.spec.ts -g "payment"` | /sell split + shortcut flows vs real backend | revert Quick/Split components + wiring |
| 8 (S8) | Search nav + qty modal + gate UI | c8 | `bunx playwright test tests/sell.spec.ts -g "search|quantity"` | scanner-like keyboard flows | revert ProductSearch mods + QuantityModal |
| 9 (S9) | Post-sale + print profiles + admin tab | c9 | `bunx playwright test tests/sell.spec.ts tests/admin.spec.ts` | print preview both profiles; admin save | revert PostSale/VoucherPrint/PrintingSettings/css |

## Slice 1 — Backend product search · `feat(products)` (product-search)

- [x] 1.1 RED `backend/tests/api/routes/test_products.py`: exact barcode beats exact-name match; exact name beats partial; variant barcode "888000000002" returns parent exposing that variant (resolvable); items carry `uom` (name/abbreviation/decimal_places). Run → fails (today: name order only, no `uom`).
- [x] 1.2 GREEN `backend/app/api/routes/products.py`: SQL CASE tier ordering (tier 0 exact barcode product|variant, tier 1 exact name ci, tier 2 partial; name order within tiers) + `selectinload(Product.uom)`; `backend/app/models.py`: `ProductPublic.uom: UoMPublic`. Verify: 1.1 green.
- [x] 1.3 Client regen (OpenAPI shape changed): `bash ./scripts/generate-client.sh` + `bunx tsc -p tsconfig.build.json --noEmit`.
- [x] 1.4 Slice gate: `bash backend/scripts/test.sh` + `bash backend/scripts/lint.sh` green.

## Slice 2 — Backend payment validations · `feat(documents)` (payments)

- [x] 2.1 RED `backend/tests/api/routes/test_documents.py`: cash 200 + credit 900 on total 1000 → 400 `credit_exceeds_total`, no document (today: silent truncation); debit 1100 on 1000 → 400 `payment_exceeds_total`, no document (today: silent credit-in-favor).
- [x] 2.2 Favor + cash-overpay contract test (GATE for Slice 7 — must be green before/with S7): total 1000, customer saldo −200, favor ON, post effective cash row 800 → `favor_monto` 200, saldo ends 0, vuelto 100 nowhere in ledger (UI-only). If pre-existing favor auto-coverage already passes it stands as the pinned contract; RED cases in this slice are 2.1.
- [x] 2.3 GREEN `backend/app/crud.py`: `credit_exceeds_total` (Σ marks_paid=false > total − Σ paid) + `payment_exceeds_total` (Σ non-cash paid > total) in the document transaction before hooks; full cash overpay stays permissive (regression assert: on-account semantics unchanged). No OpenAPI shape change → no regen.
- [x] 2.4 Regression guards, NOT RED (tests already exist — run only): `backend/tests/api/routes/test_cash_sessions.py` + `test_documents.py` prove `cash_session_required`, auto `cash_session_id` tagging, session-report inclusion stay green.

## Slice 3 — Backend print settings · `feat(settings)` (print-configuration)

- [x] 3.1 RED `backend/tests/api/routes/test_business_settings.py`: fresh settings → `default_print_format` "a4", `voucher_footer`/`voucher_legends` NULL; PATCH round-trip persists all three; footer >255 / legends >500 → 422.
- [x] 3.2 GREEN `backend/app/models.py`: `PrintFormat` enum `["a4","ticket80"]` default "a4" (D12); `voucher_footer` str|None max 255; `voucher_legends` str|None max 500 (newline-separated, D11); fields in `BusinessSettingsPublic`/`Update`.
- [x] 3.3 Migration M2 `Add business settings print fields` (scoped, English description) — SEPARATE from M1; `upgrade head` + verify `downgrade -1` reversible, ledger tables untouched.
- [x] 3.4 Client regen + tsc; slice gate: `test.sh` + `lint.sh` green.

## Slice 4 — Backend document notes · `feat(documents)` (post-sale-actions a)

- [x] 4.1 RED new `backend/tests/api/routes/test_document_notes.py`: create sale/purchase/quote with `notes` ≤500 → returned in read/detail on ALL types; >500 → 422; `PATCH /documents/{id}/notes` sets and clears; unknown id → 404 `document_not_found`; voided → 400 `document_not_editable`.
- [x] 4.2 GREEN `backend/app/models.py` `Document.notes` (str|None, max 500) + `DocumentCreate`/`DocumentPublic`; `crud.update_document_notes`; route `PATCH /documents/{id}/notes` (perm `document.create`, ACTIVE-only) in `backend/app/api/routes/documents.py`.
- [x] 4.3 Migration M1 `Add document notes` — independent of M2; `upgrade head` + verify `downgrade -1`.
- [x] 4.4 Client regen + tsc; slice gate: `test.sh` + `lint.sh` green.

## Slice 5 — Backend document email · `feat(documents)` (post-sale-actions b)

- [x] 5.1 RED new `backend/tests/api/routes/test_document_email.py`: POST auto-uses counterpart email; explicit `email_to` overrides; no address resolvable → 400 `document_email_missing_address`; `emails_enabled=false` → 400 `email_not_enabled`; SMTP raise → 400 `document_email_failed` and document unchanged; `GET /documents/email-status` → `{"emails_enabled": bool}`; 403 without `document.email`.
- [x] 5.2 GREEN `backend/app/api/routes/documents.py`: `POST /documents/{id}/email` (perm `document.email`; resolution body → counterpart email → error; `send_email` in try/except → BusinessError; NO DB write on path) + `GET /documents/email-status` (perm `document.email`, fail-closed, D7); `backend/app/core/db.py` seed `document.email`; `DocumentPublic.contraparte_email` resolved in `_attach_counterpart_names`.
- [x] 5.3 Template `backend/app/email-templates/src/document_voucher.mjml` → `build/` (mjml build like existing 4); context: identity, numero, fecha, lines, totals, payments, notes, footer/legends.
- [x] 5.4 Client regen + tsc; slice gate: `test.sh` + `lint.sh` green.

## Slice 6 — Frontend mechanical extraction · `refactor(sell)` (no behavior change)

- [x] 6.1 `frontend/src/components/Sell/paymentMath.ts` (pure: coverage, vuelto, credit/non-cash checks) + `useSellCart.ts` (cart add/update/remove, computeTotals, round2, reset) — logic moves, no JSX.
- [x] 6.2 Extract `CartTable.tsx` + `SellSidebar.tsx` (props down; includes notes input) from `sell.tsx` (~711 → ~120 lines); zero behavior change.
- [x] 6.3 `useOpenCashSession.ts` (`["cash-sessions-current"]`) + `useBusinessSettings.ts` (`["business-settings"]`); refactor `CashRegisterBar` onto the hook.
- [x] 6.4 Gate: tsc + biome + full `bunx playwright test tests/sell.spec.ts` green with specs unchanged (proves behavior-neutrality).

## Slice 7 — Frontend payment UX · `feat(sell)` (payments) — depends: S2, S6

- [x] 7.1 RED E2E `frontend/tests/sell.spec.ts`: quick `marks_paid=true` button → one-click sale, single full-total row; credit quick without customer → prompt, no doc; split 400+600 → two rows posted; uncovered remainder blocks; credit overflow blocked (`credit_exceeds_total` surfaced); non-cash overpay blocked; cash 1500/1000 → vuelto 500 shown and carried to post-sale; no open session → pay controls disabled + CashRegisterBar CTA; slip-through `cash_session_required` → toast via handleError, cart preserved.
- [x] 7.2 GREEN `QuickPaymentBar.tsx` (one button per method; credit → customer guard) + `SplitPaymentDialog.tsx` (N method×amount rows, running coverage vs `target = total − favorApplied`, use-credit toggle when saldo<0, live vuelto, confirm caps cash rows reverse-entry-order: `excess = paidSum + creditSum − target`) + gate wiring via `useOpenCashSession` + `sell.tsx` state (created doc + vuelto).
- [x] 7.3 i18n es+en `src/i18n/messages/{es,en}.ts`: `sell.quickPayment.*`, `sell.split.*`, `errors.credit_exceeds_total`, `errors.payment_exceeds_total` (reuse `sell.changeDue`).
- [x] 7.4 Gate: tsc + biome + payment E2E green.

## Slice 8 — Frontend search + quantity · `feat(sell)` (product-search, sell-screen) — depends: S1, S6

- [x] 8.1 RED E2E `frontend/tests/sell.spec.ts`: ArrowDown×2 → 3rd highlighted, no wrap at ends; Enter adds highlighted exactly once + clears input; Escape dismisses, cart unchanged; variant-barcode scan adds that variant (not base); decimal-UoM product opens QuantityModal — 0.25 accepted at dp=3, 0.125 rejected at dp=2; integer UoM auto-adds 1, no modal; scan-miss empty state (`search.noMatch`) persists — KEEP-AND-TEST, UI already exists (ProductSearch.tsx), no build; modal + gate prompt labels localized.
- [x] 8.2 GREEN `ProductSearch.tsx`: keyboard nav (↑↓ Enter no-wrap, Escape) + variant-barcode resolution (unique code → matched variant) + decimal-UoM intercept → new `QuantityModal.tsx` (precision validated against `uom.decimal_places`).
- [x] 8.3 i18n es+en: `sell.qtyModal.*`.
- [x] 8.4 Gate: tsc + biome + search/qty E2E green.

## Slice 9 — Post-sale + print + admin · `feat(documents/print)` — depends: S3–S6

- [x] 9.1 RED E2E `frontend/tests/sell.spec.ts` + `admin.spec.ts`: post-sale dialog shows summary + vuelto (no vuelto section when exact); note textarea PATCHes and voucher re-renders with note; new-sale resets state + refocuses search; print opens with settings default preselected, toggle switches profile; PDF hint shown; email hidden without `document.email`, disabled + tooltip when SMTP off; admin Printing tab persists format/footer/legends; both profiles honor settings (footer present when configured, nothing when NULL).
- [x] 9.2 GREEN `PostSaleDialog.tsx` (summary, vuelto, print/email/PDF/note/new-sale; email-status query perm-gated; auto-send when `contraparte_email` else inline prompt) + `PrintVoucherDialog` format state + `VoucherPrint.tsx` profiles (`data-print-format`, injected `@page` style, notes + footer/legends via `splitlines()`, NULL → nothing) + `index.css` profile blocks (CashSessionReportView unregressed) + `components/Admin/PrintingSettings.tsx` + `admin.tsx` Printing tab (react-hook-form + zod → existing PATCH).
- [x] 9.3 i18n es+en: `sell.postSale.*`, `admin.printing.*`, `errors.document_email_failed`, `errors.email_not_enabled`, `errors.document_email_missing_address`, `errors.document_not_editable`.
- [x] 9.4 Gate: tsc + biome + full Playwright suite green.

## Final Verification (after all slices)

- [x] 10.1 `bash backend/scripts/test.sh` + `bash backend/scripts/lint.sh`; frontend tsc + `bun run lint` + full `bunx playwright test`.
- [x] 10.2 Migrations M1 and M2 each independently reversible (`downgrade -1`), never combined.
- [x] 10.3 Spec coverage cross-check: 26 requirements / 52 scenarios (product-search 5, sell-screen 4, payments 6, post-sale-actions 7, print-configuration 4).

## Dependency Order

S1–S5 independent backend slices (any order; S2 before S7). S6 before S7/S8/S9. S7 needs S2 (favor contract test 2.2 is its gate). S8 needs S1 (`uom`). S9 needs S3–S5. Client regen rides inside S1/S3/S4/S5.
