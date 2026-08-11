import type { ColumnDef } from "@tanstack/react-table"

import type { CustomerPublic } from "@/client"
import { CONSUMIDOR_FINAL_NAME } from "@/components/Common/conditionOptions"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { CustomerActionsMenu } from "./CustomerActionsMenu"

export type CustomerTableData = CustomerPublic

const money = (value: string | number) => `$${Number(value).toFixed(2)}`

export function getColumns(
  t: ReturnType<typeof useT>,
  onOpen?: (customer: CustomerTableData) => void,
): ColumnDef<CustomerTableData>[] {
  return [
    {
      accessorKey: "razon_social",
      header: t("common.name"),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onOpen?.(row.original)}
          className="font-medium flex items-center gap-2 text-left hover:underline cursor-pointer"
        >
          {row.original.razon_social}
          {row.original.razon_social === CONSUMIDOR_FINAL_NAME && (
            <Badge variant="outline" className="text-xs">
              {t("customers.default")}
            </Badge>
          )}
        </button>
      ),
    },
    {
      accessorKey: "documento",
      header: t("customers.document"),
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-sm">
          {row.original.documento ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "condicion_fiscal",
      header: t("customers.taxCondition"),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.condicion_fiscal}
        </Badge>
      ),
    },
    {
      accessorKey: "phone",
      header: t("customers.phone"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.phone ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "saldo",
      header: () => <div className="text-right">{t("customers.balance")}</div>,
      cell: ({ row }) => {
        const saldo = Number(row.original.saldo)
        return (
          <div
            className={cn(
              "text-right font-mono text-sm",
              saldo > 0 && "text-destructive",
              saldo < 0 && "text-green-600",
            )}
          >
            {money(saldo)}
          </div>
        )
      },
    },
    {
      accessorKey: "limite_credito",
      header: () => (
        <div className="text-right">{t("customers.creditLimit")}</div>
      ),
      cell: ({ row }) => (
        <div className="text-right text-muted-foreground text-sm">
          {Number(row.original.limite_credito ?? 0) === 0
            ? t("customers.noLimit")
            : money(row.original.limite_credito ?? 0)}
        </div>
      ),
    },
    {
      accessorKey: "is_active",
      header: t("common.status"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              row.original.is_active ? "bg-green-500" : "bg-gray-400",
            )}
          />
          <span
            className={row.original.is_active ? "" : "text-muted-foreground"}
          >
            {row.original.is_active ? t("common.active") : t("common.inactive")}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <CustomerActionsMenu customer={row.original} />
        </div>
      ),
    },
  ]
}
