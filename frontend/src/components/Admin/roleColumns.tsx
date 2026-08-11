import type { ColumnDef } from "@tanstack/react-table"

import type { RolePublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { RoleActionsMenu } from "./RoleActionsMenu"

export type RoleTableData = RolePublic

export function getRoleColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<RoleTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => {
        const name = row.original.name
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {name === "Administrador" && (
              <Badge variant="default" className="text-xs">
                {t("admin.roles.system")}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "description",
      header: t("admin.roles.description"),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.description ?? t("admin.na")}
        </span>
      ),
    },
    {
      accessorKey: "permissions",
      header: t("admin.roles.permissions"),
      cell: ({ row }) => (
        <Badge variant="secondary">
          {t("admin.roles.permissionsCount", {
            count: row.original.permissions?.length ?? 0,
          })}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RoleActionsMenu role={row.original} />
        </div>
      ),
    },
  ]
}
