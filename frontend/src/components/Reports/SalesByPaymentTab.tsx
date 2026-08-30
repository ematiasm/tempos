import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { SalesByPaymentRow } from "@/client"
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
import { type DateRangeValue, money } from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export function SalesByPaymentTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  const { settings } = useBusinessSettings()
  // GET /reports/sales-by-payment requires report.view; without it the query
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
      ReportsService.salesByPayment({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "sales-by-payment", range],
    enabled: canView,
  })
  const rows = data ?? []

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.method"),
    t("reports.payments"),
    t("reports.amount"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  const exportCsv = () =>
    downloadCsv(
      csvFilename("ventas-por-metodo", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        r.marks_paid
          ? r.method_name
          : `${r.method_name} (${t("reports.onCredit")})`,
        r.count,
        csvMoney(r.monto),
      ]),
    )

  const columns: ColumnDef<SalesByPaymentRow>[] = [
    {
      accessorKey: "method_name",
      header: headerLabels[0],
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {row.original.method_name}
          {!row.original.marks_paid && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs">
              {t("reports.onCredit")}
            </Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: "count",
      header: headerLabels[1],
      cell: ({ row }) => row.original.count,
    },
    {
      accessorKey: "monto",
      header: headerLabels[2],
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.monto, numberFormat)}
        </span>
      ),
    },
  ]

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.monto), 0)
  const totalPayments = rows.reduce((acc, r) => acc + r.count, 0)
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
              <span>{t("reports.paymentCount", { count: totalPayments })}</span>
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
        title={t("reports.tabPaymentMethods")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              r.marks_paid
                ? r.method_name
                : `${r.method_name} (${t("reports.onCredit")})`,
              String(r.count),
              money(r.monto, numberFormat),
            ]),
            totals: [
              { label: t("reports.payments"), value: String(totalPayments) },
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
