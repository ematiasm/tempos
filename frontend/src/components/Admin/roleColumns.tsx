import type { ColumnDef } from "@tanstack/react-table"

import type { RolePublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { RoleActionsMenu } from "./RoleActionsMenu"

export type RoleTableData = RolePublic

export const roleColumns: ColumnDef<RoleTableData>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const name = row.original.name
      return (
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          {name === "Administrador" && (
            <Badge variant="default" className="text-xs">
              System
            </Badge>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.description ?? "N/A"}
      </span>
    ),
  },
  {
    accessorKey: "permissions",
    header: "Permissions",
    cell: ({ row }) => (
      <Badge variant="secondary">
        {row.original.permissions?.length ?? 0} permissions
      </Badge>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <RoleActionsMenu role={row.original} />
      </div>
    ),
  },
]
