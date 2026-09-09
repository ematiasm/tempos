import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { SalesPerDayRow } from "@/client"
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
import type { DateRangeValue } from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useT } from "@/i18n"
import { moneyStatic } from "@/lib/format"
import { hasPermission } from "@/lib/permissions"

export function SalesPerDayTab() {
  const t = useT()
  const { user } = useAuth()
  const { settings } = useBusinessSettings()
  // GET /reports/sales-per-day requires report.view; without it the query
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
      ReportsService.salesPerDay({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "sales-per-day", range],
    enabled: canView,
  })
  const rows = data ?? []

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.date"),
    t("reports.sales"),
    t("reports.subtotal"),
    t("reports.discount"),
    t("reports.total"),
    t("reports.avgTicket"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  const exportCsv = () =>
    downloadCsv(
      csvFilename("ventas-por-dia", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        csvDate(r.fecha),
        r.count,
        csvMoney(r.subtotal),
        csvMoney(r.descuento_total),
        csvMoney(r.total),
        r.count > 0 ? csvMoney(Number(r.total) / r.count) : "",
      ]),
    )

  const columns: ColumnDef<SalesPerDayRow>[] = [
    { accessorKey: "fecha", header: headerLabels[0] },
    {
      accessorKey: "count",
      header: headerLabels[1],
      cell: ({ row }) => row.original.count,
    },
    {
      accessorKey: "subtotal",
      header: headerLabels[2],
      cell: ({ row }) => moneyStatic(row.original.subtotal),
    },
    {
      accessorKey: "descuento_total",
      header: headerLabels[3],
      cell: ({ row }) => moneyStatic(row.original.descuento_total),
    },
    {
      accessorKey: "total",
      header: headerLabels[4],
      cell: ({ row }) => (
        <span className="font-medium">{moneyStatic(row.original.total)}</span>
      ),
    },
    {
      // Average ticket for the day; hidden when the day has no sales.
      id: "avg_ticket",
      header: headerLabels[5],
      cell: ({ row }) =>
        row.original.count > 0
          ? moneyStatic(Number(row.original.total) / row.original.count)
          : "—",
    },
  ]

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.total), 0)
  const totalSales = rows.reduce((acc, r) => acc + r.count, 0)
  const avgTicket = totalSales > 0 ? grandTotal / totalSales : null
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
              <span>
                {t("reports.salesDays", {
                  sales: totalSales,
                  days: rows.length,
                })}
              </span>
              {avgTicket != null && (
                <span>
                  {t("reports.avgTicketTotal", {
                    amount: moneyStatic(avgTicket),
                  })}
                </span>
              )}
              <span className="font-semibold text-foreground">
                {t("reports.grandTotal", {
                  total: moneyStatic(grandTotal),
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
        title={t("reports.tabDaily")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              csvDate(r.fecha),
              String(r.count),
              moneyStatic(r.subtotal),
              moneyStatic(r.descuento_total),
              moneyStatic(r.total),
              r.count > 0 ? moneyStatic(Number(r.total) / r.count) : "—",
            ]),
            totals: [
              { label: t("reports.sales"), value: String(totalSales) },
              {
                label: t("reports.avgTicket"),
                value: avgTicket != null ? moneyStatic(avgTicket) : "—",
              },
              {
                label: t("reports.total"),
                value: moneyStatic(grandTotal),
              },
            ],
          },
        ]}
      />
    </div>
  )
}
