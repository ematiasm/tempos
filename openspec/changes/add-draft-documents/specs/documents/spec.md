# Delta for Documents

## MODIFIED Requirements

### Requirement: Quote converts to invoice in one step

A non-binding document whose type operation is `borrador` MUST be convertible through
`POST /documents/{id}/convert`, which resolves the target type from the source document's
`operation` and `tipo_contraparte` — never from a `name` or a `prefix`. For a customer draft the
target is the fiscal type suggested by the counterpart's tax condition at conversion time (A/B/C);
the conversion MUST copy the source's prices, discounts, taxes and cost snapshot, MUST keep the
source active, and MUST NOT be convertible again while an ACTIVE child exists, so that voiding
that child unlocks conversion again. The document payload MUST expose the child number.
`POST /documents/{id}/convert-to-invoice` MUST remain as an alias of the same behaviour. The
partial-delivery case of a supplier draft is owned by the purchase-order requirement below.

(Previously: the endpoint was `POST /documents/{id}/convert-to-invoice`, it accepted only
`operation == cotizacion`, and the whole rule was hard-coded to "quote becomes a fiscal invoice",
so the purchase direction had no path and the single-child rule was stated for every conversion.)

#### Scenario: Conversion copies the draft and keeps it active

- GIVEN an active customer draft
- WHEN it is converted to an invoice
- THEN the invoice carries the same lines, prices, discounts, taxes and cost snapshot,
  and the draft remains active

#### Scenario: The legacy path is an alias of the same behaviour

- GIVEN an active customer draft
- WHEN it is converted through `POST /documents/{id}/convert-to-invoice`
- THEN an invoice with the same content is created, exactly as through `POST /documents/{id}/convert`

#### Scenario: No double invoicing while a child invoice is active

- GIVEN a customer draft that already has an ACTIVE invoice child
- WHEN conversion is attempted again
- THEN it is rejected

#### Scenario: Voiding the child unlocks conversion

- GIVEN a customer draft whose invoice child was voided
- WHEN conversion is attempted again
- THEN a new invoice is created

#### Scenario: The target type is resolved by operation, not by name

- GIVEN a customer draft whose fiscal target type has been renamed through the admin panel
- WHEN it is converted
- THEN the renamed fiscal type is still resolved and used

## ADDED Requirements

### Requirement: Document types carry a stable seed identity

Every seeded `DocumentType` MUST carry a stable, non-editable `key` that identifies it in code.
No code path may resolve a document type by `name` or `prefix`, because both are editable through
`PATCH /document-types/{id}`, and renaming them MUST NOT change behaviour. `PATCH
/document-types/{id}` MUST reject any attempt to set `key`. The seed MUST match existing rows by
`key`, and MUST backfill a missing `key` from the current `prefix` and then the current `name`, so
a database created before this change converges without inserting a duplicate of a type a user had
renamed. A row whose `key`, `prefix` and `name` were all changed is left without a `key` rather
than guessed, and MUST NOT make seeding fail.

#### Scenario: Renaming a fiscal type keeps fiscal suggestion working

- GIVEN the seeded fiscal type `Factura A`, renamed to another `name` and another `prefix`
- WHEN a sale type is suggested for a customer
- THEN the renamed `Factura A` row is still resolved and returned

#### Scenario: Renaming a type's prefix keeps the screens that use it working

- GIVEN the seeded purchase type, renamed to another `prefix`
- WHEN the type used to register a purchase is resolved
- THEN the renamed row is still resolved

#### Scenario: Re-seeding after a rename does not duplicate the row

- GIVEN a seeded document type whose `prefix` was changed
- WHEN the seed runs again
- THEN no second row is inserted for that type

#### Scenario: The key cannot be edited through the API

- GIVEN an existing document type
- WHEN `PATCH /document-types/{id}` sends a different `key`
- THEN the request is rejected and the stored `key` is unchanged

### Requirement: Draft documents are non-binding, editable and deletable

A document whose type operation is `borrador` MUST be non-binding: it MUST NOT insert any stock
movement, account movement or counterpart balance change, MUST NOT accept payments and MUST NOT be
linked to a cash session. While it is ACTIVE and has no child document — active or voided — it
MUST be editable through `PUT /documents/{id}` (permission `document.update`) and it MUST be
hard-deletable through `DELETE /documents/{id}` (permission `document.delete`), keeping its
`numero` and the `year` claimed from `DocumentSequence` so the gap is never reused. Editing MUST
recompute lines, taxes and totals with the same rules and validations as creation, and MUST NOT
change `numero`, `year`, `user_id` or `estado`. Once it has any child, a draft becomes immutable
and follows the ordinary void path. Document types that are not `borrador` keep the existing rule:
they are never edited.

#### Scenario: A draft moves nothing

- GIVEN a draft created for a customer and a draft created for a supplier
- WHEN either is created
- THEN no stock movement, account movement or counterpart balance change is recorded

#### Scenario: A draft rejects payments and stays out of the cash session

- GIVEN an open cash session
- WHEN a draft is created with payments in its payload
- THEN the request is rejected
- AND a draft created without payments has a NULL `cash_session_id`

#### Scenario: A childless draft can be edited

- GIVEN an active draft with no child
- WHEN its lines, discounts or counterpart are replaced through `PUT /documents/{id}`
- THEN the totals are recomputed with the creation rules and `numero` is unchanged

#### Scenario: A draft with a child becomes immutable

- GIVEN a draft whose child document was voided
- WHEN an edit or a deletion is attempted
- THEN both are rejected

#### Scenario: Deleting a draft keeps the number gap

- GIVEN a childless draft `2026-PED-00000003`
- WHEN it is deleted and the next document of that type is created
- THEN the next number is `2026-PED-00000004`

#### Scenario: A posted document is still never edited

- GIVEN an active sale
- WHEN an edit is attempted
- THEN it is rejected and the only correction path remains voiding

### Requirement: A purchase order is received in partial deliveries

A supplier draft of operation `borrador` MUST be receivable in several ACTIVE child deliveries
instead of one. `POST /documents/{id}/convert` MUST accept a per-line received quantity, MUST
reject a quantity that exceeds the line's pending quantity, and MUST reject receiving a line twice
past its ordered quantity, accumulating the quantities of the ACTIVE children the same way
partial voiding accumulates reverted quantities. A line's pending quantity MUST be
`ordered − Σ received by ACTIVE children`, exposed on the document line payload. The order MUST
stay ACTIVE while any pending quantity remains and MUST NOT be editable once it has any child.

#### Scenario: Two partial deliveries cover the order

- GIVEN a purchase order for 10 units of a product
- WHEN 8 units are received and then the remaining 2
- THEN both deliveries are active children of the order, the pending quantity reads 0, and the
  order keeps its own number

#### Scenario: A delivery cannot exceed the pending quantity

- GIVEN a purchase order with 2 units still pending
- WHEN a delivery of 3 units is attempted
- THEN it is rejected and no child document is created

#### Scenario: A voided delivery returns its quantity to pending

- GIVEN an order with a delivery of 8 units of 10, whose child was voided
- WHEN the pending quantity is read
- THEN it reads 10 again and a new delivery of 10 is accepted

#### Scenario: The order exposes every child, not only the last one

- GIVEN an order with two active child deliveries
- WHEN its document payload is read
- THEN both children are exposed and no child is silently replaced by another
