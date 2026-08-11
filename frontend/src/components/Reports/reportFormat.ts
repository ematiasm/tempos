export const money = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : `$${Number(value).toFixed(2)}`

export const qty = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : String(Number(value))

export const pct = (value: string | number | null | undefined): string =>
  value == null || value === "" ? "—" : `${Number(value).toFixed(2)}%`

export interface DateRangeValue {
  desde?: string
  hasta?: string
}
