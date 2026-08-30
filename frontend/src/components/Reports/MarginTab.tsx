import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { MarginRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import {
  csvDate,
  csvFilename,
  csvMoney,
  csvNumber,
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
  qty,
} from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export function MarginTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  const { settings } = useBusinessSettings()
  // GET /reports/margin requires report.view; without it the query does not
  // fire and the tab renders its empty state (no 403 toast).
  const canView = hasPermission(user, "report.view")
  // Defaults to the current month on first render only (business timezone
  // when the setting is already loaded, browser-local otherwise). The state
  // initializer runs once, so user edits are never overwritten.
  const [range, setRange] = useState<DateRangeValue>(() =>
    thisMonthRange(safeTimeZone(settings?.timezone)),
  )

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.marginReport({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "margin", range],
    enabled: canView,
  })
  const rows = data ?? []

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.product"),
    t("reports.units"),
    t("reports.revenue"),
    t("reports.cost"),
    t("reports.margin"),
    t("reports.marginPct"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  const exportCsv = () =>
    downloadCsv(
      csvFilename("margen", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        r.name,
        csvNumber(r.units),
        csvMoney(r.revenue),
        csvMoney(r.cost),
        csvMoney(r.margin),
        csvNumber(r.margin_pct),
      ]),
    )

  const columns: ColumnDef<MarginRow>[] = [
    { accessorKey: "name", header: headerLabels[0] },
    {
      accessorKey: "units",
      header: headerLabels[1],
      cell: ({ row }) => qty(row.original.units),
    },
    {
      accessorKey: "revenue",
      header: headerLabels[2],
      cell: ({ row }) => money(row.original.revenue, numberFormat),
    },
    {
      accessorKey: "cost",
      header: headerLabels[3],
      cell: ({ row }) => money(row.original.cost, numberFormat),
    },
    {
      accessorKey: "margin",
      header: headerLabels[4],
      cell: ({ row }) => (
        <span className={Number(row.original.margin) < 0 ? "text-red-600" : ""}>
          {money(row.original.margin, numberFormat)}
        </span>
      ),
    },
    {
      accessorKey: "margin_pct",
      header: headerLabels[5],
      cell: ({ row }) => pct(row.original.margin_pct),
    },
  ]

  const totalMargin = rows.reduce((acc, r) => acc + Number(r.margin), 0)
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
            <span className="text-sm text-muted-foreground">
              {t("reports.totalMargin", {
                margin: money(totalMargin, numberFormat),
              })}
            </span>
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
        title={t("reports.tabMargin")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              r.name,
              qty(r.units),
              money(r.revenue, numberFormat),
              money(r.cost, numberFormat),
              money(r.margin, numberFormat),
              pct(r.margin_pct),
            ]),
            totals: [
              {
                label: t("reports.margin"),
                value: money(totalMargin, numberFormat),
              },
            ],
          },
        ]}
      />
    </div>
  )
}
