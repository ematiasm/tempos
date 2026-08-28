export type NumberFormat = "es" | "en"

export function formatNumber(
  value: number,
  format: NumberFormat,
  fractionDigits?: number,
): string {
  return value.toLocaleString(format === "es" ? "es-AR" : "en-US", {
    maximumFractionDigits: fractionDigits ?? 2,
  })
}

export function formatMoney(value: number, format: NumberFormat): string {
  return value.toLocaleString(format === "es" ? "es-AR" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Format an amount with the currency symbol, e.g. `$1234.56`. */
export function money(value: number, format: NumberFormat): string {
  return `$${formatMoney(value, format)}`
}
