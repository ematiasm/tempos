# Catalog Specification

## Purpose

Define the catalog lifecycle rules that decide when a product or a tax can be removed
and when a used tax may still be edited, so the API contract (status codes, error
codes and the referenced documents returned) is written down and verifiable.

## Requirements

### Requirement: Product deletion is blocked while referenced

`DELETE /products/{id}` MUST hard-delete only when neither the product nor any of its
variants is referenced by a document line or a stock movement. Otherwise it MUST be
refused with 409 `product_in_use` carrying the referencing documents so the caller can
list them. Deactivation MUST remain available as a separate operation through
`PATCH` with `is_active: false`.

#### Scenario: An unreferenced product is deleted

- GIVEN a product with no document line and no stock movement
- WHEN it is deleted
- THEN it is removed

#### Scenario: A referenced product is refused with its documents

- GIVEN a product referenced by a document line
- WHEN it is deleted
- THEN the response is 409 `product_in_use` and includes the referencing documents

#### Scenario: A referenced product can be deactivated instead

- GIVEN a referenced product
- WHEN it is patched with `is_active: false`
- THEN it becomes inactive and stays referenced by its documents

### Requirement: Tax deletion is blocked while in use

`DELETE /taxes/{id}` MUST hard-delete only when the tax appears in no document tax and
no document line tax. Otherwise it MUST be refused with 409 `tax_in_use` carrying the
referencing documents. Deleting the tax flagged as default MUST be allowed.

#### Scenario: A used tax cannot be deleted

- GIVEN a tax present in a document tax row
- WHEN it is deleted
- THEN the response is 409 `tax_in_use` with the referencing documents

#### Scenario: The default tax is deletable

- GIVEN a tax that is the default and is not used by any document
- WHEN it is deleted
- THEN it is removed

### Requirement: Fiscal fields of a used tax are frozen

`PATCH /taxes/{id}` on a tax that is in use MUST refuse changes to `tipo`, `rate`,
`is_percent` and `aplica_a`, because they would alter historical amounts or labels.
`name`, `code`, `is_default` and `is_active` MUST stay editable on a used tax.

#### Scenario: Changing the rate of a used tax is refused

- GIVEN a tax used by a document
- WHEN `rate` is patched
- THEN the change is refused with `tax_in_use` and the stored value is unchanged

#### Scenario: Non-fiscal fields stay editable

- GIVEN a tax used by a document
- WHEN `name`, `code`, `is_default` or `is_active` is patched
- THEN the change is applied

### Requirement: Tax defaults are user-managed and plural

`is_default` MUST be user-managed from the admin Taxes view, and multiple taxes MUST be
allowed to be default simultaneously. Product creation MUST preselect every tax flagged
as default.

#### Scenario: Multiple defaults coexist

- GIVEN two taxes flagged as default
- WHEN a product is created without choosing taxes
- THEN both defaults are preselected

### Requirement: Product taxes come from the tax link

`Product` MUST NOT carry an IVA rate field: the taxes that apply to a product come from
the product-to-tax link and drive the price chain owned by `pricing`.

#### Scenario: No rate column on the product

- GIVEN the data model
- WHEN the product columns are inspected
- THEN no IVA rate column exists and taxes are reached through the link table
