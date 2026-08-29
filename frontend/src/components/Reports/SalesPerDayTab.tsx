import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { SalesPerDayRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import { type DateRangeValue, money } from "@/components/Reports/reportFormat"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export function SalesPerDayTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  // GET /reports/sales-per-day requires report.view; without it the query
  // does not fire and the tab renders its empty state (no 403 toast).
  const canView = hasPermission(user, "report.view")
  const [range, setRange] = useState<DateRangeValue>({})

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.salesPerDay({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "sales-per-day", range],
    enabled: canView,
  })
  const rows = data ?? []

  const columns: ColumnDef<SalesPerDayRow>[] = [
    { accessorKey: "fecha", header: t("reports.date") },
    {
      accessorKey: "count",
      header: t("reports.sales"),
      cell: ({ row }) => row.original.count,
    },
    {
      accessorKey: "subtotal",
      header: t("reports.subtotal"),
      cell: ({ row }) => money(row.original.subtotal, numberFormat),
    },
    {
      accessorKey: "descuento_total",
      header: t("reports.discount"),
      cell: ({ row }) => money(row.original.descuento_total, numberFormat),
    },
    {
      accessorKey: "total",
      header: t("reports.total"),
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.total, numberFormat)}
        </span>
      ),
    },
  ]

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.total), 0)
  const totalSales = rows.reduce((acc, r) => acc + r.count, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        {!isLoading && rows.length > 0 && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>
              {t("reports.salesDays", { sales: totalSales, days: rows.length })}
            </span>
            <span className="font-semibold text-foreground">
              {t("reports.grandTotal", {
                total: money(grandTotal, numberFormat),
              })}
            </span>
          </div>
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
