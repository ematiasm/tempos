# Delta for print-configuration

## ADDED Requirements

### Requirement: Print settings on BusinessSettings

`BusinessSettings` MUST be extended with print configuration fields with English names: `default_print_format` (enumerated value selecting the 80mm thermal or A4 voucher profile) and voucher footer and legend text fields (`voucher_footer`, `voucher_legends` — exact shape finalized in design, bounded length). Per resolved scope: the footer/legends default to EMPTY (NULL) until configured — no invented business text. The business-identity header (name/address/phone/CUIT, already seeded) remains the voucher header source. The fields MUST be exposed in the settings read/update payloads and persisted via a new Alembic migration with an English description scoped to this single conceptual change (separate from the document-notes migration).

#### Scenario: Fresh settings have empty print texts

- GIVEN a database with unconfigured print settings
- WHEN the business settings are read
- THEN `default_print_format` has a valid default value and the footer/legend fields are empty (NULL)

#### Scenario: Migration is scoped and reversible

- GIVEN the backend migrations run from zero
- WHEN `alembic upgrade head` completes
- THEN the print columns exist on the settings table
- AND `alembic downgrade -1` removes them without touching ledger tables

### Requirement: Admin Printing section

The admin panel MUST include a "Printing" section (new tab following the existing admin-tabs pattern) where an administrator can edit the default print format and the voucher footer/legend texts, persisted through the business-settings update endpoint with validation feedback.

#### Scenario: Administrator configures printing

- GIVEN an administrator opens Admin → Printing
- WHEN they set the default format to 80mm, type a footer text, and save
- THEN the settings are persisted
- AND reopening the section shows the saved values

#### Scenario: Validation on save

- GIVEN the administrator enters a footer text exceeding the configured maximum length
- WHEN they save
- THEN the API rejects it with a validation error surfaced in the form

### Requirement: Print settings honored by both profiles

Both voucher print profiles (80mm and A4) MUST honor the configured settings: the selected `default_print_format` preselects the profile (overridable per print), and the configured footer/legend texts appear on the printed voucher when present; empty/NULL texts MUST render nothing (no placeholder text).

#### Scenario: Footer appears when configured

- GIVEN a configured voucher footer
- WHEN a document voucher is printed in either profile
- THEN the footer text appears on the printed output

#### Scenario: Empty footer renders nothing

- GIVEN the voucher footer is empty (NULL)
- WHEN a document voucher is printed
- THEN no footer placeholder is rendered

### Requirement: Client regeneration after OpenAPI changes

After adding the settings print fields to the OpenAPI shape, the frontend client MUST be regenerated with `bash ./scripts/generate-client.sh` and the frontend typecheck MUST pass.

#### Scenario: Regenerated client includes print settings

- GIVEN the backend exposes the new `BusinessSettings` print fields
- WHEN the client is regenerated and the frontend typecheck runs
- THEN the generated types include the new fields and the typecheck passes
