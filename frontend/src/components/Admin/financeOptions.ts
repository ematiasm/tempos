import { LOCALE_TAGS } from "@/i18n/locale"
import { getStaticLocale } from "@/lib/format"

export function formatMoney(amount: string): string {
  const value = Number(amount)
  return new Intl.NumberFormat(LOCALE_TAGS[getStaticLocale()], {
    style: "currency",
    currency: "ARS",
  }).format(value)
}
