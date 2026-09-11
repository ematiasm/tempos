import { describe, expect, test } from "bun:test"
import { money, pct, qty } from "@/components/Reports/reportFormat"
import { setStaticLocale } from "@/lib/format"

describe("money", () => {
  test("delegates to the locale-derived static helper", () => {
    setStaticLocale("en")
    expect(money(1234.5)).toBe("$1,234.50")
    setStaticLocale("es")
    expect(money(1234.5)).toBe("$1.234,50")
    setStaticLocale("en")
  })

  test("renders empty values as an em dash", () => {
    expect(money(null)).toBe("—")
    expect(money(undefined)).toBe("—")
    expect(money("")).toBe("—")
  })
})

describe("qty", () => {
  test("drops the trailing zeros a backend decimal string carries", () => {
    expect(qty("3.50")).toBe("3.5")
    expect(qty(3.5)).toBe("3.5")
    expect(qty("12.00")).toBe("12")
    expect(qty(0)).toBe("0")
  })

  test("renders empty values as an em dash", () => {
    expect(qty(null)).toBe("—")
    expect(qty(undefined)).toBe("—")
    expect(qty("")).toBe("—")
  })
})

describe("pct", () => {
  test("formats two decimals and a percent sign", () => {
    expect(pct(0)).toBe("0.00%")
    expect(pct(12.5)).toBe("12.50%")
    expect(pct("33.33")).toBe("33.33%")
    expect(pct(-2)).toBe("-2.00%")
  })

  test("renders empty values as an em dash", () => {
    expect(pct(null)).toBe("—")
    expect(pct("")).toBe("—")
  })
})
