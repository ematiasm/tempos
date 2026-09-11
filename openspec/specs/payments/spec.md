# Delta for payments

## ADDED Requirements

### Requirement: Quick payment-method shortcuts

`/sell` MUST render one quick payment button per payment method returned by the payment-methods list (admin-managed rows). Clicking a quick button for a `marks_paid = true` method MUST confirm the sale immediately in one step, creating exactly one payment row for the full sale total via that method.

#### Scenario: Quick button confirms in one click

- GIVEN a cart with total 1000 and an open cash session
- WHEN the user clicks the quick button of a `marks_paid = true` method
- THEN the sale document is created with a single payment of 1000 via that method
- AND the post-sale flow opens

#### Scenario: Shortcut list follows admin configuration

- GIVEN the admin created a new payment method
- WHEN the sell screen is loaded (or its query refreshed)
- THEN a quick button for the new method is available

### Requirement: Credit methods require a customer

A payment method with `marks_paid = false` is a credit (current-account) method. Confirming a sale that includes any credit portion — via quick button or split-payment row — MUST require a selected customer: without one, the system MUST block confirmation and prompt for customer selection without creating a document.

#### Scenario: Credit shortcut without customer is blocked

- GIVEN no customer is selected and the cart has a total greater than 0
- WHEN the user clicks the quick button of a `marks_paid = false` method
- THEN no document is created
- AND the UI prompts the user to select a customer

#### Scenario: Credit shortcut with customer creates the credit sale

- GIVEN a customer is selected
- WHEN the user clicks the quick button of a `marks_paid = false` method
- THEN the sale is created with the full total as a payment via that credit method
- AND the document is not marked as paid (existing credit-sale semantics)

### Requirement: Split-payment dialog

`/sell` MUST offer a split-payment dialog where the operator composes N payment rows, each with a payment method and a positive amount. The dialog MUST show the running covered amount and the remaining balance against the sale total. Confirmation MUST be blocked while the composition does not account for the full total: paid portions plus credit portions must cover the total, except for the cash-overpayment case (vuelto, see below).

#### Scenario: Split across two methods

- GIVEN a cart with total 1000
- WHEN the user adds a cash row of 400 and a debit row of 600 and confirms
- THEN the document is created with two payment rows (400 cash, 600 debit)

#### Scenario: Uncovered remainder blocks confirmation

- GIVEN a cart with total 1000 and rows covering only 700 with no credit method
- WHEN the user tries to confirm
- THEN confirmation is blocked with validation feedback about the uncovered remainder

### Requirement: Credit portion cannot exceed the remaining total

Within the split-payment composition, the sum of credit-method (`marks_paid = false`) portions MUST NOT exceed the remaining total (sale total minus the sum of non-credit portions). Violations MUST be rejected with the validation error `credit_exceeds_total` (surfaced through the standard error handler / form feedback) and no document may be created.

#### Scenario: Credit exceeding remaining total is rejected

- GIVEN a cart with total 1000, a cash row of 200, and a credit row of 900
- WHEN the user tries to confirm
- THEN the `credit_exceeds_total` validation error is shown
- AND no document is created

#### Scenario: Credit within remaining total is accepted

- GIVEN a cart with total 1000, a cash row of 200, and a credit row of 800
- WHEN the user confirms
- THEN the document is created with both payment rows

### Requirement: Vuelto on cash overpayment

Vuelto (change) applies ONLY to cash-method overpayment: when the sum of cash portions exceeds the outstanding total, the dialog MUST display the vuelto (the excess) and allow confirmation. Non-cash methods MUST NOT generate vuelto.

#### Scenario: Cash overpayment shows vuelto

- GIVEN a cart with total 1000 and a single cash row of 1500
- WHEN the user reviews the dialog before confirming
- THEN the dialog displays a vuelto of 500
- AND confirming creates the sale and carries the vuelto into the post-sale view

#### Scenario: Non-cash overpayment is not treated as vuelto

- GIVEN a cart with total 1000 and a single non-cash row of 1100
- WHEN the user tries to confirm
- THEN no vuelto is computed
- AND confirmation is blocked because the composition exceeds the total without a cash source

### Requirement: Localized UI strings

All new user-facing strings of the payment UIs (shortcuts, split dialog, validation messages) MUST exist in both Spanish and English locales.

#### Scenario: Locale switch shows translated payment strings

- GIVEN the user switches the locale between Spanish and English
- WHEN the split-payment dialog is displayed
- THEN all its labels and validation messages render in the selected locale

### Requirement: Standalone receipts allocate oldest-first

`POST /payments/receipts` MUST create a standalone receipt — `RC` for customers, `RP`
for suppliers — that allocates its total across the counterpart's outstanding
documents, oldest document first, and records each allocation with the settled
document and a `saldo_inicial` snapshot of that document's pending balance before the
receipt. The remaining outstanding balance MUST be exposed for callers. A receipt that
exceeds the outstanding total MUST keep the surplus as on-account credit. Receipts MUST
use only payment methods that mark the document paid, and their account and
current-account ledger rows MUST be written in the same transaction as the receipt. The
printed receipt MUST show the allocations with their initial, settled and remaining
balances plus a line for the amount kept on account.

#### Scenario: Oldest outstanding documents are settled first

- GIVEN a customer with two unpaid documents, an older and a newer one
- WHEN a receipt covering only the older document's balance is created
- THEN the older document is settled in full and the newer one is untouched

#### Scenario: A partial allocation leaves the rest outstanding

- GIVEN a customer with an unpaid document of 1000
- WHEN a receipt of 400 is created
- THEN the document records 400 settled against a `saldo_inicial` of 1000 and 600
  remains outstanding

#### Scenario: An overpayment stays on account

- GIVEN a customer with 1000 outstanding
- WHEN a receipt of 1500 is created
- THEN 1000 settles the outstanding documents and 500 remains as credit on account

#### Scenario: Only methods that mark paid are accepted

- GIVEN a payment method that does not mark the document paid
- WHEN a receipt is created with it
- THEN the receipt is rejected

#### Scenario: Receipt and ledger rows are one transaction

- GIVEN a valid receipt
- WHEN it is created
- THEN the receipt, its allocations and the account and current-account ledger rows are
  all visible together, and a failure leaves none of them

#### Scenario: The printed receipt shows the settlement detail

- GIVEN a receipt with allocations and an amount kept on account
- WHEN the voucher is printed
- THEN every allocation shows its initial, settled and remaining balance, plus the
  on-account line
