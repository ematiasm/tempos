# Delta for Payments

## ADDED Requirements

### Requirement: Standalone receipts allocate oldest-first

`POST /payments/receipts` MUST create a standalone receipt — `RC` for customers, `RP`
for suppliers — that allocates its total across the counterpart's outstanding
documents, oldest document first, and records each allocation with the settled
document and a `saldo_inicial` snapshot of that document's pending balance before the
receipt. The remaining outstanding balance MUST be exposed for callers. A receipt that
exceeds the outstanding total MUST keep the surplus as on-account credit. Receipts MUST
use only payment methods that mark the document paid, and their account and
current-account ledger rows MUST be written in the same transaction as the receipt. The
printed receipt MUST show the allocations with their initial, settled and remaining
balances plus a line for the amount kept on account.

#### Scenario: Oldest outstanding documents are settled first

- GIVEN a customer with two unpaid documents, an older and a newer one
- WHEN a receipt covering only the older document's balance is created
- THEN the older document is settled in full and the newer one is untouched

#### Scenario: A partial allocation leaves the rest outstanding

- GIVEN a customer with an unpaid document of 1000
- WHEN a receipt of 400 is created
- THEN the document records 400 settled against a `saldo_inicial` of 1000 and 600
  remains outstanding

#### Scenario: An overpayment stays on account

- GIVEN a customer with 1000 outstanding
- WHEN a receipt of 1500 is created
- THEN 1000 settles the outstanding documents and 500 remains as credit on account

#### Scenario: Only methods that mark paid are accepted

- GIVEN a payment method that does not mark the document paid
- WHEN a receipt is created with it
- THEN the receipt is rejected

#### Scenario: Receipt and ledger rows are one transaction

- GIVEN a valid receipt
- WHEN it is created
- THEN the receipt, its allocations and the account and current-account ledger rows are
  all visible together, and a failure leaves none of them

#### Scenario: The printed receipt shows the settlement detail

- GIVEN a receipt with allocations and an amount kept on account
- WHEN the voucher is printed
- THEN every allocation shows its initial, settled and remaining balance, plus the
  on-account line
