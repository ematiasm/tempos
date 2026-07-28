import type { ColumnDef } from "@tanstack/react-table"

import type { DocumentTypePublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { DocumentTypeActionsMenu } from "./DocumentTypeActionsMenu"

export type DocumentTypeTableData = DocumentTypePublic

const sign = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `${value}` : "0"

export const columns: ColumnDef<DocumentTypeTableData>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "prefix",
    header: "Prefix",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-sm">
        {row.original.prefix}
      </span>
    ),
  },
  {
    accessorKey: "operation",
    header: "Operation",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs capitalize">
        {row.original.operation}
      </Badge>
    ),
  },
  {
    accessorKey: "signo_stock",
    header: () => <div className="text-center">Stock</div>,
    cell: ({ row }) => (
      <div className="text-center font-mono text-sm">
        {sign(row.original.signo_stock)}
      </div>
    ),
  },
  {
    accessorKey: "signo_caja",
    header: () => <div className="text-center">Cash</div>,
    cell: ({ row }) => (
      <div className="text-center font-mono text-sm">
        {sign(row.original.signo_caja)}
      </div>
    ),
  },
  {
    accessorKey: "es_fiscal",
    header: "Fiscal",
    cell: ({ row }) =>
      row.original.es_fiscal ? (
        <Badge variant="outline" className="text-xs">
          Fiscal
        </Badge>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
  },
  {
    accessorKey: "tipo_contraparte",
    header: "Counterpart",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm capitalize">
        {row.original.tipo_contraparte ?? "—"}
      </span>
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
        <DocumentTypeActionsMenu documentType={row.original} />
      </div>
    ),
  },
]
