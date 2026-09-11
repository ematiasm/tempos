import { afterAll, describe, expect, setSystemTime, test } from "bun:test"
import {
  presetRange,
  safeTimeZone,
  thisMonthRange,
} from "@/components/Reports/datePresets"

afterAll(() => {
  setSystemTime()
})

describe("safeTimeZone", () => {
  test("keeps a zone Intl accepts", () => {
    expect(safeTimeZone("America/Argentina/Buenos_Aires")).toBe(
      "America/Argentina/Buenos_Aires",
    )
    expect(safeTimeZone("UTC")).toBe("UTC")
  })

  test("answers undefined so callers fall back to the browser zone", () => {
    expect(safeTimeZone("Mars/Olympus")).toBeUndefined()
    expect(safeTimeZone("not a zone")).toBeUndefined()
    expect(safeTimeZone(null)).toBeUndefined()
    expect(safeTimeZone(undefined)).toBeUndefined()
    expect(safeTimeZone("")).toBeUndefined()
  })
})

describe("presetRange", () => {
  // Friday 2026-09-11, 01:30 UTC — which is still 2026-09-10 in Buenos Aires.
  test("today is one day, taken from the calendar of the given zone", () => {
    setSystemTime(new Date("2026-09-11T01:30:00Z"))
    expect(presetRange("today", "UTC")).toEqual({
      desde: "2026-09-11",
      hasta: "2026-09-11",
    })
    // The same instant is a different business day three hours west, which is the whole
    // point of resolving the preset against the zone instead of the host clock.
    expect(presetRange("today", "America/Argentina/Buenos_Aires")).toEqual({
      desde: "2026-09-10",
      hasta: "2026-09-10",
    })
  })

  test("yesterday is the day before that", () => {
    setSystemTime(new Date("2026-09-11T01:30:00Z"))
    expect(presetRange("yesterday", "UTC")).toEqual({
      desde: "2026-09-10",
      hasta: "2026-09-10",
    })
  })

  test("this week runs Monday to Sunday", () => {
    setSystemTime(new Date("2026-09-11T01:30:00Z")) // a Friday
    expect(presetRange("thisWeek", "UTC")).toEqual({
      desde: "2026-09-07",
      hasta: "2026-09-13",
    })
  })

  test("on a Sunday the week still starts the Monday before it", () => {
    setSystemTime(new Date("2026-09-13T12:00:00Z")) // a Sunday
    expect(presetRange("thisWeek", "UTC")).toEqual({
      desde: "2026-09-07",
      hasta: "2026-09-13",
    })
  })

  test("this month spans the whole calendar month", () => {
    setSystemTime(new Date("2026-09-11T01:30:00Z"))
    expect(presetRange("thisMonth", "UTC")).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-30",
    })
    expect(thisMonthRange("UTC")).toEqual(presetRange("thisMonth", "UTC"))
  })

  test("last month rolls back over the year boundary", () => {
    setSystemTime(new Date("2026-01-15T12:00:00Z"))
    expect(presetRange("lastMonth", "UTC")).toEqual({
      desde: "2025-12-01",
      hasta: "2025-12-31",
    })
  })

  test("last month knows February's length", () => {
    setSystemTime(new Date("2024-03-05T12:00:00Z")) // a leap year
    expect(presetRange("lastMonth", "UTC")).toEqual({
      desde: "2024-02-01",
      hasta: "2024-02-29",
    })
  })
})
