import { moneyStatic } from "@/lib/format"

/**
 * Null-safe formatting helpers for report tables. Numbers/money delegate to
 * the shared locale-derived static helpers in `@/lib/format`.
 */
export const money = (value: string | number | null | undefined): string =>
  moneyStatic(value)

export const qty = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : String(Number(value))

export const pct = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : `${Number(value).toFixed(2)}%`

export interface DateRangeValue {
  desde?: string
  hasta?: string
}
