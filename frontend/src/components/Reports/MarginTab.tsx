import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { MarginRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import {
  type DateRangeValue,
  money,
  pct,
  qty,
} from "@/components/Reports/reportFormat"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

export function MarginTab() {
  const t = useT()
  const [range, setRange] = useState<DateRangeValue>({})

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.marginReport({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "margin", range],
  })
  const rows = data ?? []

  const columns: ColumnDef<MarginRow>[] = [
    { accessorKey: "name", header: t("reports.product") },
    {
      accessorKey: "units",
      header: t("reports.units"),
      cell: ({ row }) => qty(row.original.units),
    },
    {
      accessorKey: "revenue",
      header: t("reports.revenue"),
      cell: ({ row }) => money(row.original.revenue),
    },
    {
      accessorKey: "cost",
      header: t("reports.cost"),
      cell: ({ row }) => money(row.original.cost),
    },
    {
      accessorKey: "margin",
      header: t("reports.margin"),
      cell: ({ row }) => (
        <span className={Number(row.original.margin) < 0 ? "text-red-600" : ""}>
          {money(row.original.margin)}
        </span>
      ),
    },
    {
      accessorKey: "margin_pct",
      header: t("reports.marginPct"),
      cell: ({ row }) => pct(row.original.margin_pct),
    },
  ]

  const totalMargin = rows.reduce((acc, r) => acc + Number(r.margin), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        {!isLoading && rows.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {t("reports.totalMargin", { margin: money(totalMargin) })}
          </span>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable columns={columns} data={rows} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
