import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import type { LowStockRow } from "@/client"
import { ReportsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { qty } from "@/components/Reports/reportFormat"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

export function LowStockTab() {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryFn: () => ReportsService.lowStock(),
    queryKey: ["reports", "low-stock"],
  })
  const rows = data ?? []

  const columns: ColumnDef<LowStockRow>[] = [
    { accessorKey: "name", header: t("reports.product") },
    {
      accessorKey: "sku",
      header: t("reports.sku"),
      cell: ({ row }) => row.original.sku ?? "—",
    },
    {
      accessorKey: "category_name",
      header: t("reports.category"),
      cell: ({ row }) => row.original.category_name ?? "—",
    },
    {
      accessorKey: "stock_current",
      header: t("reports.onHand"),
      cell: ({ row }) => (
        <span className="font-medium text-red-600">
          {qty(row.original.stock_current)}
        </span>
      ),
    },
    {
      accessorKey: "stock_minimo",
      header: t("reports.min"),
      cell: ({ row }) => qty(row.original.stock_minimo),
    },
    {
      accessorKey: "stock_maximo",
      header: t("reports.max"),
      cell: ({ row }) => qty(row.original.stock_maximo),
    },
  ]

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </CardContent>
    </Card>
  )
}
