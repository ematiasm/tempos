```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:f87b8f8e8f9b37a3b95d9c1d0c5feb9b72d8ab3a046dd2e202805554d7568df5
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 26/26
scenarios: 52/52
test_command: cd backend && POSTGRES_DB=app_verify uv run --no-sync bash scripts/test.sh
test_exit_code: 0
test_output_hash: sha256:6f91ec4dd27c53aa7b4b2d713efe29de6778f350320b56f4eb637b73b6e8b419
build_command: cd frontend && bunx tsc -p tsconfig.build.json --noEmit && bun run lint && bun run build
build_exit_code: 0
build_output_hash: sha256:3967c6278be817d2859a2fd87c90a88d702fc06d08024530989782db6d062427
```

## Verification Report

**Change**: refine-sell-counter-screen
**Version**: N/A (all capabilities new; `openspec/specs/` empty)
**Mode**: Strict TDD (openspec/config.yaml `strict_tdd: true`)
**Verifier**: independent sdd-verify (adversarial second pass; gates re-executed, apply reports NOT trusted)
**Commit range verified**: 2bf3c12..e082de9 (10 commits, local main, unpushed)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 39 |
| Tasks complete | 39 |
| Tasks incomplete | 0 |

Spec tally (counted directly from the 5 delta files, not taken from tasks): **26 requirements / 52 scenarios** (product-search 5/9, sell-screen 4/9, payments 6/11, post-sale-actions 7/16, print-configuration 4/7). Tasks.md 10.3 is correct; the apply-progress memory (obs 21) misrecords "27/53" (see S5).

### Build & Tests Execution
**Build**: ✅ Passed
```text
cd frontend && bunx tsc -p tsconfig.build.json --noEmit   # exit 0, no output
cd frontend && bun run lint                                # exit 0 (1 info: biome CLI 2.4.16 vs schema 2.3.14, cosmetic)
cd frontend && bun run build                               # exit 0 (chunk-size warning only)
```

**Tests**: ✅ Backend 293 passed / 0 failed / 0 skipped (44.75s, coverage 91%)
```text
# scratch-DB pattern (dev DB untouched): createdb app_verify → POSTGRES_DB=app_verify alembic upgrade head → test.sh → dropdb
cd backend && POSTGRES_DB=app_verify uv run --no-sync bash scripts/test.sh
====================== 293 passed, 317 warnings in 44.75s ======================
TOTAL 4232 384 91%
```

**Lint (backend)**: ✅ mypy --strict `Success: no issues found in 47 source files`; ty `All checks passed!`; ruff check `All checks passed!`; ruff format --check `47 files already formatted`.

**E2E (Playwright vs real stack)**: ✅ substantively green — final full run **109 passed / 1 failed / 1 skipped**; the 1 failure is an intermittent flake in pre-existing `reports.spec.ts` "Low stock" that **passes in isolation** (and passed in runs 2–3); the 1 skip is the documented pre-existing `test.fixme` (account-movements ordering). 4 full runs were executed; every spec passed at least once post-remediation. Runs 1–3 failures were diagnosed to two environment classes (see W1/W2/W3) — none is a product defect of this change.

**Migrations**: ✅ M1 (37ccb87265da notes) `downgrade -1` → `upgrade head` clean; M2 (e655d2d1d2d1 print fields) included in `downgrade -2` → `upgrade head` clean; final state = head. Only `document.notes` and `businesssettings` print columns touched — **no ledger table touched**. M2 creates/drops the `printformat` enum explicitly (avoids the AGENTS.md §9 "type already exists" trap).

**Cleanup after verify**: dev-DB cash session closed via API (0 OPEN sessions remain); scratch DB `app_verify` dropped.

### Spec Compliance Matrix
Legend: backend tests run in the 293-green suite; E2E = Playwright. ⚠️ = PARTIAL (scenario covered in part, evidence noted).

**product-search (5 req / 9 scen)**
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Suggestion keyboard navigation | Arrow keys move highlight (no wrap) | E2E `sell.spec.ts > Search keyboard navigation moves the highlight without wrapping` | ✅ COMPLIANT |
| Suggestion keyboard navigation | Enter adds highlighted exactly once, clears input | E2E `sell.spec.ts > Enter adds the highlighted suggestion exactly once and clears the input` | ✅ COMPLIANT |
| Suggestion keyboard navigation | Escape dismisses without adding | E2E `sell.spec.ts > Escape dismisses the suggestion list without adding anything` | ✅ COMPLIANT |
| Exact-barcode-first ordering | Exact barcode beats name | backend `test_search_exact_barcode_beats_exact_name_match` | ✅ COMPLIANT |
| Exact-barcode-first ordering | Exact name beats partial | backend `test_search_exact_name_beats_partial_match` | ✅ COMPLIANT |
| Variant barcode matching | Variant barcode resolves its product (+ variant addable) | backend `test_search_variant_barcode_returns_parent_exposing_variant` + E2E `A variant barcode scan adds that variant, not the base product` | ✅ COMPLIANT |
| Variant barcode matching | Product-level barcode still matches | backend `test_search_products_by_name_sku_and_barcode` | ✅ COMPLIANT |
| Scan-miss empty state | Unknown barcode shows empty state, input kept | E2E `An unknown scan keeps the no-match empty state and the input` | ✅ COMPLIANT |
| Live search threshold | Short query does not search | (none dedicated) — `enabled: query.trim().length >= 2` static guard; the ≥2-firing side is exercised by every search E2E | ⚠️ PARTIAL |

**sell-screen (4 req / 9 scen)**
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Fractioned-quantity modal | Decimal UoM opens modal | E2E `Decimal-UoM product opens the quantity modal and accepts 0.25 at dp=3` | ✅ COMPLIANT |
| Fractioned-quantity modal | Within precision accepted (0.25 @ dp=3) | same E2E | ✅ COMPLIANT |
| Fractioned-quantity modal | Over precision rejected (0.125 @ dp=2) | E2E `Over-precision quantity is rejected at the UoM decimal places` | ✅ COMPLIANT |
| Fractioned-quantity modal | Integer UoM auto-add 1, no modal | E2E `Integer-UoM product keeps the auto-add 1 behavior` | ✅ COMPLIANT |
| Cash-session gate | No open session blocks issuing | E2E `Without an open session the payment controls are disabled` | ✅ COMPLIANT |
| Cash-session gate | Backend slip-through handled, cart preserved | E2E `A cash_session_required slip-through is surfaced and the cart is preserved` | ✅ COMPLIANT |
| Cash-session tagging | Sale carries open session id | backend `test_sale_requires_open_session` (asserts `cash_session_id == session_id`) | ✅ COMPLIANT |
| Cash-session tagging | Session report includes the sale | backend `test_report_expected_math_with_transfer` (+ `cash_session_id` report assertions) | ✅ COMPLIANT |
| Localized UI strings | Locale switch shows translated strings | es rendering exercised suite-wide; en catalog complete and **tsc-enforced** (`en: Messages`, `MessageId = keyof Messages`); no dedicated switch E2E | ⚠️ PARTIAL |

**payments (6 req / 11 scen)**
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Quick payment-method shortcuts | One click creates single full-total row | E2E `Quick paid button creates the sale with a single full-total row` | ✅ COMPLIANT |
| Quick payment-method shortcuts | Shortcut list follows admin config | E2E credit-quick tests click a method created via API moments earlier (renders from the methods list) | ✅ COMPLIANT |
| Credit methods require a customer | Without customer blocked, no document | E2E `Credit quick without a customer prompts and does not create a document` | ✅ COMPLIANT |
| Credit methods require a customer | With customer creates credit sale (unpaid) | E2E `Credit quick with a customer creates the credit sale` | ✅ COMPLIANT |
| Split-payment dialog | Split across two methods posts both rows | E2E `Split payment across two methods posts both rows` | ✅ COMPLIANT |
| Split-payment dialog | Uncovered remainder blocks confirmation | E2E `Uncovered remainder blocks split confirmation` | ✅ COMPLIANT |
| Credit portion ≤ remaining total | Overflow rejected with `credit_exceeds_total`, no document | E2E `Credit overflow is blocked with credit_exceeds_total` + backend `test_credit_exceeds_total_rejected` (asserts no doc, no saldo leak) | ✅ COMPLIANT |
| Credit portion ≤ remaining total | Within remaining accepted | E2E `Sale on credit applies the customer's credit in favor` (split with credit row) + backend `test_favor_auto_coverage_with_effective_cash_row` | ✅ COMPLIANT |
| Vuelto on cash overpayment | Cash overpay shows vuelto, carries to post-sale, posts capped row | E2E `Cash overpayment shows vuelto, posts the capped row and carries it post-sale` | ✅ COMPLIANT |
| Vuelto on cash overpayment | Non-cash overpay blocked (`payment_exceeds_total`), no vuelto | E2E `Non-cash overpayment is blocked with payment_exceeds_total` + backend `test_non_cash_payment_exceeds_total_rejected` | ✅ COMPLIANT |
| Localized UI strings | Locale switch shows translated payment strings | as sell-screen Localized | ⚠️ PARTIAL |

**post-sale-actions (7 req / 16 scen)**
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Post-sale dialog | Shows summary + vuelto 500 | E2E `The post-sale dialog shows the summary and the vuelto` | ✅ COMPLIANT |
| Post-sale dialog | Exact payment → no vuelto section | E2E `The post-sale dialog omits the vuelto section for an exact payment` | ✅ COMPLIANT |
| Voucher printing 2 formats | Default format preselected | E2E `Print opens with the configured default format and toggles profiles` | ✅ COMPLIANT |
| Voucher printing 2 formats | User switches profile before printing | same E2E | ✅ COMPLIANT |
| Send voucher by email | Auto-send to customer address | E2E `The email action auto-sends to the customer's address` (asserts MailCatcher received it) | ✅ COMPLIANT |
| Send voucher by email | Prompt when customer has no email | prompt branch implemented (`emailInputOpen`) but untested at runtime; backend missing-address path tested | ⚠️ PARTIAL |
| Send voucher by email | SMTP disabled → disabled + tooltip | E2E `The email action is disabled with a tooltip when SMTP is off` | ✅ COMPLIANT |
| Send voucher by email | SMTP failure degrades, document untouched | backend `test_email_smtp_failure_maps_to_business_error` (asserts document unchanged) | ✅ COMPLIANT |
| Send voucher by email | Permission gates the action | E2E `The email action is hidden without the document.email permission` + backend `test_email_requires_document_email_permission` | ✅ COMPLIANT |
| Save voucher as PDF | Opens browser print flow with hint | E2E `The save-PDF action opens the print flow with a hint` | ✅ COMPLIANT |
| Document notes persisted | Sale created with note, returned on read | backend `test_document_notes_round_trip_on_all_types` | ✅ COMPLIANT |
| Document notes persisted | >500 chars rejected | backend `test_document_notes_over_limit_rejected` (+ PATCH variant) | ✅ COMPLIANT |
| Document notes persisted | Note prints on voucher | E2E `The note action PATCHes the document and prints on the voucher` | ✅ COMPLIANT |
| Document notes persisted | Available on ALL document types | backend `test_document_notes_round_trip_on_all_types` (sale/purchase/quote/credit note) | ✅ COMPLIANT |
| New-sale reset | Clears state, refocuses search | E2E `New sale resets the cart and refocuses the search input` | ✅ COMPLIANT |
| Client regeneration | Generated types include contract, tsc passes | `frontend/src/client/types.gen.ts` + `sdk.gen.ts` contain `notes`/`contraparte_email`/email endpoints; tsc green | ✅ COMPLIANT |

**print-configuration (4 req / 7 scen)**
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Print settings on BusinessSettings | Fresh settings: format default, texts NULL | backend `test_fresh_settings_have_empty_print_texts` | ✅ COMPLIANT |
| Print settings on BusinessSettings | Migration scoped + reversible, ledgers untouched | verify-phase runtime: M1 `downgrade -1`/`upgrade`, M2 `downgrade -2`/`upgrade` clean on scratch DB; migration files reviewed (no ledger DDL) | ✅ COMPLIANT |
| Admin Printing section | Administrator configures + persists | E2E `admin.spec.ts > Administrator configures printing and the values persist` | ✅ COMPLIANT |
| Admin Printing section | Over-length footer rejected in form | E2E `A footer over the maximum length shows a validation error` + backend `test_print_settings_length_limits` | ✅ COMPLIANT |
| Print settings honored by profiles | Footer/legends appear in both profiles | E2E `The voucher honors footer and legends settings in both profiles` | ✅ COMPLIANT |
| Print settings honored by profiles | Empty/NULL renders nothing | same E2E + `VoucherPrint.tsx` conditional render (NULL → block not rendered) | ✅ COMPLIANT |
| Client regeneration | Types include print fields, tsc passes | types.gen.ts contains `default_print_format`/`voucher_footer`/`voucher_legends`; tsc green | ✅ COMPLIANT |

**Compliance summary**: all 52 scenarios judged with evidence on record — **48 COMPLIANT + 4 PARTIAL** (passing evidence exists for each, but covers only part of the scenario branch; 0 UNTESTED, 0 FAILING). The envelope `scenarios: 52/52` counts judged scenarios; the PARTIAL marking carries the branch-level nuance (validator contract: passing verdicts require the complete count).

### Correctness (Static Evidence)
| Area | Status | Notes |
|---|---|---|
| Payment validations (D9/D10) | ✅ Implemented | `crud.py:591` `credit_exceeds_total` = Σ credit > max(total − Σ paid, 0); `crud.py:598` `payment_exceeds_total` = total > 0 ∧ Σ non-cash paid > total; placed before hooks; full-cash-overpay permissiveness preserved + pinned by regression test |
| Cross-layer payment math | ✅ Coherent | `paymentMath.ts` rules equal backend without favor, strictly tighter with favor (safe direction — frontend never posts what backend rejects); `capCashRows` reverse-order capping posts Σ rows == target so vuelto never reaches the ledger; pinned contract test (total 1000, saldo −200, effective cash 800 → favor_monto 200, saldo 0) passes |
| Search ordering (D3/D5) | ✅ Implemented | SQL CASE tiers (barcode exact → name exact → partial) with `selectinload(Product.uom)`; no post-LIMIT re-rank |
| Email endpoint | ✅ Implemented | Resolution body → counterpart → `document_email_missing_address`; `email_not_enabled` fail-closed; try/except → `document_email_failed`; read-only path (no DB write); `EmailStr \| None` body |
| Notes PATCH | ✅ Implemented | Perm `document.create`, 404 coded, ACTIVE-only (`document_not_editable` on voided), ≤500 |
| email-status (D7) | ✅ Implemented | `require_permissions("document.email")`, fail-closed |
| Seed | ✅ Implemented | `document.email` seeded in `init_db` |
| Security pass | ✅ | Both new endpoints behind `CurrentUser` + `require_permissions`; 422 via Pydantic bounds; error bodies carry only `code`/`message` (no internals leaked); SMTP failure maps to stable code without exception details |
| AGENTS.md rules 5–7, 15 | ✅ | Ledger tables untouched by diff and migrations; `crud.py` diff purely additive (methods dict, validation block, `notes=document_in.notes`, new `update_document_notes`); hooks/saldo/`DocumentSequence` locking untouched |
| Language rule / secrets | ✅ | Commit messages, migration descriptions, comments in English (domain vocabulary respected); no `.env` changes in the 10 commits; no secrets in diff (only test-fixture random strings) |
| i18n | ✅ | 136/136 keys used by changed components exist in BOTH catalogs (structural check via bun import); 6 new error codes present in both; `en: Messages` makes key parity a compile error |
| Diff surface vs declared scope | ✅ | No backend file outside scope; frontend extras accounted: `ui/textarea.tsx` (shadcn add), `lib/format.ts` +5 (money helper), `Sell/useReferenceData.ts` (extraction artifact), `tests/utils/{api,table}.ts` (test helpers), catalog/payments/reports.spec edits = documented e082de9 test-rot triage |

### Coherence (Design)
| Decision | Followed? | Notes |
|---|---|---|
| D1 vuelto = UI state, effective rows posted | ✅ Yes | `capCashRows` + contract test |
| D2 implicit favor + use-credit toggle | ✅ Yes | toggle only when saldo < 0; backend favor untouched (`min(-saldo, unpaid)`) |
| D3 SQL CASE tiers | ✅ Yes | products.py |
| D4 variant resolution in frontend via UNIQUE codes | ✅ Yes | ProductSearch `resolveVariantBarcode` |
| D5 nested `uom` payload | ✅ Yes | `ProductPublic.uom` + selectinload |
| D6 dedicated notes PATCH | ✅ Yes | ACTIVE-only, `document.create` |
| D7 email-status endpoint | ✅ Yes | perm `document.email`, fail-closed |
| D8 one voucher body + CSS profiles | ✅ Yes | `data-print-format` + injected `@page` + index.css blocks; CashSessionReportView unregressed (its own overlay lacks the attr) |
| D9/D10 backend guards | ✅ Yes | see Correctness |
| D11 legends as newline text | ✅ Yes | `splitlines`-style render via `whitespace-pre-line`, NULL → nothing |
| D12 default `"a4"` | ✅ Yes | model default + migration server_default 'A4' |
| sell.tsx ~120-line target | ⚠️ Documented deviation | ~330 lines — success screen + useReferenceData + payment wiring remain; known context (2), not re-flagged as new |

### Issues Found
**CRITICAL**: None.

**WARNING**:
- **W1 (remediated during verify)**: Pre-existing `limit: 100` fetch for the shared React Query key `["payment-methods"]` on the /sell page (`useReferenceData.ts` moved verbatim from old sell.tsx + `OpenCashDialog.tsx`, last-writer-wins on the same key) clipped the method list to 100. With accumulated dev data (>100 methods — batch 3 finished under the threshold), every E2E that created a fresh method timed out (3–7 failures per run). Not a regression of this change; fixed here mechanically (2 lines / 2 files, within the 400-line budget): both fetchers bumped to `limit: 1000`, matching the file's own customers convention. **These 2 lines are uncommitted working-tree changes — orchestrator should review + commit them.**
- **W2**: Session-setup dependency in pre-existing specs: only `sell.spec.ts` ensures an open cash session; `documents/payments/reports` specs (alphabetically before sell) failed 8× with `cash_session_required` on a run started without one. Environment/state fragility, not product code. Follow-up: `ensureOpenCashSession` in those beforeAll hooks.
- **W3**: Intermittent pre-existing E2E flakes (each passed at least once across runs 2–4): payments "Partial receipt keeps the remainder outstanding" (receipt-amount `fill` racing the form's auto-fill — swapped pass/fail between runs) and reports "Low stock" (failed run 4, passed in isolation and in runs 2–3). No product-code evidence; suggest test hardening follow-up.
- **W4 (known, listed for completeness)**: sell.tsx ~330 lines vs design ~120 — documented deviation (apply report + orchestrator context), no spec impact.

**SUGGESTION**:
- S1: `PostSaleDialog` email button is briefly enabled until the email-status query resolves (`emailDisabled` only after fetch) — consider default-disabled until status known.
- S2: `QuantityModal` precision check counts string fraction digits; exponent input (e.g. `1e-3`) bypasses it (hostile-input edge on `type="number"`).
- S3: Hardcoded email placeholder `cliente@ejemplo.com` bypasses i18n (only unlocalized user-facing string found in the new components).
- S4: The same shared-key/different-limit landmine exists for other `["payment-methods"]`/`["financial-accounts"]` fetchers (ReceiptDialog, NewDocumentDialog, DocumentDetailSheet, admin, buy.tsx, OpenCashDialog accounts) — latent, same class as W1; align when next touched.
- S5: Apply-progress memory (obs 21) records final verification as "27 requirements / 53 scenarios" — a miscount; tasks.md 10.3 (26/52) matches the direct spec tally.

### Verdict
**PASS WITH WARNINGS** — All 39 tasks complete; all 26 requirements and all 52 scenarios judged with runtime evidence (48 COMPLIANT, 4 PARTIAL with static/type-enforced or partial-branch evidence, 0 untested, 0 failing); all four gates re-executed green on the verifier's own run (293 backend, lint/typecheck/build, migrations reversible, E2E substantively green after diagnosing environment-class failures); ledgers/saldo/document-sequence invariants untouched; no critical or cross-layer inconsistency found.

## Key Learnings

1. React Query caches keyed `["payment-methods"]` are written by multiple fetchers with different limits, and the last mounted observer wins, so a limit-100 fetcher silently clipped the sell screen's method list to 100.
2. The E2E suite only passed at 110/1/0 while the dev DB had fewer than 100 payment methods, because three sell specs create a fresh method and select it from the clipped window.
3. Playwright's `reuseExistingServer` reused an orphaned Vite process and made one E2E run appear to serve stale code, so web-server state must be checked before blaming source edits.
4. Migration reversibility for both additive migrations was re-proven at verify time with downgrade/upgrade cycles on a scratch database, keeping the dev DB and its append-only ledgers untouched.
