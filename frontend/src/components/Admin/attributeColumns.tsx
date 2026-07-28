import type { ColumnDef } from "@tanstack/react-table"

import type { AttributePublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { AttributeActionsMenu } from "./AttributeActionsMenu"

export type AttributeTableData = AttributePublic

export const columns: ColumnDef<AttributeTableData>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "values",
    header: "Values",
    cell: ({ row }) => {
      const values = row.original.values ?? []
      if (values.length === 0) {
        return <span className="text-muted-foreground text-sm">No values</span>
      }
      return (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Badge key={v.id} variant="outline" className="text-xs">
              {v.value}
            </Badge>
          ))}
        </div>
      )
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <AttributeActionsMenu attribute={row.original} />
      </div>
    ),
  },
]
