import type { ColumnDef } from "@tanstack/react-table"
import { Eye } from "lucide-react"

import type { DocumentPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type DocumentTableData = DocumentPublic & {
  onView: (document: DocumentPublic) => void
}

const money = (value: string | number) => `$${Number(value).toFixed(2)}`

export const getColumns: ColumnDef<DocumentTableData>[] = [
  {
    accessorKey: "numero",
    header: "Number",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.numero}</span>
    ),
  },
  {
    accessorKey: "document_type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.original.document_type.name}
      </Badge>
    ),
  },
  {
    accessorKey: "fecha",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.fecha).toLocaleDateString("es-AR")}
      </span>
    ),
  },
  {
    accessorKey: "contraparte_name",
    header: "Counterpart",
    cell: ({ row }) => (
      <span className="text-sm">{row.original.contraparte_name ?? "—"}</span>
    ),
  },
  {
    accessorKey: "total",
    header: () => <div className="text-right">Total</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm">
        {money(row.original.total)}
      </div>
    ),
  },
  {
    accessorKey: "estado",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            row.original.estado === "active" ? "bg-green-500" : "bg-gray-400",
          )}
        />
        <span className="capitalize text-sm">{row.original.estado}</span>
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => row.original.onView(row.original)}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </div>
    ),
  },
]
