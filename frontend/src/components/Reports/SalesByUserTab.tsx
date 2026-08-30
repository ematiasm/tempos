import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { SalesByUserRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import {
  csvDate,
  csvFilename,
  csvMoney,
  downloadCsv,
} from "@/components/Reports/csv"
import { safeTimeZone, thisMonthRange } from "@/components/Reports/datePresets"
import { ReportActions } from "@/components/Reports/ReportActions"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import { ReportPrintDialog } from "@/components/Reports/ReportPrintDialog"
import {
  type DateRangeValue,
  money,
  pct,
} from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export function SalesByUserTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  const { settings } = useBusinessSettings()
  // GET /reports/sales-by-user requires report.view; without it the query
  // does not fire and the tab renders its empty state (no 403 toast).
  const canView = hasPermission(user, "report.view")
  // Defaults to the current month on first render only (business timezone
  // when the setting is already loaded, browser-local otherwise). The state
  // initializer runs once, so user edits are never overwritten.
  const [range, setRange] = useState<DateRangeValue>(() =>
    thisMonthRange(safeTimeZone(settings?.timezone)),
  )

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.salesByUser({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "sales-by-user", range],
    enabled: canView,
  })
  const rows = data ?? []
  const grandTotal = rows.reduce((acc, r) => acc + Number(r.total), 0)

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.cashier"),
    t("reports.sales"),
    t("reports.total"),
    t("reports.avgTicket"),
    t("reports.pctOfTotal"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  const exportCsv = () =>
    downloadCsv(
      csvFilename("ventas-por-cajero", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        r.user_name,
        r.count,
        csvMoney(r.total),
        r.count > 0 ? csvMoney(Number(r.total) / r.count) : "",
        grandTotal > 0 ? csvMoney((Number(r.total) / grandTotal) * 100) : "",
      ]),
    )

  const columns: ColumnDef<SalesByUserRow>[] = [
    {
      accessorKey: "user_name",
      header: headerLabels[0],
      cell: ({ row }) => row.original.user_name,
    },
    {
      accessorKey: "count",
      header: headerLabels[1],
      cell: ({ row }) => row.original.count,
    },
    {
      accessorKey: "total",
      header: headerLabels[2],
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.total, numberFormat)}
        </span>
      ),
    },
    {
      // Average ticket, derived client-side; hidden when the user has no sales.
      id: "avg_ticket",
      header: headerLabels[3],
      cell: ({ row }) =>
        row.original.count > 0
          ? money(Number(row.original.total) / row.original.count, numberFormat)
          : "—",
    },
    {
      // Share of the period's grand total, derived client-side.
      id: "pct_of_total",
      header: headerLabels[4],
      cell: ({ row }) =>
        grandTotal > 0
          ? pct((Number(row.original.total) / grandTotal) * 100)
          : "—",
    },
  ]

  const totalSales = rows.reduce((acc, r) => acc + r.count, 0)
  const periodLabel = [range.desde, range.hasta]
    .filter(Boolean)
    .map(csvDate)
    .join(" — ")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-3">
          {!isLoading && rows.length > 0 && (
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{t("reports.salesCount", { count: totalSales })}</span>
              <span className="font-semibold text-foreground">
                {t("reports.grandTotal", {
                  total: money(grandTotal, numberFormat),
                })}
              </span>
            </div>
          )}
          <ReportActions
            hasRows={rows.length > 0}
            onExportCsv={exportCsv}
            onPrint={() => setPrintOpen(true)}
          />
        </div>
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
      <ReportPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={t("reports.tabByUser")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              r.user_name,
              String(r.count),
              money(r.total, numberFormat),
              r.count > 0
                ? money(Number(r.total) / r.count, numberFormat)
                : "—",
              grandTotal > 0 ? pct((Number(r.total) / grandTotal) * 100) : "—",
            ]),
            totals: [
              { label: t("reports.sales"), value: String(totalSales) },
              {
                label: t("reports.total"),
                value: money(grandTotal, numberFormat),
              },
            ],
          },
        ]}
      />
    </div>
  )
}
