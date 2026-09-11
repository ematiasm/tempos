# Counterparties Specification

## Purpose

Define the rules for customers and suppliers: when they can be removed, how the credit
limit is validated, how their balance relates to the current-account ledger, which
records are protected, and how the tax identifier is validated.

## Requirements

### Requirement: Counterpart deletion is blocked while referenced

`DELETE /customers/{id}` and `DELETE /suppliers/{id}` MUST hard-delete only when no
document references the counterpart. Because the document's counterpart columns are
polymorphic, the check MUST be explicit through the shared lookup helper, and a
referenced counterpart MUST be refused with 409 `customer_in_use` or
`supplier_in_use` carrying the referencing documents. Deactivation MUST remain
available through `PATCH` with `is_active: false`.

#### Scenario: A referenced customer cannot be deleted

- GIVEN a customer with at least one document
- WHEN it is deleted
- THEN the response is 409 `customer_in_use` with the referencing documents

#### Scenario: A supplier follows the same contract

- GIVEN a supplier with at least one document
- WHEN it is deleted
- THEN the response is 409 `supplier_in_use` with the referencing documents

#### Scenario: Deactivation is always available

- GIVEN a referenced customer
- WHEN it is patched with `is_active: false`
- THEN it becomes inactive

### Requirement: Credit limit validation

`Customer.limite_credito` MUST be interpreted as no limit when it is 0, and MUST be
validated on a credit sale when it is not 0: the resulting balance MUST NOT exceed the
limit. `Supplier` MUST NOT carry a credit limit field.

#### Scenario: Zero means no limit

- GIVEN a customer with `limite_credito` 0
- WHEN a credit sale of any amount is created
- THEN it is accepted

#### Scenario: A non-zero limit is enforced

- GIVEN a customer with a limit that the new sale would exceed
- WHEN the credit sale is created
- THEN it is rejected and no document is created

### Requirement: Balances are signed and reconcile with the ledger

`Customer.saldo` and `Supplier.saldo` MUST be signed, and their value MUST equal the sum
of the corresponding current-account ledger movements. Credit sales and payments made
through a method that does not mark the document paid MUST increase the customer
balance; the mirror note of a void MUST reverse it.

#### Scenario: The cache equals the ledger sum

- GIVEN a customer with several ledger movements
- WHEN the sale and its movements are inspected
- THEN `saldo` equals the sum of that customer's movements

### Requirement: The Consumidor Final record is protected

The "Consumidor Final" customer MUST be seeded without a tax identifier and MUST be
protected from deletion and deactivation, like the "Administrador" role.

#### Scenario: Protected record refuses removal

- GIVEN the seeded Consumidor Final customer
- WHEN it is deleted or deactivated
- THEN the operation is refused

### Requirement: Tax identifier validation

`documento` MUST be nullable and unique when present. When present it MUST be a CUIT or
CUIL: eleven digits with a valid mod-11 check digit. A DNI MUST be rejected until a
future padron lookup can resolve it.

#### Scenario: A valid CUIT is accepted

- GIVEN a CUIT with a correct check digit
- WHEN the counterpart is created
- THEN it is stored

#### Scenario: An invalid check digit is rejected

- GIVEN an eleven-digit number whose check digit does not validate
- WHEN the counterpart is created
- THEN it is rejected

#### Scenario: Two counterparts cannot share an identifier

- GIVEN a stored `documento`
- WHEN another counterpart is created with the same value
- THEN it is rejected
