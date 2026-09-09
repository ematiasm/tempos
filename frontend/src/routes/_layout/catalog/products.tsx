import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Package,
  Search,
} from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import type { CategoryPublic, ProductListItemPublic } from "@/client"
import { CategoriesService, ProductsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import PendingProducts from "@/components/Pending/PendingProducts"
import AddProduct from "@/components/Products/AddProduct"
import ProductDetailSheet from "@/components/Products/ProductDetailSheet"
import { getProductsColumns } from "@/components/Products/productsColumns"
import { Input } from "@/components/ui/input"
import { formatStatic, useT } from "@/i18n"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 50

function getProductsQueryOptions(q: string, categoryId: string | null) {
  return {
    queryFn: ({ pageParam }: { pageParam: number }) =>
      ProductsService.readProducts({
        skip: pageParam,
        limit: PAGE_SIZE,
        q: q || undefined,
        categoryId: categoryId ?? undefined,
      }),
    queryKey: ["products", q, categoryId],
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: { count?: number; data?: ProductListItemPublic[] },
      allPages: { data?: ProductListItemPublic[] }[],
    ) => {
      const loaded = allPages.reduce(
        (total, page) => total + (page.data?.length ?? 0),
        0,
      )
      const count = lastPage.count ?? 0
      return loaded < count ? loaded : undefined
    },
  }
}

function getCategoriesQueryOptions() {
  return {
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
  }
}

function getCountsQueryOptions() {
  return {
    queryFn: () => ProductsService.readProductCategoryCounts(),
    queryKey: ["product-counts"],
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
  const [searchInput, setSearchInput] = useState("")
  const [q, setQ] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  )
  const [openProductId, setOpenProductId] = useState<string | null>(null)

  useEffect(() => {
    const timeout = setTimeout(() => setQ(searchInput.trim()), 300)
    return () => clearTimeout(timeout)
  }, [searchInput])

  const productsQuery = useInfiniteQuery(
    getProductsQueryOptions(q, selectedCategoryId),
  )
  const categoriesQuery = useQuery(getCategoriesQueryOptions())
  const countsQuery = useQuery(getCountsQueryOptions())

  const categories = categoriesQuery.data?.data ?? []
  const totalCount = countsQuery.data?.total ?? 0
  const countsByCat = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of countsQuery.data?.by_category ?? []) {
      if (entry.category_id) map.set(entry.category_id, entry.count)
    }
    return map
  }, [countsQuery.data])

  const products = useMemo(
    () => productsQuery.data?.pages.flatMap((p) => p.data ?? []) ?? [],
    [productsQuery.data],
  )

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name] as const)),
    [categories],
  )

  const rows = useMemo(
    () =>
      products.map((p) => ({
        ...p,
        category_name: p.category_id
          ? categoryMap.get(p.category_id)
          : undefined,
      })),
    [products, categoryMap],
  )

  const columns = getProductsColumns(t, (product) =>
    setOpenProductId(product.id),
  )

  const tree = useMemo(() => buildCategoryTree(categories), [categories])

  const showEmptyState =
    !productsQuery.isFetching &&
    products.length === 0 &&
    (totalCount === 0 || q !== "" || selectedCategoryId !== null)

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
                  {totalCount}
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
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          {showEmptyState ? (
            <div className="flex flex-col items-center justify-center text-center py-12 border rounded-lg">
              <Search className="h-8 w-8 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">
                {t("products.noResultsFound")}
              </h3>
              <p className="text-muted-foreground">
                {totalCount === 0
                  ? t("products.emptyHint")
                  : t("products.emptyHintAlt")}
              </p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              mode="infinite"
              hasMore={productsQuery.hasNextPage}
              isFetchingNextPage={productsQuery.isFetchingNextPage}
              onEndReached={() => productsQuery.fetchNextPage()}
            />
          )}
        </div>
      </div>

      <ProductDetailSheet
        productId={openProductId}
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
