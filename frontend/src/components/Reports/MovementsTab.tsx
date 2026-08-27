import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useEffect, useState } from "react"
import type { AccountMovementPublic } from "@/client"
import { AccountMovementsService, FinancialAccountsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import { type DateRangeValue, money } from "@/components/Reports/reportFormat"
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
import { useLocale, useT } from "@/i18n"
import { cn } from "@/lib/utils"

interface MovementsTabProps {
  initialAccountId?: string
}

export function MovementsTab({ initialAccountId }: MovementsTabProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const [range, setRange] = useState<DateRangeValue>({})
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
  })
  const rows = data?.data ?? []
  const accountName = accounts?.data.find((a) => a.id === accountId)?.name

  const columns: ColumnDef<AccountMovementPublic>[] = [
    {
      accessorKey: "fecha",
      header: t("reports.date"),
      cell: ({ row }) => (row.original.fecha ?? "").slice(0, 10),
    },
    {
      accessorKey: "account_name",
      header: t("reports.account"),
      cell: ({ row }) => row.original.account_name ?? "—",
    },
    {
      accessorKey: "document_numero",
      header: t("reports.document"),
      cell: ({ row }) => row.original.document_numero ?? "—",
    },
    {
      accessorKey: "tipo",
      header: t("reports.type"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.tipo}</Badge>,
    },
    {
      accessorKey: "monto",
      header: t("reports.amount"),
      cell: ({ row }) => (
        <span
          className={cn(
            "font-medium",
            Number(row.original.monto) >= 0
              ? "text-emerald-600"
              : "text-red-600",
          )}
        >
          {money(row.original.monto, numberFormat)}
        </span>
      ),
    },
    {
      accessorKey: "conciliado",
      header: t("reports.status"),
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
                  {a.name} ({money(a.saldo, numberFormat)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isLoading && rows.length > 0 && (
          <div className="flex flex-col gap-0.5 pb-1 text-xs text-muted-foreground">
            <span className="text-emerald-600">
              {t("reports.in", { amount: money(inflows, numberFormat) })}
            </span>
            <span className="text-red-600">
              {t("reports.out", { amount: money(outflows, numberFormat) })}
            </span>
            <span className="font-semibold text-foreground">
              {t("reports.net", { amount: money(total, numberFormat) })}{" "}
              {accountName ? `· ${accountName}` : ""}
            </span>
          </div>
        )}
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
    </div>
  )
}
