import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { VatRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import {
  type DateRangeValue,
  money,
  pct,
} from "@/components/Reports/reportFormat"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export function VatTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  // GET /reports/vat requires report.view; without it the query does not
  // fire and the tab renders its empty state (no 403 toast).
  const canView = hasPermission(user, "report.view")
  const [range, setRange] = useState<DateRangeValue>({})

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.vatReport({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "vat", range],
    enabled: canView,
  })
  const rows = data ?? []

  const columns: ColumnDef<VatRow>[] = [
    { accessorKey: "tax_code", header: t("reports.code") },
    { accessorKey: "tax_name", header: t("reports.name") },
    {
      accessorKey: "tipo",
      header: t("reports.type"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.tipo}</Badge>,
    },
    {
      accessorKey: "rate",
      header: t("reports.rate"),
      cell: ({ row }) =>
        row.original.is_percent
          ? pct(row.original.rate)
          : money(row.original.rate, numberFormat),
    },
    {
      accessorKey: "applies_to",
      header: t("reports.appliesTo"),
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applies_to}</Badge>
      ),
    },
    {
      accessorKey: "base",
      header: t("reports.base"),
      cell: ({ row }) => money(row.original.base, numberFormat),
    },
    {
      accessorKey: "monto",
      header: t("reports.amount"),
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.monto, numberFormat)}
        </span>
      ),
    },
    { accessorKey: "count", header: t("reports.entries") },
  ]

  const totalTax = rows.reduce((acc, r) => acc + Number(r.monto), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        {!isLoading && rows.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {t("reports.totalTaxes", { amount: money(totalTax, numberFormat) })}
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
