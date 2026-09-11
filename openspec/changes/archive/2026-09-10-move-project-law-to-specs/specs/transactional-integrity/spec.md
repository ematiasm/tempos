# Transactional Integrity Specification

## Purpose

Define the invariants that keep the append-only ledgers, their balance caches,
document numbering and counterpart locking consistent under concurrent use. These
invariants are enforced by the database and by a fixed lock order, not by reviewer
discipline.

## Requirements

### Requirement: Ledger tables are insert-only

`StockMovement`, `AccountMovement`, `CustomerAccountMovement`,
`SupplierAccountMovement`, `Transfer` and `Conciliation` MUST reject any `UPDATE` or
`DELETE` on a
persisted row at the database level, regardless of the access path (ORM, raw SQL,
`psql`). Corrections MUST be expressed as a new opposite-sign movement that
references the original. Ledger rows carry no `parent_*_id` of their own: the link
between a correction and the row it reverses lives on the document, through
`parent_document_id`. The guard
MUST be present in a database migrated to head.

#### Scenario: UPDATE on a persisted movement is rejected

- GIVEN a persisted `StockMovement` row
- WHEN an `UPDATE` sets its `cantidad` to another value
- THEN the database raises an error and the row keeps its original values

#### Scenario: DELETE on a persisted movement is rejected

- GIVEN a persisted `AccountMovement` row
- WHEN a `DELETE` targets it
- THEN the database raises an error and the row is still present

#### Scenario: A correction is a contra-entry

- GIVEN a posted movement that must be corrected
- WHEN the correction is applied
- THEN a new opposite-sign movement produced by the reversing document is inserted,
  the original row is untouched and both rows remain stored

#### Scenario: The guard is present after migrating

- GIVEN a database migrated to head
- WHEN `pg_trigger` is queried for the six protected tables
- THEN each table carries the mutation-rejecting trigger

### Requirement: Conciliation never mutates the ledger

`POST /account-movements/{id}/conciliate` MUST record the conciliation as a new row in
the append-only `conciliation` log instead of updating the movement, and MUST be
idempotent — conciliating an already-conciliated movement keeps the original row. The
`accountmovement` table MUST NOT carry a mutable conciliation column, and the
`conciliado` value exposed by the API MUST be derived from the log, so the ledger row's
amount, direction, date and account remain unchanged by conciliation.

#### Scenario: Conciliating leaves the ledger row untouched

- GIVEN a persisted account movement with a known amount, direction and date
- WHEN it is conciliated through the API
- THEN a row exists in the conciliation log, the movement's own fields are unchanged
  and no `UPDATE` was issued against `accountmovement`

#### Scenario: Conciliating twice is idempotent

- GIVEN an already-conciliated movement
- WHEN it is conciliated again
- THEN the log still holds exactly one row for it and the response still reports it as
  conciliated

#### Scenario: The flag stays filterable

- GIVEN a conciliated and a non-conciliated movement
- WHEN the ledger is filtered by `conciliado`
- THEN each filter returns exactly its matching movement

### Requirement: Balance caches reconcile atomically

Every ledger insert MUST update its balance cache in the same transaction, as a
relative delta over the stored value, so concurrent deltas serialize on the row. The
caches are `Product.stock_current`, `ProductVariant.stock_current`, `Customer.saldo`,
`Supplier.saldo` and `FinancialAccount.saldo`. Deriving a cache by reading it and
writing back an absolute value MUST NOT be used.

#### Scenario: Concurrent deltas do not lose an update

- GIVEN a product whose `stock_current` is 10
- WHEN two movements of +5 and -3 are inserted concurrently
- THEN `stock_current` ends at 12 and both movements are stored

#### Scenario: A failed transaction changes neither row nor cache

- GIVEN a transaction that inserts a movement and updates the cache
- WHEN the transaction fails before committing
- THEN neither the ledger row nor the cache value is visible afterwards

#### Scenario: No cache is updated outside its transaction

- GIVEN the backend source tree
- WHEN cache updates are searched
- THEN every one is a relative-delta `UPDATE` executed in the same transaction as its
  ledger insert

### Requirement: Document numbers are claimed under lock

The next number for a `(document_type_id, year)` pair MUST be claimed from
`DocumentSequence` inside the same transaction that inserts the `Document`, using a
locking read. Deriving the number from an aggregate over `Document` (for example
`SELECT MAX(...)`) MUST NOT be used.

#### Scenario: Concurrent creation yields distinct consecutive numbers

- GIVEN a document type and year with no claimed numbers
- WHEN N creations run concurrently
- THEN exactly N distinct consecutive numbers are claimed and no creation fails from a
  duplicate

#### Scenario: Numbering never derives from an aggregate

- GIVEN the backend source tree
- WHEN document numbering paths are searched
- THEN none derives the number from an aggregate over `Document`

### Requirement: Counterpart rows are locked before numbering

Document and receipt creation MUST lock the counterpart row before claiming the
document number, and every new path MUST keep the lock order counterpart →
`DocumentSequence` so no deadlock cycle can form.

#### Scenario: Concurrent credit documents serialize on the counterpart

- GIVEN a customer with a limited available credit
- WHEN two credit sales for that customer are created concurrently
- THEN the second sale sees the balance the first one left, and neither consumes credit
  twice

#### Scenario: The lock order is fixed in every path

- GIVEN any backend path that writes a document or a receipt
- WHEN its lock acquisitions are inspected
- THEN the counterpart lock precedes the sequence lock
