import type { ColumnDef } from "@tanstack/react-table"

import type { ProductPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export type ProductRow = ProductPublic & {
  category_name?: string
}

export const getProductsColumns = (
  t: ReturnType<typeof useT>,
  onOpen: (product: ProductPublic) => void,
): ColumnDef<ProductRow>[] => [
  {
    accessorKey: "name",
    header: t("products.name"),
    cell: ({ row }) => (
      <button
        type="button"
        onClick={() => onOpen(row.original)}
        className="text-left font-medium hover:underline cursor-pointer"
      >
        {row.original.name}
      </button>
    ),
  },
  {
    accessorKey: "sku",
    header: t("products.sku"),
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-sm">
        {row.original.sku || t("products.na")}
      </span>
    ),
  },
  {
    id: "category",
    header: t("products.category"),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.category_name ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "costo_actual",
    header: t("products.cost"),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        $
        {Number(row.original.costo_actual).toLocaleString("es-AR", {
          minimumFractionDigits: 2,
        })}
      </span>
    ),
  },
  {
    accessorKey: "margen_pct",
    header: t("products.margin"),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {Number(row.original.margen_pct).toFixed(2)}%
      </span>
    ),
  },
  {
    accessorKey: "precio_venta",
    header: t("products.salePrice"),
    cell: ({ row }) => (
      <span className="font-medium">
        $
        {Number(row.original.precio_venta).toLocaleString("es-AR", {
          minimumFractionDigits: 2,
        })}
      </span>
    ),
  },
  {
    id: "stock",
    header: t("products.stock"),
    cell: ({ row }) => {
      const stock = Number(row.original.stock_current)
      const min = row.original.stock_minimo
        ? Number(row.original.stock_minimo)
        : null
      const isLow = min !== null && stock <= min
      return (
        <span className={cn("font-medium", isLow && "text-red-500")}>
          {stock.toLocaleString("es-AR")}
          {isLow && (
            <span className="ml-1 text-xs">{t("products.lowStock")}</span>
          )}
        </span>
      )
    },
  },
  {
    id: "taxes",
    header: t("products.taxes"),
    cell: ({ row }) => {
      const taxes = row.original.taxes ?? []
      if (taxes.length === 0) {
        return (
          <span className="text-muted-foreground text-sm">
            {t("products.none")}
          </span>
        )
      }
      return (
        <div className="flex flex-wrap gap-1">
          {taxes.map((tax) => (
            <Badge key={tax.id} variant="secondary" className="text-xs">
              {tax.code}
            </Badge>
          ))}
        </div>
      )
    },
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
        <span className={row.original.is_active ? "" : "text-muted-foreground"}>
          {row.original.is_active ? t("common.active") : t("common.inactive")}
        </span>
      </div>
    ),
  },
]
