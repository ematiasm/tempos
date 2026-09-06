import type { CartLine } from "@/components/Sell/ProductSearch"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"

interface BelowCostDialogProps {
  open: boolean
  /** Cart lines whose effective unit price (line discount included) is below
   * the product's current cost. */
  lines: CartLine[]
  /** Document-level below-cost summary (global discount included) when the
   * whole sale lands under the total cost; null when it does not trip. */
  docBelow?: { revenue: number; cost: number } | null
  /** Disables the confirm button while the sale mutation is in flight. */
  pending?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

/** One below-cost cart line rendered as a report row. */
function BelowCostRow({ line }: { line: CartLine }) {
  const { numberFormat } = useLocale()
  const cost = Number(line.product.costo_actual)
  const effectivePrice = line.unitPrice * (1 - line.discountPct / 100)
  const loss = Number(((cost - effectivePrice) * line.qty).toFixed(2))
  const variantLabel = line.variant?.sku_suffix
    ? `${line.product.name} (${line.variant.sku_suffix})`
    : line.product.name
  return (
    <TableRow>
      <TableCell className="py-1.5">{variantLabel}</TableCell>
      <TableCell className="py-1.5 text-right tabular-nums">
        {money(effectivePrice, numberFormat)}
      </TableCell>
      <TableCell className="py-1.5 text-right tabular-nums">
        {money(cost, numberFormat)}
      </TableCell>
      <TableCell className="py-1.5 text-right tabular-nums text-amber-600">
        {money(loss, numberFormat)}
      </TableCell>
    </TableRow>
  )
}

/**
 * Confirmation gate for sales priced below product cost (setting
 * warn_below_cost). Shown right before the sale is issued when any cart line
 * is below cost after its line discount, or when the whole sale lands under
 * the total cost after the document-level discount; warn-only, the operator
 * may always continue.
 */
export function BelowCostDialog({
  open,
  lines,
  docBelow = null,
  pending = false,
  onConfirm,
  onOpenChange,
}: BelowCostDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const hasDocRow = docBelow !== null && docBelow !== undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="below-cost-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sell.belowCostDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("sell.belowCostDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sell.belowCostDialog.product")}</TableHead>
              <TableHead className="text-right">
                {t("sell.belowCostDialog.price")}
              </TableHead>
              <TableHead className="text-right">
                {t("sell.belowCostDialog.cost")}
              </TableHead>
              <TableHead className="text-right">
                {t("sell.belowCostDialog.loss")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, i) => (
              <BelowCostRow key={i} line={line} />
            ))}
            {hasDocRow && (
              <TableRow data-testid="below-cost-doc-row">
                <TableCell className="py-1.5 font-medium">
                  {t("sell.belowCostDialog.docTotal")}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">
                  {money(docBelow.revenue, numberFormat)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">
                  {money(docBelow.cost, numberFormat)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular-nums text-amber-600">
                  {money(docBelow.cost - docBelow.revenue, numberFormat)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="below-cost-cancel"
            onClick={() => onOpenChange(false)}
          >
            {t("sell.belowCostDialog.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="below-cost-confirm"
            disabled={pending}
            onClick={onConfirm}
          >
            {t("sell.belowCostDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BelowCostDialog
