import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Search, ShoppingCart } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ProductPublic, ProductVariantPublic } from "@/client"
import { ProductsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n"
import { formatMoneyStatic } from "@/lib/format"
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
  /** Optional external ref so the parent can refocus the input (new sale). */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Debounce (ms) applied to the term used by the search query (0 = off). */
  debounceMs?: number
  /**
   * Enter with no results yet awaits the missing/in-flight fetch and adds an
   * exact barcode hit, so a scanner's Enter keystroke is never lost.
   */
  scanEnter?: boolean
}

/** Shared definition so useQuery and the scan-path fetchQuery never drift. */
const searchQueryOptions = (term: string) => ({
  queryKey: ["products-search", term] as const,
  queryFn: () => ProductsService.searchProducts({ q: term }),
})

const ProductSearch = ({
  onAdd,
  inputRef: externalInputRef,
  debounceMs = 0,
  scanEnter = false,
}: ProductSearchProps) => {
  const t = useT()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? internalInputRef
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // With debounceMs > 0 the term used by the search query lags behind the
  // raw input; the input itself always shows the raw text.
  useEffect(() => {
    if (debounceMs > 0) {
      debounceTimerRef.current = setTimeout(
        () => setDebouncedQuery(query),
        debounceMs,
      )
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
      }
    }
    setDebouncedQuery(query)
  }, [query, debounceMs])

  const trimmed = query.trim()
  const searchTerm = debounceMs > 0 ? debouncedQuery.trim() : trimmed
  // true while the (debounced) query has not picked up the typed term yet
  const searchPending = debounceMs > 0 && trimmed !== debouncedQuery.trim()

  const { data, isFetching, isError } = useQuery({
    ...searchQueryOptions(searchTerm),
    enabled: searchTerm.length >= 2,
  })
  const results = data?.data ?? []
  const listOpen = trimmed.length >= 2 && !dismissed

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
    term: string,
  ): ProductVariantPublic | undefined => {
    if (!term) return undefined
    return (product.variants ?? []).find((variant) =>
      (variant.barcodes ?? []).some((barcode) => barcode.code === term),
    )
  }

  /** Shared post-add reset: clear the search and refocus for the next scan. */
  const resetAfterAdd = () => {
    setExpanded(null)
    setQuery("")
    // keep the debounced term from refetching the just-cleared search
    setDebouncedQuery("")
    inputRef.current?.focus()
  }

  /** Scan path: the Enter keystroke can arrive before the (possibly
   * debounced) search has produced results, so the fetch is awaited here
   * instead of being lost. The RAW trimmed term is used — never the lagging
   * debounced one — or the last typed character would be missed. An exact
   * barcode hit (codes are UNIQUE) goes straight to the cart; without one
   * this does nothing. */
  const scanAddByBarcode = async (term: string) => {
    if (term.length < 2) return
    const fresh = await queryClient.fetchQuery(searchQueryOptions(term))
    for (const product of fresh.data ?? []) {
      const variant = resolveVariantBarcode(product, term)
      if (variant) {
        onAdd(product, variant)
        resetAfterAdd()
        return
      }
      if ((product.barcodes ?? []).some((barcode) => barcode.code === term)) {
        onAdd(product)
        resetAfterAdd()
        return
      }
    }
  }

  const addMain = (product: ProductPublic) => {
    const variant = resolveVariantBarcode(product, query.trim())
    if (variant) {
      onAdd(product, variant)
      resetAfterAdd()
      return
    }
    if ((product.variants ?? []).length > 0) {
      setExpanded((prev) => (prev === product.id ? null : product.id))
      return
    }
    onAdd(product)
    resetAfterAdd()
  }

  const addVariant = (
    product: ProductPublic,
    variant: ProductVariantPublic,
  ) => {
    onAdd(product, variant)
    resetAfterAdd()
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
        !resolveVariantBarcode(selected, query.trim())
      ) {
        setExpanded(selected.id)
        return
      }
      addMain(selected)
      return
    }
    if (
      e.key === "Enter" &&
      scanEnter &&
      results.length === 0 &&
      trimmed.length >= 2
    ) {
      // Cancel any pending debounce and search the RAW term right away:
      // a scanner fires Enter before the debounced query would run.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      setDebouncedQuery(query)
      void scanAddByBarcode(trimmed)
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
                      ${formatMoneyStatic(Number(product.precio_venta))}
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

      {trimmed.length >= 2 &&
        results.length === 0 &&
        !isFetching &&
        !searchPending && (
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
