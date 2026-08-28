# Archive Report — refine-sell-counter-screen

- **Archived**: 2026-08-28
- **Mode**: hybrid (Engram topic keys + openspec files)
- **Cycle**: complete — proposed, specified, designed, task-planned, applied (strict TDD), independently verified, archived.
- **Traceability — artifacts read at archive time** (Engram, project `tempos`): proposal #14, spec #16, design #17, tasks #18, apply-progress #21, verify-report #27. No native review receipt existed for this candidate (`reviewGate` structurally absent in structured status); archive proceeded under ordinary repository policy. Task Completion Gate passed: persisted `tasks.md` has 39/39 tasks checked, 0 unchecked.

## What shipped

The `/sell` counter screen was brought to daily-counter grade for barcode-scanner use:

1. **Product search (`product-search`)** — backend SQL CASE-tier ranking (exact barcode > exact name > partial, name order within tiers); search items embed `uom` (name/abbreviation/decimal_places); frontend ↑/↓ + Enter keyboard navigation (no wrap, Escape dismiss), variant-barcode scan resolution (unique code → that variant), scan-miss keeps the visible empty state.
2. **Sell screen (`sell-screen`)** — fractioned-quantity modal for decimal-UoM products (precision enforced against `UoM.decimal_places`; integer UoM keeps auto-add 1); cash-session gate (UI blocks issuing without an open session; backend `cash_session_required` handled via `handleError` with cart preserved); every sale auto-tagged with `cash_session_id` (backend pre-existing).
3. **Payments (`payments`)** — quick shortcut per payment method (instant confirm, single full-total row); credit (`marks_paid = false`) shortcut forces customer selection; split-payment dialog (N method×amount rows, running coverage vs `target = total − favorApplied`, use-credit toggle, live vuelto, confirm caps cash rows reverse-entry-order so posted rows sum to target exactly); backend validations `credit_exceeds_total` and `payment_exceeds_total` (closes the silent credit-in-favor hole); vuelto is UI-only and never enters the ledger.
4. **Post-sale actions (`post-sale-actions`)** — post-sale dialog (summary + vuelto); 80mm/A4 CSS print profiles of the same voucher DOM; email action (auto-send when the counterpart has an email, else inline prompt; `document.email` permission; fail-closed `GET /documents/email-status`; graceful SMTP-failure business error; no DB write on the email path); save PDF via browser print flow; persisted `Document.notes` (M1, max 500, all document types, printed on vouchers, `PATCH /documents/{id}/notes` ACTIVE-only); new-sale reset with search refocus.
5. **Print configuration (`print-configuration`)** — `BusinessSettings` print fields (`default_print_format` [a4|ticket80] default a4, `voucher_footer` max 255, `voucher_legends` max 500 newline-separated; M2); admin Printing tab (react-hook-form + zod → existing PATCH `/business-settings`); both print profiles honor the settings (footer/legends render nothing when NULL).

## Commits (11 on local `main`, unpushed — remote still at `3212242`)

| Commit | Subject |
|---|---|
| `2bf3c12` | feat(products): rank search results in exact-first tiers and embed uom |
| `1006fcb` | feat(documents): validate payment composition against the document total |
| `f71660e` | feat(settings): add voucher print configuration to business settings (M2 `e655d2d1d2d1`) |
| `8f7145b` | feat(documents): add persisted printable notes with a post-sale PATCH (M1 `37ccb87265da`) |
| `884e676` | feat(documents): send the voucher by email with an email-status probe |
| `663e037` | refactor(sell): extract cart, sidebar and cash-session logic into focused modules |
| `45b2ddc` | feat(sell): quick payment shortcuts and split-payment dialog with cash-session gate |
| `8e9675d` | feat(sell): keyboard search navigation, variant scan resolution and quantity modal |
| `97bb67c` | feat(documents/print): post-sale dialog with print profiles, email and notes |
| `e082de9` | test(e2e): harden specs against accumulated dev data |
| `e25ecc8` | fix(frontend): raise shared payment-methods query limit to avoid clipped method list (verify remediation, committed after the verify report — W1 resolved) |

Migrations M1 (`37ccb87265da`, document notes) and M2 (`e655d2d1d2d1`, business-settings print fields) are each independently reversible (`downgrade -1` verified); no ledger tables touched; append-only ledgers, atomic saldo updates and `DocumentSequence` locking (AGENTS.md rules 5–7, 15) respected throughout — `crud.py` changes purely additive.

## Verification verdict (final state at close)

`verified_with_warnings` — 0 blockers, 0 CRITICAL. Final gates (last measured):

- Backend: **293 passed / 0 failed** (coverage 91%, scratch DB `app_test`/`app_verify`, real Postgres) + mypy --strict clean + ty clean + ruff check/format clean.
- Frontend: `tsc -p tsconfig.build.json` clean + biome clean + `bun run build` clean.
- E2E (Playwright vs real stack): **110 passed / 1 skipped (documented `test.fixme`) / 0 failed** final full run. (History: at verify-report time the best full run was 109/1 failed/1 skipped with the failure an intermittent pre-existing flake; the post-verify W1 remediation `e25ecc8` unclipped the shared payment-methods query and the final run closed at 110/1/0.)
- Spec accounting: **26 requirements / 52 scenarios — 48 compliant + 4 partial, 0 untested, 0 failing** (product-search 5/9, sell-screen 4/9, payments 6/11, post-sale-actions 7/16, print-configuration 4/7). `tasks.md` 10.3 records 26/52 (the apply-progress snapshot's "27/53" was a miscount, corrected at verify).

PARTIAL compliance items (non-blocking): product-search "Short query does not search" (static enabled-guard only); sell-screen and payments "Localized UI strings" (es exercised suite-wide; en complete + tsc-enforced via `en: Messages`; no locale-switch E2E); post-sale email "Prompt when no email" (backend missing-address tested; UI branch untested).

Per the Final-State Authority: W1 (shared `["payment-methods"]` React Query key written by fetchers with different limits; limit-100 last-writer-wins clipped the method list) was reported remediated-but-uncommitted in the verify-report and is **resolved and committed** as `e25ecc8` (2 files: `useReferenceData.ts`, `OpenCashDialog.tsx`, limit 100→1000). W2/W3 remain open as non-blocking test-harness follow-ups (below).

## Deviations

- **W4 (known, accepted)**: `sell.tsx` is ~330 lines vs the ~120-line design aspiration — the post-sale success screen and `useReferenceData` wiring remained in the route file; slice-7 payment wiring intact. Documented in apply-progress and verify; functional behavior unaffected.
- **Size**: ~3,400 authored changed lines vs the 400-line review budget — shipped as a **single `size:exception` PR** explicitly approved by the maintainer in-session (delivery strategy recorded in tasks).

## Deferred follow-ups (documented; NOT part of this change)

1. **Movements ordering tiebreaker (backend one-liner)**: add `, col(AccountMovement.id).desc()` in `backend/app/api/routes/account_movements.py` to re-enable the `test.fixme` (reports.spec "Movements-tab ordering with >400 same-day movements"; `GET /account-movements/` orders by `fecha desc` with no id tiebreaker). Genuine pre-existing product issue, not introduced by this change.
2. **W2 — harness hardening**: documents/payments/reports E2E specs lack `ensureOpenCashSession`; on a run without a pre-open session they hit 8× `cash_session_required`.
3. **W3 — intermittent pre-existing flakes**: payments "Partial receipt" (fill vs auto-fill race); reports "Low stock" (passes in isolation).
4. **S1–S5 verify suggestions**: S1 post-sale email button enabled until email-status resolves; S2 QuantityModal precision check bypassable via exponent input; S3 hardcoded placeholder `cliente@ejemplo.com` bypasses i18n; S4 same shared-key/different-limit landmine in other `["payment-methods"]`/`["financial-accounts"]` fetchers (ReceiptDialog, NewDocumentDialog, DocumentDetailSheet, admin, buy.tsx, OpenCashDialog accounts); S5 (27/53 miscount) already resolved — corrected to 26/52 in `tasks.md` 10.3.

## Delivery plan

- **Single `size:exception` PR** (maintainer-approved in-session) containing the 11 commits above. Push/PR creation is **orchestrator-gated and happens AFTER archive** — do not push from archive.
- Unrelated working-tree leftovers NOT part of this change (to be committed separately by the orchestrator before the PR): modified `.gitignore` (removes a dead AGENTS.md ignore line) and modified `AGENTS.md` (domain-vocabulary-exception doc clarification).
- Rollback: revert the PR; `uv run alembic downgrade -1` (×2) drops only the notes/print columns; client regen reverts via `scripts/generate-client.sh`.

## Spec sync (performed at archive)

`openspec/specs/` was empty — all 5 capabilities are new, so each delta spec was copied mechanically (shell `cp` + `diff -r` readback + `mv`, byte-identical) as the project's living spec:

| Domain | Requirements | Scenarios | Action |
|---|---|---|---|
| `product-search` | 5 | 9 | Created |
| `sell-screen` | 4 | 9 | Created |
| `payments` | 6 | 11 | Created |
| `post-sale-actions` | 7 | 16 | Created |
| `print-configuration` | 4 | 7 | Created |

Source of truth now: `openspec/specs/{product-search,sell-screen,payments,post-sale-actions,print-configuration}/spec.md`. This change folder is preserved verbatim as an audit trail at `openspec/changes/archive/2026-08-28-refine-sell-counter-screen/`.
