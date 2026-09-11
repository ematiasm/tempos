# Cash Sessions Specification

## Purpose

Define the daily cash-register lifecycle: a single open session at a time, the
open/close flow with its counted amounts, the optional tagging of documents so their
drawer payments feed the session's arqueo, and the permissions that gate the
endpoints.

## Requirements

### Requirement: At most one open session

`CashRegisterSession` status values MUST be the uppercase `OPEN` and `CLOSED`. At most
one session may be `OPEN` at any time, enforced by a partial unique index declared in
the SQLModel metadata. Opening a session while another is open MUST fail with
`cash_session_already_open`.

#### Scenario: A second open is rejected

- GIVEN a session in `OPEN` state
- WHEN a new session is opened
- THEN it is rejected with `cash_session_already_open` and the open session is
  unchanged

#### Scenario: The guard lives in the metadata

- GIVEN a database migrated to head
- WHEN the schema gate runs
- THEN the partial unique index is declared in the model metadata, so autogenerate
  cannot lose it silently

### Requirement: Session lifecycle and report

A session MUST be opened with an opening float and closed with the counted amounts.
The session report MUST show the movements and totals attributable to that session.

#### Scenario: Open then close

- GIVEN a session opened with an opening float
- WHEN the drawer is closed with the counted amounts
- THEN the session becomes `CLOSED` and the report reflects the counted values

#### Scenario: A closed session cannot be reopened

- GIVEN a `CLOSED` session
- WHEN a close is attempted again
- THEN it is rejected

### Requirement: Documents may be tagged to a session

A document MAY link a session through `Document.cash_session_id` so that its drawer
payments count toward that session's arqueo. Receipts MUST be able to opt in.

#### Scenario: A tagged receipt feeds the arqueo

- GIVEN an open session
- WHEN a receipt paid in cash is tagged with that session
- THEN its drawer amount counts in that session's arqueo and not in another

### Requirement: Session endpoints are permission-gated

The `/cash-sessions` endpoints (`current`, `open`, `{id}/close`, session report) MUST
require `cash.read` to read, `cash.open` to open and `cash.close` to close.

#### Scenario: Missing permission is refused

- GIVEN a user without `cash.close`
- WHEN a close is attempted
- THEN it is refused and the session state is unchanged
