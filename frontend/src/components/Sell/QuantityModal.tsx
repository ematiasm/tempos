import { useEffect, useState } from "react"

import type { ProductPublic, ProductVariantPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"

interface QuantityModalProps {
  open: boolean
  /** Decimal-UoM product waiting for a hand-typed quantity. */
  product: ProductPublic | null
  variant?: ProductVariantPublic
  onConfirm: (qty: number) => void
  onOpenChange: (open: boolean) => void
}

/** Counts the digits after the decimal point of a plain decimal string. */
const fractionDigits = (raw: string): number => {
  const dot = raw.indexOf(".")
  return dot === -1 ? 0 : raw.length - dot - 1
}

/**
 * Quantity entry for products whose UoM allows decimals (decimal_places > 0).
 * Rejects values with more decimal places than the UoM precision; the parent
 * keeps auto-add 1 for integer UoMs and never opens this modal.
 */
export function QuantityModal({
  open,
  product,
  variant,
  onConfirm,
  onOpenChange,
}: QuantityModalProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const [raw, setRaw] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRaw("")
      setError(null)
    }
  }, [open])

  if (!product) return null

  const places = product.uom?.decimal_places ?? 0
  const uomName = product.uom?.name ?? ""

  const submit = () => {
    const value = Number(raw)
    if (raw.trim() === "" || Number.isNaN(value) || value <= 0) {
      setError(t("sell.qtyModal.invalid"))
      return
    }
    if (fractionDigits(raw.trim()) > places) {
      setError(t("sell.qtyModal.precisionError", { places, uom: uomName }))
      return
    }
    onConfirm(value)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="qty-modal" className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("sell.qtyModal.title", {
                product: variant?.sku_suffix
                  ? `${product.name} (${variant.sku_suffix})`
                  : product.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t("sell.qtyModal.hint", {
                uom: uomName,
                price: money(Number(product.precio_venta), numberFormat),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            <label htmlFor="qty-modal-input" className="text-sm font-medium">
              {t("sell.qtyModal.label", { uom: uomName })}
            </label>
            <Input
              id="qty-modal-input"
              data-testid="qty-modal-input"
              autoFocus
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setError(null)
              }}
            />
            {error && (
              <p
                className="text-sm text-destructive"
                data-testid="qty-modal-error"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("sell.qtyModal.cancel")}
            </Button>
            <Button type="submit" data-testid="qty-modal-confirm">
              {t("sell.qtyModal.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default QuantityModal
