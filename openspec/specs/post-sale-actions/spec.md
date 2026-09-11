# Delta for post-sale-actions

## ADDED Requirements

### Requirement: Post-sale dialog

After a sale is confirmed, `/sell` MUST show a post-sale dialog presenting the sale details (document type, number, customer, totals, payments) and the vuelto when the payment produced change. The dialog is the hub for the actions below plus the new-sale reset.

#### Scenario: Dialog shows sale summary and vuelto

- GIVEN a sale of total 1000 was paid with 1500 cash (vuelto 500)
- WHEN the sale is confirmed
- THEN the post-sale dialog shows the document number, customer, total, payments, and a vuelto of 500

#### Scenario: Dialog without vuelto

- GIVEN a sale was paid exactly (no cash overpayment)
- WHEN the post-sale dialog opens
- THEN no vuelto section is shown

### Requirement: Voucher printing in two formats

The system MUST be able to print the SAME document voucher in two CSS print profiles: an 80mm thermal-ticket layout and an A4 layout. The user MUST be able to print with the configured default format (see `print-configuration`) and switch to the other format before printing. Both profiles MUST render the full voucher content: business identity header, document data, lines, totals, payments, notes (when present), and configured footer/legends.

#### Scenario: Default format is preselected

- GIVEN `BusinessSettings.default_print_format` is set to 80mm
- WHEN the user opens the print action for a document
- THEN the 80mm profile is the active print layout

#### Scenario: User switches format

- GIVEN the print action is open with the default profile
- WHEN the user selects the other format and prints
- THEN the printed output uses the selected profile's layout for the same document

### Requirement: Send voucher by email

The system MUST provide a document-email action backed by a new endpoint that reuses the existing `send_email` util (no new mail libraries). The endpoint MUST require the `document.email` permission (seeded in `init_db` so the first superuser has it) and MUST accept an optional destination address; when omitted, it MUST use the document's counterpart customer email. Sending the voucher content as an email MUST fail gracefully with a stable business error code (e.g. `document_email_failed`) when the SMTP delivery fails, leaving the document untouched.

#### Scenario: Auto-send to customer email

- GIVEN the document's customer has an email address and SMTP is enabled
- WHEN the user triggers the email action without typing an address
- THEN the voucher email is sent to the customer's address without prompting

#### Scenario: Prompt when the customer has no email

- GIVEN the document's customer has no email address
- WHEN the user triggers the email action
- THEN the UI prompts for a destination address before sending

#### Scenario: SMTP disabled renders the action disabled

- GIVEN `emails_enabled` is false
- WHEN the post-sale dialog renders
- THEN the email action is rendered disabled with an explanatory tooltip (no `mailto:` fallback)

#### Scenario: SMTP failure degrades gracefully

- GIVEN SMTP is enabled but delivery fails
- WHEN the email action is executed
- THEN a business error is surfaced via the standard error handler
- AND the document data is unchanged

#### Scenario: Permission gates the action

- GIVEN the current user's role lacks `document.email`
- WHEN the post-sale dialog renders
- THEN the email action is not available

### Requirement: Save voucher as PDF

The system MUST offer a save-PDF action implemented via the browser print-to-PDF flow over the same voucher rendering (no backend PDF library). It MUST NOT create files server-side.

#### Scenario: PDF action opens the browser print flow

- GIVEN a document is displayed in the post-sale dialog
- WHEN the user triggers the save-PDF action
- THEN the browser print flow opens rendering the voucher, from which the user saves a PDF

### Requirement: Document notes persisted

The system MUST support a persisted note on documents: a new nullable `Document.notes` column (`max_length` 500, matching project convention), added by a new Alembic migration with an English description scoped to this single conceptual change. `notes` MUST be accepted in the document create payload and returned in document read/detail payloads, MUST be available on ALL document types (sales, purchases, quotes, notes, receipts, adjustments), and MUST be printed on vouchers when present. Existing `notes` columns on other models are unaffected.

#### Scenario: Sale created with a note

- GIVEN a sale payload that includes `notes` (max 500 chars)
- WHEN the document is created
- THEN reading the document returns the same note text

#### Scenario: Note longer than the limit is rejected

- GIVEN a payload whose `notes` exceeds 500 characters
- WHEN the document is created
- THEN the API rejects it with a validation error

#### Scenario: Note prints on the voucher

- GIVEN a document with a note
- WHEN the voucher is printed (either profile)
- THEN the note text appears on the printed voucher

#### Scenario: Note available on all document types

- GIVEN any active document type (e.g. purchase, quote, credit note)
- WHEN a document of that type is created with a note
- THEN the note is persisted and returned in the document detail

### Requirement: New-sale reset

The post-sale dialog MUST offer a new-sale action that clears the cart, customer selection, payment state, and the dialog itself, returning `/sell` to the ready-to-scan state with focus on the product search.

#### Scenario: Reset prepares the next sale

- GIVEN a completed sale is shown in the post-sale dialog
- WHEN the user triggers the new-sale action
- THEN the cart, customer, and payment state are cleared and the search input is focused
