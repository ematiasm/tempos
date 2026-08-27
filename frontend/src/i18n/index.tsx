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
import type { NumberFormat } from "@/lib/format"
import { en } from "./messages/en"
import { es, type Messages } from "./messages/es"

export const LOCALE_KEY = "tempos.locale"

export const locales = ["es", "en"] as const
export type Locale = (typeof locales)[number]
export type MessageId = keyof Messages

const catalogs: Record<Locale, Messages> = { es, en }

export function getLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "es"
  } catch {
    return "es"
  }
}

export function hasStoredLocale(): boolean {
  try {
    return localStorage.getItem(LOCALE_KEY) !== null
  } catch {
    return false
  }
}

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

export function formatStatic(
  id: MessageId,
  values?: Record<string, string | number>,
): string {
  return format(getLocale(), id, values)
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  numberFormat: NumberFormat
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "es",
  setLocale: () => {},
  numberFormat: "en",
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ["business-settings"],
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    staleTime: 60_000,
  })
  const [locale, setLocaleState] = useState<Locale>(getLocale)

  useEffect(() => {
    // Apply the business default locale only when the user has not chosen one.
    if (!hasStoredLocale() && settings?.default_locale) {
      setLocaleState(settings.default_locale === "en" ? "en" : "es")
    }
  }, [settings])

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale: setLocaleState,
      numberFormat: settings?.number_format ?? "en",
    }),
    [locale, settings],
  )

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider
        locale={locale}
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
