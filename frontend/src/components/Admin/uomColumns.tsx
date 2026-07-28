import type { ColumnDef } from "@tanstack/react-table"

import type { UoMPublic } from "@/client"
import { UoMActionsMenu } from "./UoMActionsMenu"

export type UoMTableData = UoMPublic

export const columns: ColumnDef<UoMTableData>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "abbreviation",
    header: "Abbreviation",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono">
        {row.original.abbreviation}
      </span>
    ),
  },
  {
    accessorKey: "decimal_places",
    header: "Decimals",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.decimal_places ?? 0}
      </span>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UoMActionsMenu uom={row.original} />
      </div>
    ),
  },
]
