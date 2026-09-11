# Documents Specification

## Purpose

Define the unified document lifecycle: how numbers are formed and why gaps are
expected, how a document is voided through a mirror note, how a quote becomes an
invoice, how credit in favour is applied, how counterparts are referenced, and which
fiscal and architecture constraints stay reserved.

## Requirements

### Requirement: Number format and intentional gaps

A document number MUST be formed as `YYYY-PREFIX-NUM`, where `PREFIX` is the editable
per-`DocumentType` prefix and `NUM` is the value claimed from `DocumentSequence` for
that type and year. A voided document RETAINS its number, so gaps in the sequence are
expected and MUST NOT be backfilled or reassigned.

#### Scenario: Voiding leaves the number empty forever

- GIVEN three consecutive documents `2026-FA-0001`, `2026-FA-0002`, `2026-FA-0003`
- WHEN `2026-FA-0002` is voided and a new sale is created
- THEN the new document is `2026-FA-0004` and `2026-FA-0002` is never reused

#### Scenario: The prefix is editable per document type

- GIVEN a document type whose prefix is changed
- WHEN the next document of that type is created
- THEN the new prefix is used and previously issued numbers are unchanged

### Requirement: Voiding issues a mirror note

`POST /documents/{id}/void` MUST create a mirror credit or debit note through the
document type's `void_document_type_id`. The original document MUST become `voided`
only when it is fully reverted; a partial note keeps the original active. The
accumulated reverted quantity MUST be validated against the active notes, so a
quantity cannot be reverted twice. The document-level discount MUST be reversed in the
note only on a full void. Seeded mirrors are `FA`/`FB`/`FC`/`TCK`/`NDV` → `NCV` and
`OC`/`NDC` → `NCC`; a type whose `void_document_type_id` is NULL MUST NOT be voidable.
Document detail MUST expose the pending quantity per line.

#### Scenario: Full void flips the original

- GIVEN an active sale
- WHEN the whole quantity of every line is voided
- THEN a mirror credit note references the original, the original becomes `voided`, and
  its document-level discount is reversed in the note

#### Scenario: Partial void keeps the original active

- GIVEN an active sale of three units
- WHEN one unit is voided
- THEN the original stays active, the note covers that unit only, and the pending
  quantity reflects the two remaining units

#### Scenario: A quantity cannot be reverted twice

- GIVEN a sale whose three units were already reverted by an active note
- WHEN another void is attempted for those units
- THEN it is rejected and no second note is created

#### Scenario: A type without a mirror is not voidable

- GIVEN a document whose type has `void_document_type_id` NULL
- WHEN a void is attempted
- THEN it is rejected

### Requirement: Quote converts to invoice in one step

`POST /documents/{id}/convert-to-invoice` MUST create an invoice copying the quote's
prices, discounts, taxes and cost snapshot, suggesting the invoice type A/B/C from the
counterpart's tax condition at conversion time. The quote MUST stay active and MUST
NOT be convertible again while an ACTIVE invoice child exists; voiding that invoice
MUST unlock conversion. The document payload MUST expose the child invoice number.

#### Scenario: Conversion copies the quote and keeps it active

- GIVEN an active quote
- WHEN it is converted to an invoice
- THEN the invoice carries the same lines, prices, discounts, taxes and cost snapshot,
  and the quote remains active

#### Scenario: No double invoicing while a child invoice is active

- GIVEN a quote that already has an ACTIVE invoice child
- WHEN conversion is attempted again
- THEN it is rejected

#### Scenario: Voiding the child unlocks conversion

- GIVEN a quote whose invoice child was voided
- WHEN conversion is attempted again
- THEN a new invoice is created

### Requirement: Credit in favour is applied by the backend

When a purchase produces credit in favour of the business, the backend MUST apply it to
the document as `favor_monto` — the portion of the total covered by the counterpart's
available credit. This value MUST NOT be sent by the client.

#### Scenario: The client cannot dictate credit in favour

- GIVEN a purchase that generates credit in favour
- WHEN the document is created
- THEN the backend sets `favor_monto` itself and any client-supplied value is ignored

### Requirement: Counterpart references are polymorphic

A document MUST reference its customer or supplier through `contraparte_type` plus
`contraparte_id`, with no database foreign key on the polymorphic columns. Any lookup
of the documents of a counterpart MUST go through the shared helper so the two
counterpart types stay consistent.

#### Scenario: Both counterpart types resolve through one helper

- GIVEN a customer and a supplier that each have documents
- WHEN their documents are looked up
- THEN both are resolved through the shared helper and return only their own documents

### Requirement: Reserved fiscal hooks stay reserved

`Document.cae` and `Document.cae_vto` MUST remain nullable and unused until an ARCA
electronic-invoicing integration exists; no current path may populate, validate or
require them.

#### Scenario: Documents are created without fiscal identifiers

- GIVEN the current implementation
- WHEN any document is created
- THEN `cae` and `cae_vto` are NULL and no code path requires them

### Requirement: The schema is mono-store

The schema MUST NOT carry store or warehouse foreign keys: it describes a single
store and a single warehouse. Introducing them requires an explicit product decision
recorded as its own change.

#### Scenario: No store scope in the schema

- GIVEN the current data model
- WHEN the models are inspected
- THEN no store or warehouse foreign key exists
