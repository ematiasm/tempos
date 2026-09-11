import { describe, expect, test } from "bun:test"
import {
  buildMethodIndex,
  capCashRows,
  computeFavorApplied,
  computeSplitMetrics,
  type MethodOption,
  round2,
  toPaymentCreates,
} from "@/components/Payments/paymentMath"

const METHODS: MethodOption[] = [
  { id: "cash", marks_paid: true, is_cash_drawer: true },
  { id: "debit", marks_paid: true, is_cash_drawer: false },
  { id: "credit", marks_paid: false, is_cash_drawer: false },
]
const index = buildMethodIndex(METHODS)

const metrics = (
  rows: { methodId: string; amount: number }[],
  total: number,
  favor = 0,
) => computeSplitMetrics(rows, index, total, favor)

describe("round2", () => {
  test("rounds to cents", () => {
    expect(round2(2.675)).toBe(2.68)
    expect(round2(0.005)).toBe(0.01)
    expect(round2(1234.567)).toBe(1234.57)
    expect(round2(-1.005)).toBe(-1)
  })

  test("documents the float edge instead of hiding it", () => {
    // 1.005 * 100 is 100.49999999999999, so Math.round lands on 100. Amounts reaching
    // this helper carry two decimals in practice, but the behaviour is pinned here so it
    // is a known property rather than a surprise in production.
    expect(round2(1.005)).toBe(1)
  })
})

describe("buildMethodIndex", () => {
  test("keeps only the flags a row is classified by", () => {
    expect(index.get("cash")).toEqual({
      marks_paid: true,
      is_cash_drawer: true,
    })
    expect(index.get("credit")).toEqual({
      marks_paid: false,
      is_cash_drawer: false,
    })
    expect(index.get("missing")).toBeUndefined()
  })
})

describe("computeFavorApplied", () => {
  test("applies credit only when the toggle is on and credit exists", () => {
    expect(computeFavorApplied(500, false, 1000)).toBe(0)
    expect(computeFavorApplied(0, true, 1000)).toBe(0)
    expect(computeFavorApplied(-10, true, 1000)).toBe(0)
  })

  test("never applies more than the total", () => {
    expect(computeFavorApplied(1500, true, 1000)).toBe(1000)
    expect(computeFavorApplied(250, true, 1000)).toBe(250)
  })

  test("rounds to cents", () => {
    expect(computeFavorApplied(250.555, true, 1000)).toBe(250.56)
  })
})

describe("computeSplitMetrics", () => {
  test("an exact cash payment covers the target with nothing to return", () => {
    const m = metrics([{ methodId: "cash", amount: 1000 }], 1000)
    expect(m).toMatchObject({
      paidSum: 1000,
      cashSum: 1000,
      nonCashPaid: 0,
      target: 1000,
      remaining: 0,
      vuelto: 0,
      overpaid: 0,
      uncovered: false,
      creditExceeded: false,
      nonCashOverpaid: false,
    })
  })

  test("a cash overpayment is change, and the same amount is the overpayment", () => {
    const m = metrics([{ methodId: "cash", amount: 1500 }], 1000)
    expect(m.remaining).toBe(-500)
    expect(m.vuelto).toBe(500)
    expect(m.overpaid).toBe(500)
    expect(m.nonCashOverpaid).toBe(false)
  })

  test("only cash can back change: a card overpayment is flagged, never returned", () => {
    const m = metrics([{ methodId: "debit", amount: 1200 }], 1000)
    expect(m.vuelto).toBe(0)
    expect(m.overpaid).toBe(200)
    expect(m.nonCashOverpaid).toBe(true)
  })

  test("cash beyond a non-cash payment still returns only the excess", () => {
    // Debit covers 800 of 1000, so 500 in cash returns 300 and not 500.
    const m = metrics(
      [
        { methodId: "debit", amount: 800 },
        { methodId: "cash", amount: 500 },
      ],
      1000,
    )
    expect(m.nonCashPaid).toBe(800)
    expect(m.vuelto).toBe(300)
    expect(m.remaining).toBe(-300)
  })

  test("a credit row covers its part of the target without being an overpayment", () => {
    const m = metrics(
      [
        { methodId: "cash", amount: 400 },
        { methodId: "credit", amount: 600 },
      ],
      1000,
    )
    expect(m.creditSum).toBe(600)
    expect(m.paidSum).toBe(400)
    expect(m.remaining).toBe(0)
    expect(m.overpaid).toBe(0)
    expect(m.creditExceeded).toBe(false)
  })

  test("credit alone can cover the whole target", () => {
    const m = metrics([{ methodId: "credit", amount: 1000 }], 1000)
    expect(m.creditSum).toBe(1000)
    expect(m.paidSum).toBe(0)
    expect(m.remaining).toBe(0)
    expect(m.creditExceeded).toBe(false)
  })

  test("credit beyond the remaining room is flagged", () => {
    // The room is target - paidSum, clamped at zero: 1000 - 500.
    const m = metrics(
      [
        { methodId: "cash", amount: 500 },
        { methodId: "credit", amount: 900 },
      ],
      1000,
    )
    expect(m.creditExceeded).toBe(true)
    // The module docstring claims a composition violating the limits never shows vuelto,
    // and this one does: the clamp makes the cash look entirely returnable. The dialog
    // blocks confirmation on creditExceeded, so nothing ships — but the value is pinned
    // here because a caller that reads vuelto without checking the flag would show change
    // that is not due.
    expect(m.vuelto).toBe(400)
  })

  test("an uncovered remainder is reported, not silently accepted", () => {
    const m = metrics([{ methodId: "cash", amount: 400 }], 1000)
    expect(m.uncovered).toBe(true)
    expect(m.remaining).toBe(600)
    expect(m.vuelto).toBe(0)
  })

  test("applied credit lowers the target the rows must cover", () => {
    const m = metrics([{ methodId: "cash", amount: 700 }], 1000, 300)
    expect(m.target).toBe(700)
    expect(m.remaining).toBe(0)
    expect(m.uncovered).toBe(false)
  })

  test("rows for unknown methods are ignored entirely", () => {
    const m = metrics([{ methodId: "nope", amount: 999 }], 1000)
    expect(m.paidSum).toBe(0)
    expect(m.creditSum).toBe(0)
    expect(m.uncovered).toBe(true)
  })

  test("non-positive rows do not cover anything", () => {
    const m = metrics(
      [
        { methodId: "cash", amount: -50 },
        { methodId: "cash", amount: 0 },
        { methodId: "cash", amount: 1000 },
      ],
      1000,
    )
    expect(m.paidSum).toBe(1000)
    expect(m.cashSum).toBe(1000)
    expect(m.remaining).toBe(0)
  })

  test("cent-level gaps stay visible", () => {
    // Three rows of 333,33 on a target of 1000 leave a cent uncovered.
    const m = metrics(
      [
        { methodId: "cash", amount: 333.33 },
        { methodId: "debit", amount: 333.33 },
        { methodId: "cash", amount: 333.33 },
      ],
      1000,
    )
    expect(m.paidSum).toBe(999.99)
    expect(m.uncovered).toBe(true)
    expect(m.remaining).toBe(0.01)
    expect(m.vuelto).toBe(0)
  })
})

describe("capCashRows", () => {
  test("leaves a composition that already fits untouched", () => {
    const rows = [
      { methodId: "cash", amount: 400 },
      { methodId: "credit", amount: 600 },
    ]
    expect(capCashRows(rows, index, 1000)).toEqual(rows)
  })

  test("caps cash rows from the end until the rows sum to the target", () => {
    // Composed 1300 against a target of 1000: the last cash row loses the 300, and the
    // non-cash row in between keeps its amount.
    const capped = capCashRows(
      [
        { methodId: "cash", amount: 300 },
        { methodId: "debit", amount: 200 },
        { methodId: "cash", amount: 800 },
      ],
      index,
      1000,
    )
    expect(capped).toEqual([
      { methodId: "cash", amount: 300 },
      { methodId: "debit", amount: 200 },
      { methodId: "cash", amount: 500 },
    ])
    expect(capped.reduce((sum, row) => sum + row.amount, 0)).toBe(1000)
  })

  test("drops cash rows reduced to zero, which the backend would reject", () => {
    // The excess is exactly the trailing row, so it is reduced to nothing and must not
    // be posted: the backend rejects a non-positive amount.
    const capped = capCashRows(
      [
        { methodId: "cash", amount: 500 },
        { methodId: "cash", amount: 100 },
      ],
      index,
      500,
    )
    expect(capped).toEqual([{ methodId: "cash", amount: 500 }])
    expect(capped.reduce((sum, row) => sum + row.amount, 0)).toBe(500)
  })

  test("never caps a credit row, even when the excess is larger than the cash", () => {
    // The excess comes out of cash only; the credit row is left for the caller to reject
    // through creditExceeded.
    const capped = capCashRows(
      [
        { methodId: "credit", amount: 900 },
        { methodId: "cash", amount: 300 },
      ],
      index,
      500,
    )
    expect(capped).toEqual([{ methodId: "credit", amount: 900 }])
    expect(capped.some((row) => row.methodId === "credit")).toBe(true)
  })
})

describe("toPaymentCreates", () => {
  test("posts only positive rows, mapped to the API shape", () => {
    expect(
      toPaymentCreates([
        { methodId: "cash", amount: 400 },
        { methodId: "credit", amount: 0 },
        { methodId: "debit", amount: -10 },
        { methodId: "credit", amount: 600 },
      ]),
    ).toEqual([
      { payment_method_id: "cash", monto: 400 },
      { payment_method_id: "credit", monto: 600 },
    ])
  })
})
