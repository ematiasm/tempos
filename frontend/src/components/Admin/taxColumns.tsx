import type { ColumnDef } from "@tanstack/react-table"

import type { TaxPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { TaxActionsMenu } from "./TaxActionsMenu"

export type TaxTableData = TaxPublic

export function getColumns(
  t: ReturnType<typeof useT>,
  onToggleDefault?: (tax: TaxPublic) => void,
): ColumnDef<TaxTableData>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "code",
      header: t("admin.taxes.code"),
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-sm">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "tipo",
      header: t("common.type"),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.tipo}
        </Badge>
      ),
    },
    {
      accessorKey: "rate",
      header: t("admin.taxes.rate"),
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
      header: t("admin.taxes.appliesTo"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm capitalize">
          {row.original.aplica_a ?? "linea"}
        </span>
      ),
    },
    {
      accessorKey: "is_default",
      header: t("admin.taxes.default"),
      cell: ({ row }) => (
        <Checkbox
          checked={row.original.is_default ?? false}
          onCheckedChange={() => onToggleDefault?.(row.original)}
        />
      ),
    },
    {
      accessorKey: "is_active",
      header: t("common.status"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              row.original.is_active ? "bg-green-500" : "bg-gray-400",
            )}
          />
          <span
            className={row.original.is_active ? "" : "text-muted-foreground"}
          >
            {row.original.is_active ? t("common.active") : t("common.inactive")}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TaxActionsMenu tax={row.original} />
        </div>
      ),
    },
  ]
}
