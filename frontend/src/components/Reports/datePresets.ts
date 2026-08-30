import type { DateRangeValue } from "@/components/Reports/reportFormat"

export type DatePresetName =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"

const pad = (n: number): string => String(n).padStart(2, "0")

/** "YYYY-MM-DD" for a UTC-shifted pseudo date. */
const iso = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

const addDays = (d: Date, days: number): Date => {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** Last day of the month containing `d`, as a UTC-shifted pseudo date. */
const endOfMonth = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))

/**
 * Returns the IANA zone when Intl accepts it, undefined otherwise so callers
 * fall back to the browser-local zone.
 */
export function safeTimeZone(
  tz: string | null | undefined,
): string | undefined {
  if (!tz) return undefined
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

/**
 * Calendar date of "now" as observed from `timeZone`, expressed as a UTC
 * shifted pseudo date. All preset arithmetic runs on this value (never on the
 * real instant), so day/month math cannot cross a DST edge of the zone.
 */
const tzToday = (timeZone: string | undefined): Date => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value)
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")))
}

/**
 * Compute a preset range for the given IANA timezone (undefined = browser
 * local). Week presets start on Monday; month presets span the whole calendar
 * month.
 */
export function presetRange(
  name: DatePresetName,
  timeZone?: string,
): DateRangeValue {
  const today = tzToday(timeZone)
  switch (name) {
    case "today":
      return { desde: iso(today), hasta: iso(today) }
    case "yesterday": {
      const yesterday = addDays(today, -1)
      return { desde: iso(yesterday), hasta: iso(yesterday) }
    }
    case "thisWeek": {
      // Pseudo-date getUTCDay(): 0 = Sunday .. 6 = Saturday.
      const monday = addDays(today, -((today.getUTCDay() + 6) % 7))
      return { desde: iso(monday), hasta: iso(addDays(monday, 6)) }
    }
    case "thisMonth": {
      const first = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      )
      return { desde: iso(first), hasta: iso(endOfMonth(first)) }
    }
    case "lastMonth": {
      // Month index -1 rolls back through January via Date.UTC normalization.
      const first = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
      )
      return { desde: iso(first), hasta: iso(endOfMonth(first)) }
    }
  }
}

/** Current-month range — the first-render default of the report tabs. */
export function thisMonthRange(timeZone?: string): DateRangeValue {
  return presetRange("thisMonth", timeZone)
}
