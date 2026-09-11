import { describe, expect, test } from "bun:test"
import {
  buildCsv,
  csvDate,
  csvFilename,
  csvMoney,
  csvNumber,
  csvSlug,
} from "@/components/Reports/csv"

describe("csvNumber", () => {
  test("writes a decimal comma and no thousands grouping", () => {
    expect(csvNumber(1234.56)).toBe("1234,56")
    expect(csvNumber("1234.56")).toBe("1234,56")
    expect(csvNumber(0)).toBe("0")
    expect(csvNumber(-12.5)).toBe("-12,5")
  })

  test("empties what Excel could not compute anyway", () => {
    expect(csvNumber(null)).toBe("")
    expect(csvNumber(undefined)).toBe("")
    expect(csvNumber("")).toBe("")
    expect(csvNumber("abc")).toBe("")
    expect(csvNumber(Number.NaN)).toBe("")
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe("")
  })

  test("beyond 1e21 the value loses the comma and goes exponential", () => {
    // String(1e21) is "1e+21". Pinned so the behaviour is known: report amounts never
    // reach it, and if one ever did, the cell would stop being a number to Excel.
    expect(csvNumber(1e21)).toBe("1e+21")
  })
})

describe("csvMoney", () => {
  test("always carries two decimals with a decimal comma", () => {
    expect(csvMoney(1234.5)).toBe("1234,50")
    expect(csvMoney(1)).toBe("1,00")
    expect(csvMoney("0.5")).toBe("0,50")
  })

  test("empties invalid values", () => {
    expect(csvMoney(null)).toBe("")
    expect(csvMoney("abc")).toBe("")
  })

  test("reads a dot as the decimal separator, not as grouping", () => {
    // The API sends machine-readable decimals, so "12.345" means twelve and a third
    // cents here and not twelve thousand three hundred and forty-five. Pinned because
    // the opposite reading is what a Spanish-speaking operator would expect.
    expect(csvMoney("12.345")).toBe("12,35")
  })
})

describe("csvDate", () => {
  test("turns an ISO date or timestamp into dd/mm/yyyy", () => {
    expect(csvDate("2026-08-01")).toBe("01/08/2026")
    expect(csvDate("2026-08-01T10:00:00Z")).toBe("01/08/2026")
    expect(csvDate("2026-01-05")).toBe("05/01/2026")
  })

  test("passes anything that is not a plausible ISO date through", () => {
    expect(csvDate("01/08/2026")).toBe("01/08/2026")
    expect(csvDate("2026-08")).toBe("2026-08")
    expect(csvDate("")).toBe("")
    expect(csvDate(null)).toBe("")
    expect(csvDate(undefined)).toBe("")
  })
})

describe("csvSlug", () => {
  test("folds accents, lowercases and collapses the rest into dashes", () => {
    expect(csvSlug("Ventas por día")).toBe("ventas-por-dia")
    expect(csvSlug("¡Hola, qué tal!")).toBe("hola-que-tal")
    expect(csvSlug("Stock — reposición")).toBe("stock-reposicion")
  })

  test("never leaves a leading or trailing dash", () => {
    expect(csvSlug("  Espacios  ")).toBe("espacios")
    expect(csvSlug("¿?")).toBe("")
  })
})

describe("csvFilename", () => {
  test("joins the slug with whichever range parts exist", () => {
    expect(csvFilename("Ventas por día", "2026-08-01", "2026-08-31")).toBe(
      "ventas-por-dia_2026-08-01_2026-08-31.csv",
    )
    expect(csvFilename("ventas", "2026-08-01")).toBe("ventas_2026-08-01.csv")
    expect(csvFilename("ventas", null, null)).toBe("ventas.csv")
    expect(csvFilename("ventas")).toBe("ventas.csv")
  })
})

describe("buildCsv", () => {
  test("separates with semicolons and ends every line, headers included", () => {
    expect(buildCsv(["A", "B"], [["uno", "dos"]])).toBe("A;B\r\nuno;dos\r\n")
  })

  test("quotes a field containing a separator, a quote or a line break", () => {
    expect(buildCsv(["A"], [["x;y"]])).toBe('A\r\n"x;y"\r\n')
    expect(buildCsv(["A"], [['di"jo']])).toBe('A\r\n"di""jo"\r\n')
    expect(buildCsv(["A"], [["linea\nrara"]])).toBe('A\r\n"linea\nrara"\r\n')
  })

  test("writes numbers as csvNumber does and empties the nullish cells", () => {
    expect(buildCsv(["A", "B"], [[1.5, null]])).toBe("A;B\r\n1,5;\r\n")
  })
})
