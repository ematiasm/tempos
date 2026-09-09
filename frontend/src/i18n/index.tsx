import { useQuery } from "@tanstack/react-query"
import { IntlMessageFormat } from "intl-messageformat"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { IntlProvider, useIntl } from "react-intl"

import { BusinessSettingsService } from "@/client"
import { type NumberFormat, numberFormatFor, setStaticLocale } from "@/lib/format"
import { en } from "./messages/en"
import { es, type Messages } from "./messages/es"

export { LOCALE_TAGS, locales, toLocale } from "./locale"
import { LOCALE_TAGS, type Locale, toLocale } from "./locale"
export type MessageId = keyof Messages

const catalogs: Record<Locale, Messages> = { es, en }

const cache = new Map<string, IntlMessageFormat>()

function format(
  locale: Locale,
  id: MessageId,
  values?: Record<string, string | number>,
): string {
  const template = catalogs[locale][id]
  if (!values) return template
  const key = `${locale}:${id}:${JSON.stringify(values)}`
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = new IntlMessageFormat(template, locale)
    cache.set(key, formatter)
  }
  return String(formatter.format(values))
}

/**
 * Format with the statically-tracked locale (kept in sync by LocaleProvider).
 * For non-hook contexts such as table column definitions.
 */
export function formatStatic(
  id: MessageId,
  values?: Record<string, string | number>,
): string {
  return format(staticLocaleRef.locale, id, values)
}

interface LocaleContextValue {
  locale: Locale
  numberFormat: NumberFormat
  /** Business timezone from settings; undefined = browser-local fallback. */
  timezone: string | undefined
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "es",
  numberFormat: "es",
  timezone: undefined,
})

// Module-level mirror of the resolved locale/timezone so non-hook contexts
// (formatStatic, static date helpers) can format without subscribing. The
// business locale only changes on reload, so staleness is not a concern.
const staticLocaleRef: { locale: Locale; timezone: string | undefined } = {
  locale: "es",
  timezone: undefined,
}

function syncStaticLocale() {
  setStaticLocale(staticLocaleRef.locale, staticLocaleRef.timezone)
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ["business-settings"],
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    staleTime: 60_000,
  })
  const [locale, setLocaleState] = useState<Locale>(() =>
    toLocale(settings?.default_locale),
  )

  useEffect(() => {
    // The business default locale is the single source of truth (es -> es-AR,
    // en -> en-US); there is no per-user override.
    if (settings?.default_locale) {
      setLocaleState(toLocale(settings.default_locale))
    }
  }, [settings])

  staticLocaleRef.locale = locale
  staticLocaleRef.timezone = settings?.timezone ?? undefined
  useEffect(syncStaticLocale)

  const value = useMemo(
    () => ({
      locale,
      numberFormat: numberFormatFor(locale),
      timezone: settings?.timezone ?? undefined,
    }),
    [locale, settings],
  )

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider
        locale={LOCALE_TAGS[locale]}
        messages={catalogs[locale]}
        defaultLocale="es"
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  )
}

export const useLocale = () => useContext(LocaleContext)

export function useT() {
  const { formatMessage } = useIntl()
  return useMemo(
    () => (id: MessageId, values?: Record<string, string | number>) =>
      formatMessage({ id }, values as never),
    [formatMessage],
  )
}
