/** Canonical locale enumeration and BCP-47 tag mapping, shared by the i18n
 * context and the formatting helpers (no import cycles). */
export const locales = ["es", "en"] as const
export type Locale = (typeof locales)[number]

/** BCP-47 tags used for Intl number/date formatting, derived from the locale. */
export const LOCALE_TAGS: Record<Locale, string> = {
  es: "es-AR",
  en: "en-US",
}

/** Resolve a persisted locale value. Anything that is not `es` is `en`: English is the
 *  default before a business has configured its locale. */
export function toLocale(value: string | null | undefined): Locale {
  return value === "es" ? "es" : "en"
}
