/**
 * Shared number, money, and date/time formatting. All formatting derives from
 * the resolved business locale ("es" -> es-AR, "en" -> en-US); there is no
 * independent number-format setting.
 *
 * Hook contexts take the locale from `useLocale()`; non-hook contexts
 * (column definitions, static helpers) use the `*Static` variants, kept in
 * sync by `LocaleProvider` via `setStaticLocale`.
 */
import { LOCALE_TAGS, type Locale } from "@/i18n/locale"

export type NumberFormat = "es" | "en"

export function localeTag(locale: Locale): string {
  return LOCALE_TAGS[locale]
}

/** Number format derived from the locale: "en" -> "en", otherwise "es". */
export function numberFormatFor(locale: Locale): NumberFormat {
  return locale === "en" ? "en" : "es"
}

// --- Static locale mirror (synced by LocaleProvider) ---

const staticRef: { locale: Locale; timezone: string | undefined } = {
  locale: "es",
  timezone: undefined,
}

/** Called by LocaleProvider on every locale/timezone change. */
export function setStaticLocale(locale: Locale, timezone?: string): void {
  staticRef.locale = locale
  staticRef.timezone = timezone
}

export function getStaticLocale(): Locale {
  return staticRef.locale
}

export function getStaticNumberFormat(): NumberFormat {
  return numberFormatFor(staticRef.locale)
}

export function getStaticTimezone(): string | undefined {
  return staticRef.timezone
}

// --- Numbers & money ---

export function formatNumber(
  value: number,
  format: NumberFormat,
  fractionDigits?: number,
): string {
  return value.toLocaleString(localeTag(format === "en" ? "en" : "es"), {
    maximumFractionDigits: fractionDigits ?? 2,
  })
}

export function formatMoney(value: number, format: NumberFormat): string {
  return value.toLocaleString(localeTag(format === "en" ? "en" : "es"), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Format an amount with the currency symbol, e.g. `$1234.56`. */
export function money(value: number, format: NumberFormat): string {
  return `$${formatMoney(value, format)}`
}

type NumberLike = string | number | null | undefined

function isEmpty(value: NumberLike): boolean {
  return value == null || value === ""
}

/**
 * Static (locale-mirror) variants. Null-safe like the former
 * `reportFormat.money`: empty/nullish values render as an em dash.
 */
export function formatNumberStatic(
  value: NumberLike,
  fractionDigits?: number,
): string {
  if (isEmpty(value)) return "—"
  return formatNumber(Number(value), getStaticNumberFormat(), fractionDigits)
}

export function formatMoneyStatic(value: NumberLike): string {
  if (isEmpty(value)) return "—"
  return formatMoney(Number(value), getStaticNumberFormat())
}

export function moneyStatic(value: NumberLike): string {
  if (isEmpty(value)) return "—"
  return `$${formatMoneyStatic(Number(value))}`
}

// --- Dates & times ---

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function dateTimeOptions(timezone?: string): Intl.DateTimeFormatOptions {
  return timezone ? { timeZone: timezone } : {}
}

/** Date only, e.g. `09/09/2026` (es-AR) or `9/9/2026` (en-US). */
export function formatDate(
  value: string | Date,
  locale: Locale,
  timezone?: string,
): string {
  return toDate(value).toLocaleDateString(localeTag(locale), {
    ...dateTimeOptions(timezone),
  })
}

/** Date + time, e.g. `9/9/2026, 3:45 p.m.` */
export function formatDateTime(
  value: string | Date,
  locale: Locale,
  timezone?: string,
): string {
  return toDate(value).toLocaleString(localeTag(locale), {
    ...dateTimeOptions(timezone),
  })
}

/** Time only. */
export function formatTime(
  value: string | Date,
  locale: Locale,
  timezone?: string,
): string {
  return toDate(value).toLocaleTimeString(localeTag(locale), {
    ...dateTimeOptions(timezone),
  })
}

export function formatDateStatic(value: string | Date): string {
  return formatDate(value, staticRef.locale, staticRef.timezone)
}

export function formatDateTimeStatic(value: string | Date): string {
  return formatDateTime(value, staticRef.locale, staticRef.timezone)
}

export function formatTimeStatic(value: string | Date): string {
  return formatTime(value, staticRef.locale, staticRef.timezone)
}
