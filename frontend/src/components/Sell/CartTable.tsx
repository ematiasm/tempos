import { Minus, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n"
import { moneyStatic } from "@/lib/format"
import { round2 } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { CartLine } from "./ProductSearch"
import { clampQty, qtyStepFor } from "./useSellCart"

interface CartTableProps {
  cart: CartLine[]
  onUpdateLine: (index: number, patch: Partial<CartLine>) => void
  onRemoveLine: (index: number) => void
  /** Index of the selected line (row highlight + keyboard target). */
  selectedIndex: number | null
  onSelectLine: (index: number) => void
  /** Global sell_block_price_edit setting; per-product flag still unlocks. */
  blockPriceEdit: boolean
  /** UI-only, non-blocking warning when a line's price is below product cost. */
  warnBelowCost?: boolean
}

export function CartTable({
  cart,
  onUpdateLine,
  onRemoveLine,
  selectedIndex,
  onSelectLine,
  blockPriceEdit,
  warnBelowCost = false,
}: CartTableProps) {
  const t = useT()

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{t("sell.product")}</th>
            <th className="w-24 px-2 py-2 text-right">{t("sell.price")}</th>
            <th className="w-24 px-2 py-2 text-right">{t("sell.qty")}</th>
            <th className="w-24 px-2 py-2 text-right">{t("sell.discPct")}</th>
            <th className="w-24 px-3 py-2 text-right">{t("sell.lineTotal")}</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {cart.map((line, index) => {
            const dp = line.product.uom?.decimal_places ?? 0
            const stock = line.variant
              ? Number(line.variant.stock_current)
              : Number(line.product.stock_current)
            const lineTotal = round2(
              line.qty * line.unitPrice * (1 - line.discountPct / 100),
            )
            const lowStock = line.qty > stock
            // priced below the product's current cost after the line
            // discount (warn-only, never blocks)
            const belowCost =
              warnBelowCost &&
              line.unitPrice * (1 - line.discountPct / 100) <
                Number(line.product.costo_actual)
            const selected = index === selectedIndex
            return (
              <tr
                key={`${line.product.id}-${line.variant?.id ?? "base"}`}
                data-testid="cart-row"
                data-selected={selected ? "true" : "false"}
                onClick={() => onSelectLine(index)}
                className={cn("cursor-pointer", selected && "bg-muted/50")}
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{line.product.name}</span>
                  {belowCost && (
                    <Badge
                      variant="outline"
                      className="ml-1 text-[10px] text-amber-600"
                    >
                      {t("sell.belowCost")}
                    </Badge>
                  )}
                  {line.variant && (
                    <div className="flex gap-1">
                      {line.variant.sku_suffix && (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          {line.variant.sku_suffix}
                        </Badge>
                      )}
                      {(line.variant.attribute_values ?? []).map((av) => (
                        <Badge
                          key={av.id}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {av.value}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <span
                    className={cn(
                      "text-xs",
                      lowStock ? "text-amber-600" : "text-muted-foreground",
                    )}
                  >
                    {t("sell.stockHint", { stock })}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    className="ml-auto h-8 w-24 text-right"
                    value={line.unitPrice}
                    disabled={
                      blockPriceEdit && !line.product.allow_price_edit_in_sale
                    }
                    onChange={(e) =>
                      onUpdateLine(index, {
                        unitPrice: Number(e.target.value) || 0,
                      })
                    }
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex h-8 items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        onUpdateLine(index, {
                          qty: clampQty(line.qty - qtyStepFor(dp), dp),
                        })
                      }
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      step={dp > 0 ? String(1 / 10 ** dp) : "1"}
                      className="h-8 w-16 px-1 text-right"
                      value={line.qty}
                      onChange={(e) =>
                        onUpdateLine(index, {
                          qty: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() =>
                        onUpdateLine(index, {
                          qty: clampQty(line.qty, dp),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        onUpdateLine(index, {
                          qty: clampQty(line.qty + qtyStepFor(dp), dp),
                        })
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-2 text-right">
                  <Input
                    id={`cart-discount-${index}`}
                    data-testid="cart-discount-input"
                    type="number"
                    step="0.01"
                    className="ml-auto h-8 w-16 px-1 text-right"
                    value={line.discountPct}
                    onChange={(e) =>
                      onUpdateLine(index, {
                        discountPct: Number(e.target.value) || 0,
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {moneyStatic(lineTotal)}
                </td>
                <td className="px-2 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveLine(index)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
