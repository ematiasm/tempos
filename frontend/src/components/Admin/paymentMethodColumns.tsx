import type { ColumnDef } from "@tanstack/react-table"

import type { PaymentMethodPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { PaymentMethodActionsMenu } from "./PaymentMethodActionsMenu"

export type PaymentMethodTableData = PaymentMethodPublic & {
  account_name?: string
}

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<PaymentMethodTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "account_name",
      header: t("admin.finance.financialAccount"),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.account_name ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "marks_paid",
      header: t("admin.finance.paymentBehavior"),
      cell: ({ row }) =>
        row.original.marks_paid === false ? (
          <Badge variant="outline" className="text-xs">
            {t("admin.finance.currentAccount")}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      accessorKey: "requiere_conciliacion",
      header: t("admin.finance.conciliation"),
      cell: ({ row }) =>
        row.original.requiere_conciliacion ? (
          <Badge variant="outline" className="text-xs">
            {t("admin.finance.requires")}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <PaymentMethodActionsMenu paymentMethod={row.original} />
        </div>
      ),
    },
  ]
}
