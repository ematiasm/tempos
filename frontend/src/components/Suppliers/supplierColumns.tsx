import type { ColumnDef } from "@tanstack/react-table"

import type { SupplierPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { SupplierActionsMenu } from "./SupplierActionsMenu"

export type SupplierTableData = SupplierPublic

export const columns: ColumnDef<SupplierTableData>[] = [
  {
    accessorKey: "razon_social",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.razon_social}</span>
    ),
  },
  {
    accessorKey: "documento",
    header: "Document",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-sm">
        {row.original.documento ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "condicion_fiscal",
    header: "Tax Condition",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.original.condicion_fiscal}
      </Badge>
    ),
  },
  {
    accessorKey: "phone",
    header: "Phone",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.phone ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "saldo",
    header: () => <div className="text-right">Balance</div>,
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
    header: "Status",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            row.original.is_active ? "bg-green-500" : "bg-gray-400",
          )}
        />
        <span className={row.original.is_active ? "" : "text-muted-foreground"}>
          {row.original.is_active ? "Active" : "Inactive"}
        </span>
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <SupplierActionsMenu supplier={row.original} />
      </div>
    ),
  },
]
