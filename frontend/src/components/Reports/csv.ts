/**
 * CSV export helpers for report tabs, tuned for AR Excel:
 * - `;` field separator and CRLF line endings.
 * - Decimal comma, NO thousands grouping, no currency symbols, so numbers
 *   stay computable in Excel.
 * - UTF-8 with BOM so Excel detects the encoding.
 * - Dates as dd/mm/yyyy.
 * - Fields containing `;`, `"` or newlines are double-quoted with inner
 *   quotes escaped.
 *
 * Input is expected machine-formatted, with a dot as the decimal separator: that is what the
 * API sends and what `csvNumber` and `csvMoney` assume. A human-typed es-AR amount has to be
 * parsed before it reaches them, because `"12.345"` is twelve and a bit here and twelve
 * thousand to whoever typed it. Values at or beyond `1e21` have no decimal form in
 * JavaScript and therefore come out exponential.
 */

export type CsvCell = string | number | null | undefined

/** Raw numeric value → "1234,56" (decimal comma, no grouping). */
export const csvNumber = (
  value: string | number | null | undefined,
): string => {
  if (value == null || value === "") return ""
  const num = Number(value)
  if (!Number.isFinite(num)) return ""
  return String(num).replace(".", ",")
}

/** Money amount → "1234,50" (decimal comma, always two decimals). */
export const csvMoney = (value: string | number | null | undefined): string => {
  if (value == null || value === "") return ""
  const num = Number(value)
  if (!Number.isFinite(num)) return ""
  return num.toFixed(2).replace(".", ",")
}

/**
 * ISO date (or timestamp) → "dd/mm/yyyy". Values that do not start with a
 * plausible "YYYY-MM-DD" prefix pass through untouched.
 */
export const csvDate = (value: string | null | undefined): string => {
  if (!value) return ""
  const [year, month, day] = value.slice(0, 10).split("-")
  if (year?.length !== 4 || !month || !day) return value
  return `${day}/${month}/${year}`
}

/** ASCII slug: lowercase, accents folded, non-alphanumerics → "-". */
export const csvSlug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** "ventas-por-dia_2026-08-01_2026-08-31.csv" (range parts optional). */
export const csvFilename = (
  slug: string,
  desde?: string | null,
  hasta?: string | null,
): string =>
  [csvSlug(slug), desde ?? "", hasta ?? ""]
    .filter(Boolean)
    .join("_")
    .concat(".csv")

const escapeField = (cell: CsvCell): string => {
  if (cell == null) return ""
  if (typeof cell === "number") return csvNumber(cell)
  const text = String(cell)
  if (text.includes(";") || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Build the CSV body (CRLF lines, `;`-separated) without the BOM. */
export const buildCsv = (headers: string[], rows: CsvCell[][]): string =>
  [headers, ...rows]
    .map((row) => row.map(escapeField).join(";"))
    .join("\r\n")
    .concat("\r\n")

/** Trigger a browser download of `headers`/`rows` as an AR Excel CSV file. */
export const downloadCsv = (
  filename: string,
  headers: string[],
  rows: CsvCell[][],
): void => {
  // BOM first so Excel opens the file as UTF-8.
  const blob = new Blob(["\uFEFF", buildCsv(headers, rows)], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
