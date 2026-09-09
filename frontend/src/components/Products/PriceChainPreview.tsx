import { useT } from "@/i18n"
import { moneyStatic } from "@/lib/format"
import { cn } from "@/lib/utils"

interface PriceChainPreviewProps {
  costoActual: number
  costoConImpuestos: number
  precioNeto: number
  precioVenta: number
  className?: string
}

/**
 * The four-price chain (costo → costo con impuestos → neto → góndola), used
 * by AddProduct and ProductDetailSheet. Values come from the live-computed
 * chain in `lib/pricing.ts` (or the stored product record).
 */
const PriceChainPreview = ({
  costoActual,
  costoConImpuestos,
  precioNeto,
  precioVenta,
  className,
}: PriceChainPreviewProps) => {
  const t = useT()

  const items = [
    { label: t("products.cost"), value: costoActual },
    { label: t("products.costWithTaxes"), value: costoConImpuestos },
    { label: t("products.netPrice"), value: precioNeto },
    { label: t("products.salePrice"), value: precioVenta, strong: true },
  ]

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className={cn("grid grid-cols-4 gap-3 rounded border bg-muted/40 p-3")}
      >
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span
              className={cn(
                "text-sm font-medium",
                item.strong && "text-base text-primary",
              )}
            >
              {moneyStatic(item.value)}
            </span>
          </div>
        ))}
      </div>
      {precioNeto < costoActual && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("products.negativeMarginWarning")}
        </p>
      )}
    </div>
  )
}

export default PriceChainPreview
