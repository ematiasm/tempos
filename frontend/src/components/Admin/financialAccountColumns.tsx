import type { ColumnDef } from "@tanstack/react-table"

import type { FinancialAccountPublic } from "@/client"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { FinancialAccountActionsMenu } from "./FinancialAccountActionsMenu"
import { formatMoney } from "./financeOptions"

export type FinancialAccountTableData = FinancialAccountPublic

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<FinancialAccountTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "saldo",
      header: t("admin.finance.balance"),
      cell: ({ row }) => {
        const value = Number(row.original.saldo)
        return (
          <span
            className={cn(
              "font-mono text-sm",
              value < 0
                ? "text-destructive"
                : value > 0
                  ? "text-green-600"
                  : "",
            )}
          >
            {formatMoney(row.original.saldo)}
          </span>
        )
      },
    },
    {
      accessorKey: "currency",
      header: t("admin.finance.currency"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.currency}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <FinancialAccountActionsMenu account={row.original} />
        </div>
      ),
    },
  ]
}
