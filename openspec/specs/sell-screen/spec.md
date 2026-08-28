# Delta for sell-screen

## ADDED Requirements

### Requirement: Fractioned-quantity modal

Adding to the cart a product whose unit of measure allows decimals (`UoM.decimal_places > 0`) MUST open a quantity-entry modal instead of auto-adding quantity 1. The modal MUST accept decimal input and MUST reject values with more decimal places than the product's UoM `decimal_places`. Products whose UoM has `decimal_places = 0` MUST keep the current behavior (auto-add quantity 1, +/- steppers).

#### Scenario: Decimal UoM opens the modal

- GIVEN a product whose UoM has `decimal_places = 3` (e.g. kg)
- WHEN the user adds it to the cart
- THEN the quantity modal opens with the keyboard focused, instead of adding quantity 1

#### Scenario: Quantity within UoM precision is accepted

- GIVEN the modal is open for a product with `decimal_places = 3`
- WHEN the user enters 0.25 and confirms
- THEN the cart line is created with quantity 0.25

#### Scenario: Quantity exceeding UoM precision is rejected

- GIVEN the modal is open for a product with `decimal_places = 2`
- WHEN the user enters 0.125 and confirms
- THEN the modal shows a validation error and no cart line is created

#### Scenario: Integer UoM keeps auto-add

- GIVEN a product whose UoM has `decimal_places = 0`
- WHEN the user adds it to the cart
- THEN no modal opens and the line is added with quantity 1

### Requirement: Cash-session gate on issuing

When no cash session is open, `/sell` MUST prevent issuing a sale: the confirm/quick-payment controls MUST be unavailable or disabled, and the screen MUST surface the open-cash-session prompt (existing `CashRegisterBar`). The backend already rejects VENTA documents without an open session with the business error `cash_session_required`; if an attempt slips through the UI gate, that error MUST be surfaced through the standard error handler and no document may be created.

#### Scenario: No open session blocks issuing

- GIVEN no cash session is open
- WHEN the user tries to confirm a sale
- THEN no document is created
- AND the screen shows the open-cash-session prompt instead of the sale confirmation

#### Scenario: Backend rejection is handled gracefully

- GIVEN no open session and the UI gate is bypassed (e.g. the session closes after the cart was built)
- WHEN a sale confirmation reaches the API
- THEN the `cash_session_required` error is shown via the standard error handler
- AND the cart contents are preserved

### Requirement: Cash-session tagging on every counter sale

Every sale document created from `/sell` MUST be linked to the open cash session (`Document.cash_session_id` = the currently open session). The backend sets this automatically when creating a VENTA document inside an open session; the frontend MUST NOT need to send a session id.

#### Scenario: Sale carries the open session id

- GIVEN a cash session is open
- WHEN a sale is created from `/sell`
- THEN the returned document has `cash_session_id` equal to the open session's id

#### Scenario: Session report includes the sale

- GIVEN a sale was created while session S was open
- WHEN the session S report is generated
- THEN the sale appears among the session's documents

### Requirement: Localized UI strings

All new user-facing strings introduced by the sell screen changes (quantity modal, gate prompt) MUST exist in both Spanish and English locales.

#### Scenario: Locale switch shows translated strings

- GIVEN the user switches the locale between Spanish and English
- WHEN the quantity modal and the cash-session prompt are displayed
- THEN all their labels render in the selected locale
