import type { ColumnDef } from "@tanstack/react-table"

import type { AttributePublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { AttributeActionsMenu } from "./AttributeActionsMenu"

export type AttributeTableData = AttributePublic

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<AttributeTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "values",
      header: t("admin.attributes.values"),
      cell: ({ row }) => {
        const values = row.original.values ?? []
        if (values.length === 0) {
          return (
            <span className="text-muted-foreground text-sm">
              {t("admin.attributes.noValues")}
            </span>
          )
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
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AttributeActionsMenu attribute={row.original} />
        </div>
      ),
    },
  ]
}
