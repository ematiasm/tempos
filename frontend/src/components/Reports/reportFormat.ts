import { formatMoney, type NumberFormat } from "@/lib/format"

export const money = (
  value: string | number | null | undefined,
  format: NumberFormat,
): string =>
  value == null || value === "" ? "—" : `$${formatMoney(Number(value), format)}`

export const qty = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : String(Number(value))

export const pct = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : `${Number(value).toFixed(2)}%`

export interface DateRangeValue {
  desde?: string
  hasta?: string
}
