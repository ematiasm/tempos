import { beforeEach, describe, expect, test } from "bun:test"
import {
  formatDateStatic,
  formatDateTimeStatic,
  formatMoney,
  formatMoneyStatic,
  formatNumber,
  formatNumberStatic,
  formatTimeStatic,
  getStaticLocale,
  getStaticNumberFormat,
  getStaticTimezone,
  localeTag,
  money,
  moneyStatic,
  numberFormatFor,
  setStaticLocale,
} from "@/lib/format"

const ISO = "2026-09-11T01:30:00Z"
const BUENOS_AIRES = "America/Argentina/Buenos_Aires"

beforeEach(() => {
  // The static mirror is module state shared by every test in this file.
  setStaticLocale("en")
})

describe("deriving the format from the locale", () => {
  test("maps each locale to its number format and BCP-47 tag", () => {
    expect(numberFormatFor("es")).toBe("es")
    expect(numberFormatFor("en")).toBe("en")
    expect(localeTag("es")).toBe("es-AR")
    expect(localeTag("en")).toBe("en-US")
  })
})

describe("money", () => {
  test("uses es-AR conventions for a business in Spanish", () => {
    // A dot groups thousands and a comma separates decimals. The daily-sales end-to-end
    // assertion once expected the US shape, so it only matched above a thousand, where a
    // dot appears as a thousands separator. These two cases pin both magnitudes.
    expect(formatMoney(1234.5, "es")).toBe("1.234,50")
    expect(formatMoney(750, "es")).toBe("750,00")
    expect(money(1234.5, "es")).toBe("$1.234,50")
  })

  test("uses en-US conventions otherwise", () => {
    expect(formatMoney(1234.5, "en")).toBe("1,234.50")
    expect(formatMoney(750, "en")).toBe("750.00")
    expect(money(750, "en")).toBe("$750.00")
  })

  test("always shows two decimals", () => {
    expect(formatMoney(0, "en")).toBe("0.00")
    expect(formatMoney(5, "es")).toBe("5,00")
  })
})

describe("numbers", () => {
  test("honours the fraction digit argument", () => {
    expect(formatNumber(1234.567, "es", 1)).toBe("1.234,6")
    expect(formatNumber(1234.567, "en")).toBe("1,234.57")
  })
})

describe("static mirror", () => {
  test("starts in English, the default before a business configures its locale", () => {
    expect(getStaticLocale()).toBe("en")
    expect(getStaticNumberFormat()).toBe("en")
    expect(getStaticTimezone()).toBeUndefined()
  })

  test("follows what the provider sets", () => {
    setStaticLocale("es", BUENOS_AIRES)
    expect(getStaticLocale()).toBe("es")
    expect(getStaticNumberFormat()).toBe("es")
    expect(getStaticTimezone()).toBe(BUENOS_AIRES)
  })

  test("formats money with the mirrored locale", () => {
    expect(moneyStatic(1234.5)).toBe("$1,234.50")
    setStaticLocale("es")
    expect(moneyStatic(1234.5)).toBe("$1.234,50")
  })

  test("renders empty values as an em dash", () => {
    expect(moneyStatic(null)).toBe("—")
    expect(moneyStatic(undefined)).toBe("—")
    expect(moneyStatic("")).toBe("—")
    expect(formatMoneyStatic(null)).toBe("—")
    expect(formatNumberStatic(null)).toBe("—")
  })
})

describe("dates and the business timezone", () => {
  test("resolves the business day in the business timezone", () => {
    setStaticLocale("es", BUENOS_AIRES)
    // 01:30 UTC is 22:30 of the previous day in Buenos Aires, so the day differs.
    expect(formatDateStatic(ISO)).toBe("10/9/2026")
    expect(formatTimeStatic(ISO)).toBe("10:30:00")
  })

  test("resolves the same instant differently without that timezone", () => {
    setStaticLocale("es", "UTC")
    expect(formatDateStatic(ISO)).toBe("11/9/2026")
  })

  test("takes the date shape from the locale", () => {
    setStaticLocale("en", BUENOS_AIRES)
    expect(formatDateStatic(ISO)).toBe("9/10/2026")
    expect(formatDateTimeStatic(ISO)).toContain("10:30:00 PM")
  })
})
