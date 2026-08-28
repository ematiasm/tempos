# Design: Refine Sell Counter Screen

## Technical Approach

Frontend-heavy decomposition of `/sell` into focused components under `frontend/src/components/Sell/`, with a small, independently shippable backend delta: search re-ranking (filter already matches variant barcodes — verified below), `Document.notes`, `BusinessSettings` print fields, a document-email endpoint on the existing `send_email` util, and two payment-composition validations. Split-payment math posts **effective** amounts so every existing invariant (append-only ledgers, atomic saldo, `favor_monto`, FIFO allocations — AGENTS.md 5–7, 15) holds untouched; vuelto is ephemeral UI state. Implements specs: product-search, sell-screen, payments, post-sale-actions, print-configuration.

## Architecture Decisions

| # | Decision | Options | Chosen + Rationale |
|---|----------|---------|-------------------|
| D1 | Vuelto representation | (a) persist full handed amount + new ledger concepts; (b) post effective amount, vuelto = UI state | **(b)**. Backend never sees overpayment from `/sell`: rows are capped so Σ(paid)+Σ(credit) == total. Keeps `paid ≤ total`, no negative balance artifacts, no schema change; arqueo nets identically (1500 in − 500 back = 1000). |
| D2 | Credit-in-favor on `/sell` | (a) make favor an explicit payment row; (b) keep implicit auto-coverage + "use credit" toggle | **(b)**. Backend `favor_monto` logic already covers the unpaid remainder from negative saldo (crud.py:573–610). Dialog target becomes `total − favorApplied`; rows cover the target; favor never moves cash and needs no row. Other screens unaffected. |
| D3 | Search ordering | (a) Python re-rank after `LIMIT`; (b) SQL `CASE` tiers | **(b)**. Python re-rank can drop the exact match when >`limit` name-ordered rows precede it. SQL: tier 0 exact barcode (product **or** variant rows — both live in `barcode` with `product_id` set), tier 1 exact name (case-insensitive), tier 2 partial; name order within tiers. |
| D4 | Variant barcode matching | (a) new backend join; (b) reuse existing filter + eager-loaded `variants[].barcodes[]`, resolve in frontend | **(b)**. Verified: `Barcode.product_id` is NOT NULL even for variant barcodes (BarcodeCreate, products.py:341), and search already eager-loads variant barcodes — the ILIKE subquery already matches them. Gap is ordering (D3) + frontend resolution of *which* variant matched (codes are UNIQUE → unambiguous). |
| D5 | UoM precision on search results | (a) flat `uom_decimal_places`; (b) nested `uom: UoMPublic` | **(b)**. `Product.uom` relationship exists; `selectinload(Product.uom)`; modal + cart display get name/abbreviation/`decimal_places` in one shape, consistent with nested `taxes`/`variants` convention. Additive payload. |
| D6 | Post-sale note persistence | (a) create-payload only; (b) create + dedicated `PATCH /documents/{id}/notes` | **(b)**. Spec makes "add note" a post-sale action; documents are not ledger tables (notes edit touches no movement rows). Dedicated endpoint (not generic PATCH) keeps surface minimal: ACTIVE-only, `document.create` permission. |
| D7 | `emails_enabled` visibility | (a) field on `BusinessSettingsPublic`; (b) tiny `GET /documents/email-status` | **(b)**. GET /business-settings requires `settings.read`, which a cashier may lack → email action would wrongly render disabled. `email-status` is guarded by `document.email`, exactly matching who sees the action. Fail-closed on query error. |
| D8 | Print profiles | (a) two components; (b) one voucher body + CSS `data-print-format` profiles | **(b)**. Extend `VoucherPrint.tsx` (its overlay + `no-print` chrome already live in `index.css:126`); a `<style>` tag injected by the overlay emits the active `@page` rule (`80mm auto` vs `A4`); width/typography scoped by `[data-print-format]`. Same DOM, two profiles. |
| D9 | Non-cash overpayment backend guard | (a) frontend-only; (b) backend validation | **(b)**. Today a debit row > total silently becomes customer credit-in-favor (hook: `paid > total` → negative delta). Spec forbids it: new `payment_exceeds_total` when Σ(non-cash paid) > total. Cash overpay stays permissive server-side (receipt semantics; `/sell` never sends it after D1). |
| D10 | Credit overflow guard | (a) frontend-only; (b) backend validation | **(b)**. Today credit rows > remaining are silently truncated by the balance math (row says 900, ledger books 800). New `credit_exceeds_total`: Σ(`marks_paid=false`) > total − Σ(paid). Mirrors the dialog rule exactly. |
| D11 | `voucher_legends` shape | (a) JSON array column; (b) single nullable `str(500)`, newline-separated | **(b)**. Textarea editing, no schema ceremony, render via `splitlines()`; NULL → nothing rendered. |
| D12 | `default_print_format` default | `"a4"` vs `"ticket80"` | **`"a4"`** (non-null enum default required; A4/PDF works everywhere, admins opt into 80mm). Technical default, not business data — footer/legends stay NULL until configured. |

## Component Tree & State

```
routes/_layout/sell.tsx            (~120 lines: owns state, wires children)
├── CashRegisterBar                (existing; refactored onto useOpenCashSession)
├── ProductSearch                  (MOD: keyboard nav, variant-barcode resolution, decimal-UoM intercept)
├── CartTable                      (NEW: presentational; cart lines, steppers, stock hints)
├── SellSidebar                    (NEW: customer/docType/date/discount/notes field/totals)
├── QuickPaymentBar                (NEW: one button per PaymentMethod; credit → customer guard)
├── SplitPaymentDialog             (NEW: N method×amount rows, coverage/vuelto live math)
├── QuantityModal                  (NEW: decimal qty entry, UoM precision validation)
└── PostSaleDialog                 (NEW: summary + vuelto + print/email/PDF/note/new-sale)
components/Sell/
├── useSellCart.ts                 (NEW: cart state + add/update/remove + computeTotals + round2)
├── useOpenCashSession.ts          (NEW: ["cash-sessions-current"] query, shared with CashRegisterBar)
├── useBusinessSettings.ts         (NEW: ["business-settings"] query for print fields)
└── paymentMath.ts                 (NEW: pure — coverage, vuelto, credit/non-cash checks)
components/Documents/VoucherPrint.tsx  (EXT: format prop, 80mm profile, settings footer/legends, notes)
components/Admin/PrintingSettings.tsx  (NEW: admin → Printing tab form)
```

**State ownership**: cart/customer/docTypeId/date/discountTotal/notes → `sell.tsx` via `useSellCart` (local `useState`; no global store — project convention). Split rows live as draft state inside `SplitPaymentDialog`; on confirm it returns the final `DocumentPaymentCreate[]` + `vuelto` to `sell.tsx`. `created` document + `vuelto` → `sell.tsx`, passed to `PostSaleDialog`. React Query keys unchanged: `customers`, `payment-methods`, `document-types`, `products-search`, `cash-sessions-current`, plus new `business-settings`; sale success invalidates `documents`, `products`, `products-search` (existing set).

**Gate**: `useOpenCashSession()` drives `issueDisabled`-equivalent gating — when no open session, `QuickPaymentBar` buttons and the split entry are disabled and the `CashRegisterBar` open prompt is the visible call-to-action. `cash_session_required` (backend, pre-existing) maps through `handleError` as the slip-through net; cart is preserved (mutation failure doesn't reset state).

**Mechanical extraction order** (every step green: tsc + biome + `tests/sell.spec.ts`):
1. `paymentMath.ts` + `useSellCart` (move `round2`/`computeTotals`/add/update/remove) — no JSX moved.
2. `CartTable` + `SellSidebar` extraction — props down, zero behavior change; E2E green.
3. `useOpenCashSession` extraction; `CashRegisterBar` refactored onto it — E2E green.
4. Replace payment UI with `QuickPaymentBar` + `SplitPaymentDialog` (behavioral — new spec, needs backend slice 2).
5. `QuantityModal` + ProductSearch keyboard nav/variant resolution (needs backend slice 1 for `uom`).
6. `PostSaleDialog` + VoucherPrint profiles (needs slices 3–5).

## Data Model Changes (2 migrations — AGENTS.md rule 12)

**M1 — `add_document_notes`**: `Document.notes: str | None = Field(default=None, max_length=500)`. Same field added to `DocumentCreate` + `DocumentPublic`. No ledger table touched.

**M2 — `add_business_settings_print_fields`**: on `BusinessSettings`:
- `default_print_format: PrintFormat` — new `str`-enum `PrintFormat = ["a4", "ticket80"]`, default `"a4"`, max_length 10.
- `voucher_footer: str | None` (max 255), `voucher_legends: str | None` (max 500, newline-separated). NULL until configured.

Both nullable text fields render nothing when NULL (spec print-configuration). Mirrored in `BusinessSettingsPublic` + `BusinessSettingsUpdate`.

## API Contract Changes

| Endpoint | Change |
|----------|--------|
| `GET /products/search` | Ordering: exact barcode → exact name → partial (SQL CASE, D3). Response items gain `uom` (D5). Consumers: `NewDocumentDialog`, `buy.tsx`, `stock.tsx` — exact-first is a relevance refinement that benefits all of them (same "scan or type" intent); name-partial searches keep name order; **accepted globally, no query flag**. |
| `POST /documents/` | `notes` accepted. New validations: `credit_exceeds_total`, `payment_exceeds_total` (see math). `payments` shape unchanged (already N rows). |
| `PATCH /documents/{id}/notes` | NEW. Body `{notes: str \| None ≤ 500}` → `DocumentPublic`. Guards: 404 `document_not_found`; 400 `document_not_editable` if voided. Perm `document.create`. |
| `POST /documents/{id}/email` | NEW. See contract below. |
| `GET /documents/email-status` | NEW. `{"emails_enabled": bool}`, perm `document.email` (D7). |
| `GET/PATCH /business-settings/` | Print fields in `Public`/`Update` (existing endpoints — no new surface; admin tab uses `PATCH`, perm `settings.update`). |
| `DocumentPublic` | `notes`, plus `contraparte_email: str \| None` (resolved in the existing `_attach_counterpart_names` bulk pass — the post-sale dialog needs it to decide auto-send vs prompt). |

Client regen (`bash ./scripts/generate-client.sh` + tsc) after slices 1–5.

## Split-Payment Posting Math

**Verified ledger facts** (crud.py): `_financial_movements_hook` (1388) emits one `AccountMovement` per `marks_paid` row (`signo_caja × monto`, commission negated); customer balance delta = `signo_caja × (total − Σ marks_paid)`; `favor_monto` auto-covers `max(total − paid_marks, 0)` from negative saldo — receipt-backed portion materializes `DocumentPaymentAllocation` imputations, unbacked portion is recorded as `favor_monto` and absorbed arithmetically by the negative balance; outstanding formula: `pendiente = total − favor_monto − paid − allocated`.

**Posting rules**:
1. Dialog computes: `paidSum`, `creditSum` (`marks_paid=false`), `cashSum` (`is_cash_drawer=true`), `target = total − favorApplied` (favor only when toggle on and saldo < 0; `favorApplied = min(creditInFavor, total)`).
2. **Vuelto** = `max(cashSum − (target − paidNonCash − creditSum), 0)`; only cash rows may produce it.
3. **On confirm**, cash rows are capped in reverse entry order so `paidSum' + creditSum == total − favorApplied'`… concretely: excess = `paidSum + creditSum − target` (with `target = total − favorApplied`); walk cash rows last→first subtracting `min(row, excess)`. Posted rows sum exactly to the target → the backend hook books **zero** balance delta and vuelto appears nowhere in the ledger. (Favor case: total 1000, favor 200 → target 800, cash 900 → excess = 900 + 0 − 800 = 100 → capped to 800.)
4. Frontend blocks: uncovered remainder (unless covered by favor), credit overflow, non-cash overpay, credit method without customer. Backend re-validates authoritatively (D9/D10) — same codes, so `handleError` covers both layers.
5. `credit_limit_exceeded` (existing, atomic guarded UPDATE) still applies to the credit portion — no change.

```
/sell confirm ──POST /documents──▶ _create_document_in_tx
   rows (effective)                 ├─ validations: credit_exceeds_total / payment_exceeds_total (NEW)
   vuelto = UI state only           ├─ favor_monto auto-coverage (unchanged)
                                    ├─ DocumentPayment rows (unchanged shape)
                                    └─ hooks: AccountMovement × paid rows + saldo delta (unchanged)
```

**Worked examples** (all with open cash session; `TCK` sale):

| Case | Entered rows | Posted rows | Ledger effect |
|------|-------------|-------------|---------------|
| Split 1000 = 400 cash + 600 debit | cash 400, debit 600 | identical | AccountMovement +400 (cash acct), +600 (debit acct); saldo Δ 0; paid in full |
| Vuelto: total 1000, cash 1500 | cash 1500 | cash 1000 | AccountMovement +1000; saldo Δ 0; **vuelto 500 shown in dialog → post-sale only** |
| Cash + credit: 200 + 800 (customer) | cash 200, credit 800 | identical | AccountMovement +200; `CustomerAccountMovement` +800; saldo +800; `credit_limit_exceeded` if over limit |
| Credit overflow: 200 + 900 on 1000 | blocked in dialog | — | backend: 900 > 1000−200 → 400 `credit_exceeds_total`, no document |
| Non-cash overpay: debit 1100 on 1000 | blocked in dialog | — | backend: 1100 > 1000 → 400 `payment_exceeds_total` (today: silent credit-in-favor — closed) |
| Favor: total 1000, saldo −200, favor ON, cash 900 | target 800 → vuelto 100 | cash 800 | paid 800; favor: unpaid 200 → consumed; saldo −200+200 = 0; `favor_monto` bookkeeping unchanged |
| Favor + credit row: favor ON, credit 800 | target 800 | credit 800 | paid 0; favor_monto 200 (unbacked); saldo −200+1000 = +800; outstanding 1000−200−0 = 800 ✔ |

**Quick shortcuts** = a degenerate split: `marks_paid=true` → single row `{method, total}` posted directly; `marks_paid=false` → single row `{method, total}` + customer required (no customer → prompt, no POST).

## Document-Email Endpoint Contract

```
POST /api/v1/documents/{document_id}/email      perm: document.email (seeded in init_db)
body:  { "email_to": "str|EmailStr | null" }    # optional
→ 204 No Content
errors (400, {"code","message"}):
  document_not_found (404 std)                  document_email_missing_address
  email_not_enabled (config off)                document_email_failed (SMTP raise → caught)
```
Resolution order: body `email_to` → document's counterpart customer/supplier email → `document_email_missing_address`. Rendering: new `app/email-templates/src/document_voucher.mjml` → `build/document_voucher.html` (mjml build like existing 4 templates); context: business identity, `numero`, `fecha`, customer name, lines, totals, payments, `notes`, footer/legends from settings. `send_email(...)` wrapped in `try/except Exception → BusinessError("document_email_failed", ...)`; **no DB write on the path** — document untouched on failure (route rolls back only the error mapping; nothing to roll back).

## Print Architecture

Single renderer: `VoucherPrint.tsx` keeps its voucher body component; `PrintVoucherDialog` gains:
- `format: PrintFormat` state, initialized from `useBusinessSettings().default_print_format`, toggle buttons (80mm / A4) in the `no-print` chrome.
- Injected `<style>` inside the overlay with the active rule: `@media print { @page { size: 80mm auto; margin: 4mm 3mm } }` vs `size: A4; margin: 12mm`.
- Overlay root: `data-print-format={format}`; `index.css` `@media print` blocks scope `.voucher-document` width/typography per profile (80mm: 72mm content width, compact monospace-ish receipt styling, single column; A4: current layout). Existing `.no-print` chrome unchanged.
- Content parity: both profiles render header (business identity + `logo_path`), document data, lines, totals, payments, favor, `notes` (when present), footer/legends (when configured; `splitlines()`), and the non-electronic disclaimer.
- **Save PDF**: same dialog, hint text telling the user to pick "Save as PDF" as the printer destination (`window.print()` flow) — no backend lib, no server files.
- `CashSessionReportView` reuses `voucher-overlay` classes — profile styles must not regress it (data-attr scoping keeps default behavior).

## Post-Sale Dialog

Data in: `DocumentPublic` (created — now with `notes`, `contraparte_email`), `vuelto: number | null`, settings (format/footer/legends), `emails_enabled` (email-status query, enabled only if user has `document.email`).
Actions:
- **Print**: opens `PrintVoucherDialog` (format preselected from settings).
- **Email**: hidden without `document.email` perm (`lib/permissions.ts`); disabled + tooltip when `emails_enabled=false`; click → auto-send if `contraparte_email` present, else inline address input; success toast; `document_email_failed` etc. via `handleError`.
- **Save PDF**: opens the print flow (hint to choose PDF destination).
- **Note**: textarea prefilled with `document.notes` → `PATCH /documents/{id}/notes`; local state of `created` updated on success (voucher re-renders with note).
- **New sale**: resets cart/customer/payment/note state (via `useSellCart.reset`), closes dialog, focuses search input (ref forwarded through `ProductSearch`).
Pre-sale path: optional `notes` input in `SellSidebar` → `DocumentCreate.notes`.

## Admin Printing Tab

Follows the `admin.tsx` tabs pattern exactly: `<TabsTrigger value="printing">` + `<TabsContent value="printing"><PrintingTab/></TabsContent>`; `components/Admin/PrintingSettings.tsx` renders a react-hook-form + zod form (select `default_print_format` a4/ticket80; textarea footer ≤255; textarea legends ≤500) → `BusinessSettingsService.updateBusinessSettings` (existing `PATCH`, `settings.update`); server 422 surfaced via existing form-error pattern (`GeneralSettings` is the reference). No new endpoint, no new permission.

## Error Code Catalog

**New backend codes** (all 400 `{"code","message"}`; add `errors.<code>` to es/en):
| Code | Where |
|------|-------|
| `credit_exceeds_total` | POST /documents — Σ credit rows > total − Σ paid rows |
| `payment_exceeds_total` | POST /documents — Σ non-cash paid rows > total |
| `document_email_failed` | POST /documents/{id}/email — SMTP failure |
| `email_not_enabled` | POST /documents/{id}/email — `emails_enabled=false` |
| `document_email_missing_address` | POST /documents/{id}/email — no address resolvable |
| `document_not_editable` | PATCH /documents/{id}/notes — voided document |

**Existing codes exercised as regression guards (no new work)**: `cash_session_required`, `credit_limit_exceeded`, `payment_method_not_found`, `quantity_must_be_positive` (+ schema 422 for `monto ≤ 0`, `notes > 500`).

## i18n Approach

`src/i18n/messages/{es,en}.ts` only. New namespaces: `sell.qtyModal.*`, `sell.quickPayment.*`, `sell.split.*`, `sell.postSale.*`, `admin.printing.*`, `errors.<6 new codes>`. Reuse existing `sell.*` (changeDue, onCredit…), `voucher.*`, `cash.*` keys wherever already present. All user-facing strings both locales (per-capability spec requirements).

## Data Flow

```
Scanner ──▶ ProductSearch ──(uom.decimal_places>0?)──▶ QuantityModal ─┐
            (query ≥2 chars, ↑↓ Enter, variant-barcode resolve)       ▼
                                            useSellCart (cart, notes) ─┐
Customer Select ────────────────────────────────────────────────────────┤
QuickPaymentBar ──(marks_paid=false && !customer)──▶ prompt, no POST    ├─▶ createMutation
SplitPaymentDialog ──rows+favor+validation──▶ effective rows + vuelto ─┘   POST /documents
                                                                             │
                                        created: DocumentPublic ◀────────────┘
                                             ▼
                                       PostSaleDialog ── print(80/A4) / email / PDF / note PATCH / reset
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/models.py` | Modify | `Document.notes`, `BusinessSettings` print fields, `PrintFormat` enum, payload fields, `ProductPublic.uom`, `DocumentPublic.contraparte_email` |
| `backend/app/alembic/versions/*` (×2) | Create | M1 notes, M2 print fields (scoped, English descriptions) |
| `backend/app/api/routes/products.py` | Modify | CASE-tier ordering + `selectinload(Product.uom)` |
| `backend/app/api/routes/documents.py` | Modify | notes PATCH + email POST + email-status GET |
| `backend/app/crud.py` | Modify | payment validations (credit_exceeds_total, payment_exceeds_total); `update_document_notes` |
| `backend/app/core/db.py` | Modify | seed `document.email` |
| `backend/app/email-templates/{src,build}/document_voucher.*` | Create | voucher email template (+ built html) |
| `backend/tests/...` | Modify/Create | test_products, test_documents, test_business_settings, new test_document_email, test_document_notes |
| `frontend/src/routes/_layout/sell.tsx` | Modify | slim orchestrator |
| `frontend/src/components/Sell/*` | Create/Modify | tree above |
| `frontend/src/components/Documents/VoucherPrint.tsx` | Modify | profiles, settings footer/legends, notes |
| `frontend/src/components/Admin/PrintingSettings.tsx`, `admin.tsx` | Create/Modify | Printing tab |
| `frontend/src/index.css` | Modify | print profile blocks |
| `frontend/src/i18n/messages/{es,en}.ts` | Modify | new keys |
| `frontend/src/client/*` | Regen | `scripts/generate-client.sh` after each backend slice |
| `frontend/tests/sell.spec.ts`, `admin.spec.ts` | Modify | new E2E |

## Testing Strategy (strict TDD — RED first per slice)

| Layer | What | How |
|-------|------|-----|
| Backend unit/integration | Search tiers (barcode-exact incl. variant barcode, name-exact, partial), `uom` in payload; notes create/read/PATCH + guards; settings fields round-trip; email endpoint (auto-address, prompt-miss, SMTP off, SMTP fail → doc untouched); `credit_exceeds_total`, `payment_exceeds_total`; effective-overpay regression (full cash row → today's on-account semantics documented) | `pytest` vs real Postgres; RED → GREEN; `bash backend/scripts/test.sh` per slice |
| Backend regression | `cash_session_required` + auto `cash_session_id` tagging + session report inclusion | **Already exist** (`test_cash_sessions.py`, `test_documents.py`) — guard, do not rewrite |
| Frontend types/lint | tsc + biome after every slice; client regen after backend slices | AGENTS.md §4 gates |
| E2E (Playwright) | Arrow nav + Enter adds once; Escape dismisses; qty modal (precision accept/reject, integer auto-add); quick pay one-click; credit without customer blocked; split dialog (coverage, vuelto, credit overflow blocked); post-sale (summary + vuelto, note PATCH, print dialog opens with preselected format, PDF hint, email disabled w/o config); admin Printing persists; scan-miss empty state; gate blocks issuing w/o session | extend `tests/sell.spec.ts`, `admin.spec.ts`; real-backend fixtures as existing specs do |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (SMTP delivery is network I/O; its safe-failure behavior is specified: caught exception → `document_email_failed`, document untouched — covered by a RED test above.)

## Migration / Rollout

Two additive Alembic migrations (notes; print fields), reversible via `alembic downgrade -1` each; no ledger tables touched. Frontend is additive components + one rewrite of `sell.tsx` internals gated by the extraction order. Feature flags: none needed. Email degrades gracefully without SMTP (disabled action).

## Commit Slicing (9 slices, 6 capability groups)

Each slice is independent and revertible (work-unit commits with tests + client regen included); the tasks phase may merge slices 5+7 if it keeps review focus.

1. `feat(products)`: CASE ordering + `ProductPublic.uom` + tests + client regen (product-search backend).
2. `feat(documents)`: payment validations `credit_exceeds_total`/`payment_exceeds_total` + tests (payments backend).
3. `feat(settings)`: print fields + M2 + payloads + tests + regen (print-configuration backend).
4. `feat(documents)`: notes M1 + payloads + `PATCH /notes` + tests + regen (post-sale backend a).
5. `feat(documents)`: email endpoint + template + `document.email` seed + email-status + tests + regen (post-sale backend b).
6. `refactor(sell)`: mechanical extraction (`paymentMath`, `useSellCart`, `CartTable`, `SellSidebar`, `useOpenCashSession`) — E2E green, zero behavior change.
7. `feat(sell)`: payments UX — QuickPaymentBar + SplitPaymentDialog + gate wiring + i18n (pairs with 2).
8. `feat(sell)`: search nav + variant resolution + QuantityModal + gate UI + i18n (product-search frontend; pairs with 1).
9. `feat(documents/print)`: PostSaleDialog + VoucherPrint profiles + email/PDF/note actions + admin Printing tab + i18n (pairs with 3–5).

## Open Questions

- [ ] `default_print_format` fresh-DB default `"a4"` (D12) — confirm with user if 80mm-first is preferred; not blocking (admin can switch).
- [ ] None blocking.
