import { describe, expect, test } from "bun:test"
import { round2 } from "@/lib/money"

describe("round2", () => {
  test("rounds half up the way the backend does, digit by digit", () => {
    // Every expectation is what `Decimal ROUND_HALF_UP` at 0.01 answers for that decimal.
    // The first three are the ones `Number.EPSILON` used to fix and the next two are the
    // ones it could not, where the float's precision is larger than the epsilon.
    const cases: [string, number][] = [
      ["1.005", 1.01],
      ["1.015", 1.02],
      ["1.025", 1.03],
      ["8.575", 8.58],
      ["4.015", 4.02],
      ["0.105", 0.11],
      ["2.675", 2.68],
      ["99.995", 100],
      ["1.004", 1],
      ["1.006", 1.01],
      ["0.004", 0],
      ["10", 10],
      ["10.5", 10.5],
    ]
    for (const [literal, expected] of cases) {
      expect(round2(Number(literal))).toBe(expected)
    }
  })

  test("rounds away from zero for negative amounts", () => {
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(-8.575)).toBe(-8.58)
    expect(round2(-10.5)).toBe(-10.5)
    // And it does not hand back a negative zero, which would leak into comparisons and
    // into anything rendered straight from the number.
    expect(round2(-0.004)).toBe(0)
    expect(Object.is(round2(-0.004), -0)).toBe(false)
  })

  test("survives the artifacts float arithmetic leaves behind", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(0.1 * 3)).toBe(0.3)
    expect(round2(1.1 * 1.1)).toBe(1.21)
  })

  test("leaves values it cannot represent alone instead of answering NaN", () => {
    // Beyond 1e21 a number has no decimal form; the guard matters more than the value.
    expect(round2(1e21)).toBe(1e21)
    expect(round2(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(round2(Number.NaN))).toBe(true)
  })

  test("is a real rounding, not a truncation", () => {
    expect(round2(2.344)).toBe(2.34)
    expect(round2(2.346)).toBe(2.35)
    expect(round2(2.3449)).toBe(2.34)
  })
})
