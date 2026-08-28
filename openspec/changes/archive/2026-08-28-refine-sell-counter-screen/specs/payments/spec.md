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
