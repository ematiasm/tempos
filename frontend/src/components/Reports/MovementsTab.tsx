import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useEffect, useState } from "react"
import type { AccountMovementPublic } from "@/client"
import { AccountMovementsService, FinancialAccountsService } from "@/client"
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
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useT } from "@/i18n"
import { moneyStatic } from "@/lib/format"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface MovementsTabProps {
  initialAccountId?: string
}

export function MovementsTab({ initialAccountId }: MovementsTabProps) {
  const t = useT()
  const { user } = useAuth()
  const { settings } = useBusinessSettings()
  // Both endpoints (financial accounts and account movements) require
  // finance.read; without it the queries do not fire and the tab renders its
  // empty state (no 403 toast).
  const canRead = hasPermission(user, "finance.read")
  // Defaults to the current month on first render only (business timezone
  // when the setting is already loaded, browser-local otherwise). The state
  // initializer runs once, so user edits are never overwritten.
  const [range, setRange] = useState<DateRangeValue>(() =>
    thisMonthRange(safeTimeZone(settings?.timezone)),
  )
  const [accountId, setAccountId] = useState<string | undefined>(
    initialAccountId,
  )

  useEffect(() => {
    if (initialAccountId !== undefined) {
      setAccountId(initialAccountId)
    }
  }, [initialAccountId])

  const { data: accounts } = useQuery({
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
    enabled: canRead,
  })

  const { data, isLoading } = useQuery({
    queryFn: () =>
      AccountMovementsService.readAccountMovements({
        limit: 200,
        financialAccountId: accountId ?? null,
        fechaDesde: range.desde ?? null,
        fechaHasta: range.hasta ?? null,
      }),
    queryKey: ["reports", "movements", range, accountId],
    enabled: canRead,
  })
  const rows = data?.data ?? []
  const accountName = accounts?.data.find((a) => a.id === accountId)?.name

  // CSV export and the printable view reuse the table's translated column
  // names, in column order.
  const headerLabels = [
    t("reports.date"),
    t("reports.account"),
    t("reports.document"),
    t("reports.method"),
    t("reports.counterpart"),
    t("reports.type"),
    t("reports.amount"),
    t("reports.status"),
  ]
  const [printOpen, setPrintOpen] = useState(false)

  // Exports exactly the rows the gated query loaded (this endpoint is fetched
  // with limit: 200, so a range with more movements under-exports by design
  // of the query window, never silently more than what is on screen).
  const exportCsv = () =>
    downloadCsv(
      csvFilename("movimientos", range.desde, range.hasta),
      headerLabels,
      rows.map((r) => [
        csvDate(r.fecha),
        r.account_name ?? "",
        r.document_numero ?? "",
        r.payment_method_name ?? "",
        r.counterpart_name ?? "",
        r.tipo ?? "",
        csvMoney(r.monto),
        r.conciliado ? t("reports.conciliated") : t("reports.pending"),
      ]),
    )

  const columns: ColumnDef<AccountMovementPublic>[] = [
    {
      accessorKey: "fecha",
      header: headerLabels[0],
      cell: ({ row }) => (row.original.fecha ?? "").slice(0, 10),
    },
    {
      accessorKey: "account_name",
      header: headerLabels[1],
      cell: ({ row }) => row.original.account_name ?? "—",
    },
    {
      accessorKey: "document_numero",
      header: headerLabels[2],
      cell: ({ row }) => row.original.document_numero ?? "—",
    },
    {
      accessorKey: "payment_method_name",
      header: headerLabels[3],
      cell: ({ row }) => row.original.payment_method_name ?? "—",
    },
    {
      accessorKey: "counterpart_name",
      header: headerLabels[4],
      cell: ({ row }) => row.original.counterpart_name ?? "—",
    },
    {
      accessorKey: "tipo",
      header: headerLabels[5],
      cell: ({ row }) => <Badge variant="secondary">{row.original.tipo}</Badge>,
    },
    {
      accessorKey: "monto",
      header: headerLabels[6],
      cell: ({ row }) => (
        <span
          className={cn(
            "font-medium",
            Number(row.original.monto) >= 0
              ? "text-emerald-600"
              : "text-red-600",
          )}
        >
          {moneyStatic(row.original.monto)}
        </span>
      ),
    },
    {
      accessorKey: "conciliado",
      header: headerLabels[7],
      cell: ({ row }) =>
        row.original.conciliado ? (
          <Badge variant="outline">{t("reports.conciliated")}</Badge>
        ) : (
          <Badge variant="secondary">{t("reports.pending")}</Badge>
        ),
    },
  ]

  const total = rows.reduce((acc, r) => acc + Number(r.monto), 0)
  const inflows = rows
    .filter((r) => Number(r.monto) > 0)
    .reduce((acc, r) => acc + Number(r.monto), 0)
  const outflows = rows
    .filter((r) => Number(r.monto) < 0)
    .reduce((acc, r) => acc + Number(r.monto), 0)
  const periodLabel = [range.desde, range.hasta]
    .filter(Boolean)
    .map(csvDate)
    .join(" — ")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="movements-account"
            className="text-xs text-muted-foreground"
          >
            Account
          </Label>
          <Select
            value={accountId ?? "all"}
            onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}
          >
            <SelectTrigger id="movements-account" className="h-9 w-[200px]">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.allAccounts")}</SelectItem>
              {(accounts?.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({moneyStatic(a.saldo)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isLoading && rows.length > 0 && (
          <div className="flex flex-col gap-0.5 pb-1 text-xs text-muted-foreground">
            <span className="text-emerald-600">
              {t("reports.in", { amount: moneyStatic(inflows) })}
            </span>
            <span className="text-red-600">
              {t("reports.out", { amount: moneyStatic(outflows) })}
            </span>
            <span className="font-semibold text-foreground">
              {t("reports.net", { amount: moneyStatic(total) })}{" "}
              {accountName ? `· ${accountName}` : ""}
            </span>
          </div>
        )}
        <div className="ml-auto pb-1">
          <ReportActions
            hasRows={rows.length > 0}
            onExportCsv={exportCsv}
            onPrint={() => setPrintOpen(true)}
          />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </CardContent>
      </Card>
      <ReportPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={t("reports.tabMovements")}
        period={periodLabel}
        sections={[
          {
            headers: headerLabels,
            rows: rows.map((r) => [
              csvDate(r.fecha),
              r.account_name ?? "—",
              r.document_numero ?? "—",
              r.payment_method_name ?? "—",
              r.counterpart_name ?? "—",
              r.tipo ?? "—",
              moneyStatic(r.monto),
              r.conciliado ? t("reports.conciliated") : t("reports.pending"),
            ]),
            totals: [
              {
                label: t("reports.inflows"),
                value: moneyStatic(inflows),
              },
              {
                label: t("reports.outflows"),
                value: moneyStatic(outflows),
              },
              {
                label: t("reports.netTotal"),
                value: moneyStatic(total),
              },
            ],
          },
        ]}
      />
    </div>
  )
}
