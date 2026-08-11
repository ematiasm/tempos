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
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "es",
  setLocale: () => {},
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale)

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale: setLocaleState }), [locale])

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
