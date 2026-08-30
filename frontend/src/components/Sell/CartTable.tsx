import { Minus, Plus, Trash2 } from "lucide-react"
import { round2 } from "@/components/Payments/paymentMath"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CartLine } from "./ProductSearch"

interface CartTableProps {
  cart: CartLine[]
  onUpdateLine: (index: number, patch: Partial<CartLine>) => void
  onRemoveLine: (index: number) => void
  /** Index of the selected line (row highlight + keyboard target). */
  selectedIndex: number | null
  onSelectLine: (index: number) => void
  /** Global sell_block_price_edit setting; per-product flag still unlocks. */
  blockPriceEdit: boolean
}

export function CartTable({
  cart,
  onUpdateLine,
  onRemoveLine,
  selectedIndex,
  onSelectLine,
  blockPriceEdit,
}: CartTableProps) {
  const t = useT()
  const { numberFormat } = useLocale()

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
            const stock = line.variant
              ? Number(line.variant.stock_current)
              : Number(line.product.stock_current)
            const lineTotal = round2(
              line.qty * line.unitPrice * (1 - line.discountPct / 100),
            )
            const lowStock = line.qty > stock
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
                          qty: Math.max(0.001, round2(line.qty - 1)),
                        })
                      }
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      step="0.001"
                      className="h-8 w-16 px-1 text-right"
                      value={line.qty}
                      onChange={(e) =>
                        onUpdateLine(index, {
                          qty: Number(e.target.value) || 0,
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        onUpdateLine(index, { qty: round2(line.qty + 1) })
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
                  {money(lineTotal, numberFormat)}
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
