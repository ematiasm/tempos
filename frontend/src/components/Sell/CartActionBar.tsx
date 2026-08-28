import { Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"
import type { CartLine } from "./ProductSearch"

interface CartActionBarProps {
  line: CartLine
  onIncrease: () => void
  onDecrease: () => void
  /** Focuses the selected line's discount input. */
  onDiscount: () => void
  onRemove: () => void
}

/**
 * Action bar for the selected cart line: quantity shortcuts with the same
 * stepping rules as the keyboard, a shortcut to the line discount and an
 * immediate (no-confirmation) line removal.
 */
export function CartActionBar({
  line,
  onIncrease,
  onDecrease,
  onDiscount,
  onRemove,
}: CartActionBarProps) {
  const t = useT()

  return (
    <div
      data-testid="cart-action-bar"
      className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="cart-action-decrease"
        aria-label={t("sell.cartActionBar.decrease")}
        onClick={onDecrease}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="cart-action-increase"
        aria-label={t("sell.cartActionBar.increase")}
        onClick={onIncrease}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="cart-action-discount"
        onClick={onDiscount}
      >
        {t("sell.cartActionBar.discount")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive"
        data-testid="cart-action-remove"
        onClick={onRemove}
      >
        {t("sell.cartActionBar.remove")}
      </Button>
      <span className="ml-2 truncate text-sm text-muted-foreground">
        {line.variant?.sku_suffix
          ? `${line.product.name} (${line.variant.sku_suffix})`
          : line.product.name}
      </span>
    </div>
  )
}
