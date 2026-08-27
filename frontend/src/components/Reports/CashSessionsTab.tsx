import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Eye } from "lucide-react"
import { useState } from "react"

import {
  type CashSessionPublic,
  type CashSessionStatus,
  CashSessionsService,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { CashSessionReportDialog } from "@/components/Reports/CashSessionReportView"
import { money } from "@/components/Reports/reportFormat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

function ReportDialog({ session }: { session: CashSessionPublic }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const { data: report } = useQuery({
    queryFn: () =>
      CashSessionsService.readCashSessionReport({
        cashSessionId: session.id,
      }),
    queryKey: ["cash-sessions-report", session.id],
    enabled: open,
  })
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye className="mr-2 h-4 w-4" />
        {t("cash.viewReport")}
      </Button>
      {report && (
        <CashSessionReportDialog
          report={report}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}

export function CashSessionsTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const [status, setStatus] = useState<CashSessionStatus | "all">("all")

  const { data, isLoading } = useQuery({
    queryFn: () =>
      CashSessionsService.readCashSessions({
        limit: 100,
        status: status === "all" ? null : status,
      }),
    queryKey: ["cash-sessions", status],
  })
  const rows = data?.data ?? []

  const columns: ColumnDef<CashSessionPublic>[] = [
    {
      accessorKey: "opened_at",
      header: t("cash.openedAtShort"),
      cell: ({ row }) => new Date(row.original.opened_at).toLocaleString(),
    },
    {
      accessorKey: "closed_at",
      header: t("cash.closedAtShort"),
      cell: ({ row }) =>
        row.original.closed_at
          ? new Date(row.original.closed_at).toLocaleString()
          : "—",
    },
    {
      accessorKey: "opened_by_name",
      header: t("cash.openedBy"),
      cell: ({ row }) => row.original.opened_by_name ?? "—",
    },
    {
      accessorKey: "opening_amount",
      header: t("cash.openingAmountLabel"),
      cell: ({ row }) => money(row.original.opening_amount, numberFormat),
    },
    {
      accessorKey: "expected_amount",
      header: t("cash.expected"),
      cell: ({ row }) => money(row.original.expected_amount, numberFormat),
    },
    {
      accessorKey: "counted_amount",
      header: t("cash.counted"),
      cell: ({ row }) => money(row.original.counted_amount, numberFormat),
    },
    {
      accessorKey: "difference",
      header: t("cash.difference"),
      cell: ({ row }) => {
        const diff = Number(row.original.difference)
        return (
          <span
            className={cn(
              "font-medium",
              diff < 0 && "text-red-600",
              diff > 0 && "text-emerald-600",
            )}
          >
            {money(row.original.difference, numberFormat)}
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) =>
        row.original.status === "closed" ? (
          <Badge variant="outline">{t("cash.statusClosed")}</Badge>
        ) : (
          <Badge variant="secondary">{t("cash.statusOpen")}</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <ReportDialog session={row.original} />,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("cash.tabHint")}</p>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as CashSessionStatus | "all")}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder={t("common.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="open">{t("cash.statusOpen")}</SelectItem>
            <SelectItem value="closed">{t("cash.statusClosed")}</SelectItem>
          </SelectContent>
        </Select>
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

export default CashSessionsTab
