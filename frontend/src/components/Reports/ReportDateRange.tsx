import {
  type DatePresetName,
  presetRange,
  safeTimeZone,
} from "@/components/Reports/datePresets"
import type { DateRangeValue } from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type MessageId, useT } from "@/i18n"

interface ReportDateRangeProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
}

const PRESETS: DatePresetName[] = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "lastMonth",
]

const PRESET_LABELS: Record<DatePresetName, MessageId> = {
  today: "reports.presetToday",
  yesterday: "reports.presetYesterday",
  thisWeek: "reports.presetThisWeek",
  thisMonth: "reports.presetThisMonth",
  lastMonth: "reports.presetLastMonth",
}

export function ReportDateRange({ value, onChange }: ReportDateRangeProps) {
  const t = useT()
  const { settings } = useBusinessSettings()
  // Presets resolve calendar days in the business timezone; falls back to the
  // browser-local zone when the setting is missing or invalid.
  const timeZone = safeTimeZone(settings?.timezone)
  const applyPreset = (name: DatePresetName) =>
    onChange(presetRange(name, timeZone))
  const set = (key: keyof DateRangeValue, next: string) =>
    onChange({ ...value, [key]: next || undefined })

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="desde" className="text-xs text-muted-foreground">
          {t("reports.from")}
        </Label>
        <Input
          id="desde"
          type="date"
          className="h-9 w-[150px]"
          value={value.desde ?? ""}
          onChange={(e) => set("desde", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hasta" className="text-xs text-muted-foreground">
          {t("reports.to")}
        </Label>
        <Input
          id="hasta"
          type="date"
          className="h-9 w-[150px]"
          value={value.hasta ?? ""}
          onChange={(e) => set("hasta", e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((name) => (
          <Button
            key={name}
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-2.5 text-xs"
            onClick={() => applyPreset(name)}
          >
            {t(PRESET_LABELS[name])}
          </Button>
        ))}
      </div>
    </div>
  )
}
