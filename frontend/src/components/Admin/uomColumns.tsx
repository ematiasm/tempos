import type { ColumnDef } from "@tanstack/react-table"

import type { UoMPublic } from "@/client"
import type { useT } from "@/i18n"
import { UoMActionsMenu } from "./UoMActionsMenu"

export type UoMTableData = UoMPublic

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<UoMTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "abbreviation",
      header: t("admin.units.abbreviation"),
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono">
          {row.original.abbreviation}
        </span>
      ),
    },
    {
      accessorKey: "decimal_places",
      header: t("admin.units.decimalPlaces"),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.decimal_places ?? 0}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <UoMActionsMenu uom={row.original} />
        </div>
      ),
    },
  ]
}
