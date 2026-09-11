import { describe, expect, test } from "bun:test"
import { LOCALE_TAGS, locales, toLocale } from "@/i18n/locale"

describe("toLocale", () => {
  test("keeps the two known locales", () => {
    expect(toLocale("es")).toBe("es")
    expect(toLocale("en")).toBe("en")
  })

  test("resolves anything else to English", () => {
    // English is the default before a business has configured its locale, so an unknown,
    // empty or differently cased value must not silently become Spanish.
    expect(toLocale(undefined)).toBe("en")
    expect(toLocale(null)).toBe("en")
    expect(toLocale("")).toBe("en")
    expect(toLocale("EN")).toBe("en")
    expect(toLocale("pt")).toBe("en")
  })
})

describe("locale catalog", () => {
  test("exposes exactly the supported locales", () => {
    expect([...locales]).toEqual(["es", "en"])
  })

  test("maps each locale to its BCP-47 tag", () => {
    expect(LOCALE_TAGS).toEqual({ es: "es-AR", en: "en-US" })
  })
})
