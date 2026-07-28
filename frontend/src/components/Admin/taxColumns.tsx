import type { ColumnDef } from "@tanstack/react-table"

import type { TaxPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { TaxActionsMenu } from "./TaxActionsMenu"

export type TaxTableData = TaxPublic

export const columns: ColumnDef<TaxTableData>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-sm">
        {row.original.code}
      </span>
    ),
  },
  {
    accessorKey: "tipo",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.original.tipo}
      </Badge>
    ),
  },
  {
    accessorKey: "rate",
    header: "Rate",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.is_percent
          ? `${Number(row.original.rate).toFixed(2)}%`
          : `$${Number(row.original.rate).toFixed(2)}`}
      </span>
    ),
  },
  {
    accessorKey: "aplica_a",
    header: "Applies to",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm capitalize">
        {row.original.aplica_a ?? "linea"}
      </span>
    ),
  },
  {
    accessorKey: "is_default",
    header: "Default",
    cell: ({ row }) =>
      row.original.is_default ? (
        <Badge variant="outline" className="text-xs">
          Default
        </Badge>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
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
        <TaxActionsMenu tax={row.original} />
      </div>
    ),
  },
]
