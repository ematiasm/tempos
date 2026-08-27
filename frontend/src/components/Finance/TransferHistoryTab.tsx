import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import type { TransferPublic } from "@/client"
import { FinancialAccountsService, TransfersService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReportDateRange } from "@/components/Reports/ReportDateRange"
import { type DateRangeValue, money } from "@/components/Reports/reportFormat"
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

interface TransferHistoryTabProps {
  accountId?: string | null
  onAccountIdChange: (accountId?: string) => void
}

export function TransferHistoryTab({
  accountId,
  onAccountIdChange,
}: TransferHistoryTabProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const [range, setRange] = useState<DateRangeValue>({})

  const { data: accountsData } = useQuery({
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
  })
  const accounts = accountsData?.data ?? []
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name

  const { data, isLoading } = useQuery({
    queryFn: () => TransfersService.readTransfers({ skip: 0, limit: 200 }),
    queryKey: ["transfers"],
  })

  const rows = useMemo(() => {
    let list = data?.data ?? []
    if (accountId) {
      list = list.filter(
        (x) => x.from_account_id === accountId || x.to_account_id === accountId,
      )
    }
    if (range.desde) {
      list = list.filter((x) => (x.fecha ?? "").slice(0, 10) >= range.desde!)
    }
    if (range.hasta) {
      list = list.filter((x) => (x.fecha ?? "").slice(0, 10) <= range.hasta!)
    }
    return list
  }, [data?.data, accountId, range])

  const columns: ColumnDef<TransferPublic>[] = [
    {
      accessorKey: "fecha",
      header: t("reports.date"),
      cell: ({ row }) => (row.original.fecha ?? "").slice(0, 10),
    },
    {
      accessorKey: "from_account_id",
      header: t("finance.fromAccount"),
      cell: ({ row }) => accountName(row.original.from_account_id) ?? "—",
    },
    {
      accessorKey: "to_account_id",
      header: t("finance.toAccount"),
      cell: ({ row }) => accountName(row.original.to_account_id) ?? "—",
    },
    {
      accessorKey: "monto",
      header: t("common.amount"),
      cell: ({ row }) => (
        <span className="font-mono font-medium">
          {money(row.original.monto, numberFormat)}
        </span>
      ),
    },
    {
      accessorKey: "descripcion",
      header: t("common.description"),
      cell: ({ row }) => row.original.descripcion ?? "—",
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <ReportDateRange value={range} onChange={setRange} />
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="transfer-account"
            className="text-xs text-muted-foreground"
          >
            {t("reports.account")}
          </Label>
          <Select
            value={accountId ?? "all"}
            onValueChange={(v) =>
              onAccountIdChange(v === "all" ? undefined : v)
            }
          >
            <SelectTrigger id="transfer-account" className="h-9 w-[200px]">
              <SelectValue placeholder={t("reports.allAccounts")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.allAccounts")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </div>
  )
}
