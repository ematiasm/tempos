import type { ColumnDef } from "@tanstack/react-table"

import type { SupplierPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { SupplierActionsMenu } from "./SupplierActionsMenu"

export type SupplierTableData = SupplierPublic

export function getColumns(
  t: ReturnType<typeof useT>,
  onOpen?: (supplier: SupplierTableData) => void,
): ColumnDef<SupplierTableData>[] {
  return [
    {
      accessorKey: "razon_social",
      header: t("common.name"),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onOpen?.(row.original)}
          className="font-medium text-left hover:underline cursor-pointer"
        >
          {row.original.razon_social}
        </button>
      ),
    },
    {
      accessorKey: "documento",
      header: t("suppliers.document"),
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-sm">
          {row.original.documento ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "condicion_fiscal",
      header: t("suppliers.taxCondition"),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.condicion_fiscal}
        </Badge>
      ),
    },
    {
      accessorKey: "phone",
      header: t("suppliers.phone"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.phone ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "saldo",
      header: () => <div className="text-right">{t("suppliers.balance")}</div>,
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
            ${saldo.toFixed(2)}
          </div>
        )
      },
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
          <SupplierActionsMenu supplier={row.original} />
        </div>
      ),
    },
  ]
}
