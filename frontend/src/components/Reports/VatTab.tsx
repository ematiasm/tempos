import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { VatRow } from "@/client"
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
} from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
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
  const { settings } = useBusinessSettings()
  // GET /reports/vat requires report.view; without it the query does not
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
      ReportsService.vatReport({
        desde: range.desde ?? null,
        hasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "vat", range],
    enabled: canView,
  })
  const rows = data ?? []

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.code"),
    t("reports.name"),
    t("reports.type"),
    t("reports.rate"),
    t("reports.appliesTo"),
    t("reports.base"),
    t("reports.amount"),
    t("reports.entries"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  // Flat CSV: one list including the applies_to column.
  const exportCsv = () =>
    downloadCsv(
      csvFilename("impuestos", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        r.tax_code ?? "",
        r.tax_name ?? "",
        r.tipo ?? "",
        csvNumber(r.rate),
        r.applies_to ?? "",
        csvMoney(r.base),
        csvMoney(r.monto),
        r.count,
      ]),
    )

  const columns: ColumnDef<VatRow>[] = [
    { accessorKey: "tax_code", header: headerLabels[0] },
    { accessorKey: "tax_name", header: headerLabels[1] },
    {
      accessorKey: "tipo",
      header: headerLabels[2],
      cell: ({ row }) => <Badge variant="secondary">{row.original.tipo}</Badge>,
    },
    {
      accessorKey: "rate",
      header: headerLabels[3],
      cell: ({ row }) =>
        row.original.is_percent
          ? pct(row.original.rate)
          : money(row.original.rate, numberFormat),
    },
    {
      accessorKey: "applies_to",
      header: headerLabels[4],
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applies_to}</Badge>
      ),
    },
    {
      accessorKey: "base",
      header: headerLabels[5],
      cell: ({ row }) => money(row.original.base, numberFormat),
    },
    {
      accessorKey: "monto",
      header: headerLabels[6],
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.monto, numberFormat)}
        </span>
      ),
    },
    { accessorKey: "count", header: headerLabels[7] },
  ]

  const totalTax = rows.reduce((acc, r) => acc + Number(r.monto), 0)
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
              {t("reports.totalTaxes", {
                amount: money(totalTax, numberFormat),
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
        title={t("reports.tabTaxes")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              r.tax_code ?? "—",
              r.tax_name ?? "—",
              r.tipo ?? "—",
              r.is_percent ? pct(r.rate) : money(r.rate, numberFormat),
              r.applies_to ?? "—",
              money(r.base, numberFormat),
              money(r.monto, numberFormat),
              String(r.count),
            ]),
            totals: [
              {
                label: t("reports.taxesTotal"),
                value: money(totalTax, numberFormat),
              },
            ],
          },
        ]}
      />
    </div>
  )
}
