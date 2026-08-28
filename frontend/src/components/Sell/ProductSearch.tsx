import { useQuery } from "@tanstack/react-query"
import { Loader2, Search, ShoppingCart } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { ProductPublic, ProductVariantPublic } from "@/client"
import { ProductsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, useT } from "@/i18n"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface CartLine {
  product: ProductPublic
  variant?: ProductVariantPublic
  qty: number
  unitPrice: number
  discountPct: number
}

interface ProductSearchProps {
  onAdd: (product: ProductPublic, variant?: ProductVariantPublic) => void
}

const ProductSearch = ({ onAdd }: ProductSearchProps) => {
  const t = useT()
  const { numberFormat } = useLocale()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, isFetching, isError } = useQuery({
    queryFn: () => ProductsService.searchProducts({ q: query.trim() }),
    queryKey: ["products-search", query.trim()],
    enabled: query.trim().length >= 2,
  })
  const results = data?.data ?? []
  const listOpen = query.trim().length >= 2 && !dismissed

  useEffect(() => {
    if (!query) {
      setExpanded(null)
      setDismissed(false)
    }
    setHighlight(0)
  }, [query])

  useEffect(() => {
    setHighlight(0)
  }, [])

  /** Barcode codes are UNIQUE, so an exact hit resolves one variant. */
  const resolveVariantBarcode = (
    product: ProductPublic,
  ): ProductVariantPublic | undefined => {
    const term = query.trim()
    if (!term) return undefined
    return (product.variants ?? []).find((variant) =>
      (variant.barcodes ?? []).some((barcode) => barcode.code === term),
    )
  }

  const addMain = (product: ProductPublic) => {
    const variant = resolveVariantBarcode(product)
    if (variant) {
      onAdd(product, variant)
      setExpanded(null)
      setQuery("")
      inputRef.current?.focus()
      return
    }
    if ((product.variants ?? []).length > 0) {
      setExpanded((prev) => (prev === product.id ? null : product.id))
      return
    }
    onAdd(product)
    setQuery("")
    inputRef.current?.focus()
  }

  const addVariant = (
    product: ProductPublic,
    variant: ProductVariantPublic,
  ) => {
    onAdd(product, variant)
    setExpanded(null)
    setQuery("")
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (listOpen) {
        e.preventDefault()
        setDismissed(true)
      }
      return
    }
    if (e.key === "ArrowDown" && listOpen && results.length > 0) {
      e.preventDefault()
      setHighlight((prev) => Math.min(prev + 1, results.length - 1))
      return
    }
    if (e.key === "ArrowUp" && listOpen && results.length > 0) {
      e.preventDefault()
      setHighlight((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === "Enter" && listOpen && results.length > 0) {
      const selected = results[Math.min(highlight, results.length - 1)]
      if (!selected) return
      if (
        (selected.variants ?? []).length > 0 &&
        !resolveVariantBarcode(selected)
      ) {
        setExpanded(selected.id)
        return
      }
      addMain(selected)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          data-testid="product-search"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setDismissed(false)
          }}
          onKeyDown={onKeyDown}
          className="h-12 pl-9 text-base"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {listOpen && results.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          {results.map((product, index) => {
            const hasVariants = (product.variants ?? []).length > 0
            const isExpanded = expanded === product.id
            const isHighlighted = index === highlight
            return (
              <div key={product.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  data-testid="search-option"
                  data-highlighted={isHighlighted ? "true" : "false"}
                  onClick={() => addMain(product)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                    isHighlighted && "bg-muted/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {product.name}
                      </span>
                      {product.sku && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {product.sku}
                        </span>
                      )}
                      {hasVariants && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("search.variants", {
                            count: product.variants?.length ?? 0,
                          })}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {t("search.stock", {
                          stock: Number(product.stock_current),
                        })}
                      </span>
                      {(product.barcodes ?? []).length > 0 && (
                        <span className="font-mono">
                          {product.barcodes![0].code}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      ${formatMoney(Number(product.precio_venta), numberFormat)}
                    </span>
                    <span className="inline-flex h-8 items-center gap-1 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground">
                      <ShoppingCart className="h-3 w-3" />
                      {hasVariants ? t("search.choose") : t("search.add")}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-1.5 px-3 pb-2.5">
                    {(product.variants ?? []).map((variant) => (
                      <Button
                        type="button"
                        key={variant.id}
                        variant="outline"
                        size="sm"
                        onClick={() => addVariant(product, variant)}
                        className={cn(
                          "justify-between",
                          Number(variant.stock_current) <= 0 && "opacity-60",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {variant.sku_suffix && (
                            <span className="font-mono text-xs">
                              {variant.sku_suffix}
                            </span>
                          )}
                          {(variant.attribute_values ?? []).map((av) => (
                            <Badge key={av.id} variant="secondary">
                              {av.value}
                            </Badge>
                          ))}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("search.stock", {
                            stock: Number(variant.stock_current),
                          })}
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {query.trim().length >= 2 && results.length === 0 && !isFetching && (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            isError && "text-destructive",
          )}
        >
          {isError ? t("search.failed") : t("search.noMatch")}
        </p>
      )}
    </div>
  )
}

export default ProductSearch
