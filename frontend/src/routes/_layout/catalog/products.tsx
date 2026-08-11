import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Package,
  Search,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import type { CategoryPublic, ProductPublic } from "@/client"
import { CategoriesService, ProductsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import PendingProducts from "@/components/Pending/PendingProducts"
import AddProduct from "@/components/Products/AddProduct"
import ProductDetailSheet from "@/components/Products/ProductDetailSheet"
import { getProductsColumns } from "@/components/Products/productsColumns"
import { Input } from "@/components/ui/input"
import { formatStatic, useT } from "@/i18n"
import { cn } from "@/lib/utils"

function getProductsQueryOptions() {
  return {
    queryFn: () => ProductsService.readProducts({ skip: 0, limit: 100 }),
    queryKey: ["products"],
  }
}

function getCategoriesQueryOptions() {
  return {
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
  }
}

export const Route = createFileRoute("/_layout/catalog/products")({
  component: Products,
  head: () => ({
    meta: [{ title: `${formatStatic("products.title")} - tempos` }],
  }),
})

interface CategoryNode {
  category: CategoryPublic
  children: CategoryNode[]
}

function buildCategoryTree(categories: CategoryPublic[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>()
  categories.forEach((c) => {
    map.set(c.id, { category: c, children: [] })
  })
  const roots: CategoryNode[] = []
  categories.forEach((c) => {
    const node = map.get(c.id)!
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function countForCategory(
  categoryId: string,
  allCategories: CategoryPublic[],
  countsByCat: Map<string, number>,
): number {
  let total = countsByCat.get(categoryId) ?? 0
  const children = allCategories.filter((c) => c.parent_id === categoryId)
  for (const child of children) {
    total += countForCategory(child.id, allCategories, countsByCat)
  }
  return total
}

interface TreeRowProps {
  node: CategoryNode
  depth: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  countsByCat: Map<string, number>
  allCategories: CategoryPublic[]
  t: ReturnType<typeof useT>
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  countsByCat,
  allCategories,
  t,
}: TreeRowProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.category.id
  const count = countForCategory(node.category.id, allCategories, countsByCat)

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted"
            onClick={() => setExpanded((v) => !v)}
            aria-label={
              expanded ? t("products.collapse") : t("products.expand")
            }
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button
          type="button"
          className={cn(
            "flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-left cursor-pointer",
            isSelected && "bg-accent",
          )}
          onClick={() => onSelect(isSelected ? null : node.category.id)}
        >
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1 truncate">{node.category.name}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </button>
      </div>
      {expanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.category.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            countsByCat={countsByCat}
            allCategories={allCategories}
            t={t}
          />
        ))}
    </div>
  )
}

function ProductsContent() {
  const t = useT()
  const { data: productsData } = useSuspenseQuery(getProductsQueryOptions())
  const { data: categoriesData } = useQuery(getCategoriesQueryOptions())

  const [search, setSearch] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  )
  const [openProductId, setOpenProductId] = useState<string | null>(null)

  const products = productsData?.data ?? []
  const categories = categoriesData?.data ?? []

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name] as const)),
    [categories],
  )

  const countsByCat = useMemo(() => {
    const map = new Map<string, number>()
    products.forEach((p) => {
      if (p.category_id) {
        map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1)
      }
    })
    return map
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcodes ?? []).some((b) => b.code.toLowerCase().includes(q))
      const matchesCat =
        !selectedCategoryId || p.category_id === selectedCategoryId
      return matchesSearch && matchesCat
    })
  }, [products, search, selectedCategoryId])

  const openProduct = useMemo<ProductPublic | null>(
    () => products.find((p) => p.id === openProductId) ?? null,
    [products, openProductId],
  )

  const rows = filteredProducts.map((p) => ({
    ...p,
    category_name: p.category_id ? categoryMap.get(p.category_id) : undefined,
  }))

  const columns = getProductsColumns(t, (product) =>
    setOpenProductId(product.id),
  )

  const tree = useMemo(() => buildCategoryTree(categories), [categories])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("products.title")}
          </h1>
          <p className="text-muted-foreground">{t("products.subtitle")}</p>
        </div>
        <AddProduct />
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-72 shrink-0">
          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b">
              <span className="text-sm font-medium">
                {t("products.categories")}
              </span>
            </div>
            <div className="py-1">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-1 rounded px-2 py-1.5 text-sm cursor-pointer",
                  selectedCategoryId === null && "bg-accent hover:bg-accent",
                )}
                onClick={() => setSelectedCategoryId(null)}
              >
                <span className="w-4" />
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left">
                  {t("products.allProducts")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {products.length}
                </span>
              </button>
              {tree.map((node) => (
                <TreeRow
                  key={node.category.id}
                  node={node}
                  depth={0}
                  selectedId={selectedCategoryId}
                  onSelect={setSelectedCategoryId}
                  countsByCat={countsByCat}
                  allCategories={categories}
                  t={t}
                />
              ))}
              {categories.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {t("products.noCategories")}
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("products.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12 border rounded-lg">
              <Search className="h-8 w-8 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">
                {t("products.noResultsFound")}
              </h3>
              <p className="text-muted-foreground">
                {products.length === 0
                  ? t("products.emptyHint")
                  : t("products.emptyHintAlt")}
              </p>
            </div>
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </div>
      </div>

      <ProductDetailSheet
        product={openProduct}
        open={openProductId !== null}
        onOpenChange={(o) => !o && setOpenProductId(null)}
      />
    </div>
  )
}

function Products() {
  return (
    <Suspense fallback={<PendingProducts />}>
      <ProductsContent />
    </Suspense>
  )
}

export default Products
