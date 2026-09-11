import type { DocumentPaymentCreate } from "@/client"
import { round2 } from "@/lib/money"

/**
 * Pure payment-composition math, shared by every surface that posts payment
 * rows on a document (counter sales, purchases, manual documents).
 *
 * The dialog composes payment rows against `target = total - favorApplied`.
 * Two coverage policies use the same numbers:
 * - counter (POS): on confirm cash rows are capped (reverse entry order) so the
 *   posted rows sum EXACTLY to the target; the vuelto (change) never reaches the
 *   ledger and is UI state only.
 * - document: rows are posted as entered. An uncovered remainder is allowed and
 *   stays pending on the counterpart's account; a cash overpayment is allowed
 *   and becomes credit on account (`overpaid`).
 */

export interface MethodFlags {
  marks_paid: boolean
  is_cash_drawer: boolean
}

export type MethodIndex = Map<string, MethodFlags>

export interface SplitRowInput {
  methodId: string
  amount: number
}

/**
 * A confirmed composition held by a caller: the rows to post plus how much
 * credit in favor the operator chose to consume against the total.
 */
export interface SplitPayment {
  rows: SplitRowInput[]
  favorApplied: number
}

/** Shape needed to classify a row; `PaymentMethodPublic` satisfies it. */
export interface MethodOption {
  id: string
  marks_paid: boolean
  is_cash_drawer: boolean
}

/** Lookup used by every consumer that measures a set of payment rows. */
export const buildMethodIndex = (methods: MethodOption[]): MethodIndex =>
  new Map(
    methods.map((m) => [
      m.id,
      { marks_paid: m.marks_paid, is_cash_drawer: m.is_cash_drawer },
    ]),
  )

/** Rows as posted to the backend. */
export const toPaymentCreates = (
  rows: SplitRowInput[],
): DocumentPaymentCreate[] =>
  rows
    .filter((row) => row.amount > 0)
    .map((row) => ({ payment_method_id: row.methodId, monto: row.amount }))

export interface SplitMetrics {
  /** Sum of rows whose method marks the document as paid. */
  paidSum: number
  /** Sum of rows whose method is a current-account (marks_paid = false) method. */
  creditSum: number
  /** Sum of cash-drawer rows (subset of paidSum). */
  cashSum: number
  /** paidSum minus cash rows; these can never produce vuelto. */
  nonCashPaid: number
  /** total - favorApplied: the amount the rows must cover. */
  target: number
  /** target - paidSum - creditSum. Negative means cash overpayment (vuelto). */
  remaining: number
  /** Change due; only cash overpayment can produce it (see module doc). */
  vuelto: number
  /** Amount paid beyond the target; booked as credit on account, not change. */
  overpaid: number
  /** Rows do not cover the target yet. */
  uncovered: boolean
  /** Credit portion exceeds the remaining total (credit_exceeds_total). */
  creditExceeded: boolean
  /** Non-cash paid portion exceeds the target (payment_exceeds_total). */
  nonCashOverpaid: boolean
}

/**
 * Credit in favor applied to the target: only when the toggle is on, the
 * customer actually has credit, and never more than the sale total.
 */
export const computeFavorApplied = (
  creditInFavor: number,
  useCredit: boolean,
  total: number,
): number =>
  useCredit && creditInFavor > 0 ? round2(Math.min(creditInFavor, total)) : 0

function rowFlags(
  methodIndex: MethodIndex,
  row: SplitRowInput,
): MethodFlags | undefined {
  return methodIndex.get(row.methodId)
}

/** Live coverage/vuelto metrics for the current draft rows. */
export function computeSplitMetrics(
  rows: SplitRowInput[],
  methodIndex: MethodIndex,
  total: number,
  favorApplied: number,
): SplitMetrics {
  let paidSum = 0
  let creditSum = 0
  let cashSum = 0
  for (const row of rows) {
    const flags = rowFlags(methodIndex, row)
    if (!flags) continue
    const amount = round2(row.amount)
    if (amount <= 0) continue
    if (flags.marks_paid === false) {
      creditSum = round2(creditSum + amount)
    } else {
      paidSum = round2(paidSum + amount)
      if (flags.is_cash_drawer) cashSum = round2(cashSum + amount)
    }
  }
  const nonCashPaid = round2(paidSum - cashSum)
  const target = round2(total - favorApplied)
  const remaining = round2(target - paidSum - creditSum)
  // Only cash can back a change, and only what remains after every other
  // row is covered. Compositions that violate the limits never show vuelto.
  const vuelto = round2(
    Math.max(
      cashSum - Math.max(round2(target - nonCashPaid - creditSum), 0),
      0,
    ),
  )
  return {
    paidSum,
    creditSum,
    cashSum,
    nonCashPaid,
    target,
    remaining,
    vuelto,
    overpaid: round2(Math.max(-remaining, 0)),
    uncovered: remaining > 0,
    // The credit portion may not exceed the remaining total once the
    // non-credit rows (cash included, as entered) are counted. The room is
    // clamped at 0 so a pure-cash overpayment (vuelto) is never flagged.
    creditExceeded: creditSum > Math.max(round2(target - paidSum), 0),
    nonCashOverpaid: nonCashPaid > target,
  }
}

/**
 * Cap cash rows in reverse entry order so `paidSum + creditSum == target`
 * (the excess is handed back as vuelto, never posted). Rows reduced to zero
 * are dropped — the backend rejects non-positive amounts. Only the counter
 * policy caps; document entry posts the rows as entered.
 */
export function capCashRows(
  rows: SplitRowInput[],
  methodIndex: MethodIndex,
  target: number,
): SplitRowInput[] {
  const composed = rows.reduce(
    (sum, row) => (row.amount > 0 ? round2(sum + row.amount) : sum),
    0,
  )
  let excess = round2(composed - target)
  if (excess <= 0) return rows
  const capped = rows.map((row) => ({ ...row }))
  for (let i = capped.length - 1; i >= 0 && excess > 0; i--) {
    const flags = rowFlags(methodIndex, capped[i])
    if (!flags || flags.marks_paid === false || !flags.is_cash_drawer) continue
    const reduction = Math.min(capped[i].amount, excess)
    capped[i].amount = round2(capped[i].amount - reduction)
    excess = round2(excess - reduction)
  }
  return capped.filter((row) => row.amount > 0)
}
