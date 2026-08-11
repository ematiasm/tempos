import type { DateRangeValue } from "@/components/Reports/reportFormat"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/i18n"

interface ReportDateRangeProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
}

export function ReportDateRange({ value, onChange }: ReportDateRangeProps) {
  const t = useT()
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
    </div>
  )
}
