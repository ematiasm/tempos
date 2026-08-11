import type { ColumnDef } from "@tanstack/react-table"

import type { CategoryPublic } from "@/client"
import type { useT } from "@/i18n"
import { CategoryActionsMenu } from "./CategoryActionsMenu"

export type CategoryTableData = CategoryPublic

interface RowMeta {
  depth: number
}

export const buildCategoryRows = (
  categories: CategoryPublic[],
  parentId: string | null = null,
  depth = 0,
): (CategoryTableData & RowMeta)[] => {
  const children = categories.filter((c) => c.parent_id === parentId)
  const rows: (CategoryTableData & RowMeta)[] = []
  for (const child of children) {
    rows.push({ ...child, depth })
    rows.push(...buildCategoryRows(categories, child.id, depth + 1))
  }
  return rows
}

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<CategoryTableData & RowMeta>[] {
  return [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => {
        const depth = row.original.depth
        return (
          <div
            className="flex items-center font-medium"
            style={{ paddingLeft: `${depth * 20}px` }}
          >
            {depth > 0 && (
              <span className="mr-2 text-muted-foreground">└─</span>
            )}
            {row.original.name}
          </div>
        )
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <CategoryActionsMenu category={row.original} />
        </div>
      ),
    },
  ]
}
