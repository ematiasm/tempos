import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import type { ReorderRow } from "@/client"
import { CategoriesService, ReportsService, SuppliersService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { money, qty } from "@/components/Reports/reportFormat"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

export function ReorderTab() {
  const t = useT()
  const [supplierId, setSupplierId] = useState<string | undefined>()
  const [categoryId, setCategoryId] = useState<string | undefined>()

  const { data: suppliers } = useQuery({
    queryFn: () => SuppliersService.readSuppliers({ skip: 0, limit: 100 }),
    queryKey: ["suppliers"],
  })
  const { data: categories } = useQuery({
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
  })

  const { data, isLoading } = useQuery({
    queryFn: () =>
      ReportsService.reorderReport({
        supplierId: supplierId ?? null,
        categoryId: categoryId ?? null,
      }),
    queryKey: ["reports", "reorder", supplierId, categoryId],
  })
  const rows = data ?? []

  const columns: ColumnDef<ReorderRow>[] = [
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
      accessorKey: "missing",
      header: t("reports.toOrder"),
      cell: ({ row }) => qty(row.original.missing),
    },
    {
      accessorKey: "reference_cost",
      header: t("reports.refCost"),
      cell: ({ row }) => money(row.original.reference_cost),
    },
    {
      accessorKey: "estimated_cost",
      header: t("reports.estTotal"),
      cell: ({ row }) => (
        <span className="font-medium">
          {money(row.original.estimated_cost)}
        </span>
      ),
    },
  ]

  const estimatedTotal = rows.reduce(
    (acc, r) => acc + Number(r.estimated_cost ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="reorder-supplier"
            className="text-xs text-muted-foreground"
          >
            Supplier
          </Label>
          <Select
            value={supplierId ?? "all"}
            onValueChange={(v) => setSupplierId(v === "all" ? undefined : v)}
          >
            <SelectTrigger id="reorder-supplier" className="h-9 w-[200px]">
              <SelectValue placeholder="All suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.allSuppliers")}</SelectItem>
              {(suppliers?.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.razon_social}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="reorder-category"
            className="text-xs text-muted-foreground"
          >
            Category
          </Label>
          <Select
            value={categoryId ?? "all"}
            onValueChange={(v) => setCategoryId(v === "all" ? undefined : v)}
          >
            <SelectTrigger id="reorder-category" className="h-9 w-[200px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.allCategories")}</SelectItem>
              {(categories?.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isLoading && rows.length > 0 && (
          <span className="text-sm text-muted-foreground pb-1">
            {t("reports.itemsEst", {
              count: rows.length,
              total: money(estimatedTotal),
            })}
          </span>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
