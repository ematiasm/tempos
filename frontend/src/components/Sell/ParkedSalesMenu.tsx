import { Archive, Save } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useT } from "@/i18n"
import { formatDateTimeStatic, formatMoneyStatic } from "@/lib/format"
import type { ParkedSale } from "./parkedSales"
import { computeTotals } from "./useSellCart"

interface ParkedSalesMenuProps {
  parked: ParkedSale[]
  /** Park is gated by the sell screen: items in cart and no sale in flight. */
  canPark: boolean
  onPark: () => void
  /** Recalls the entry; the swap orchestration stays in the sell screen. */
  onRecall: (entry: ParkedSale) => void
  /** Removes the entry; called after any required confirmation. */
  onDiscard: (entry: ParkedSale) => void
}

/** Parked sales row for the /sell screen: the park button plus a popover
 * listing parked sales (recall by row click, discard with confirmation
 * only when the entry still has items). Presentational: the list arrives
 * as props, kept fresh by the sell screen via the parked-changed event. */
export function ParkedSalesMenu({
  parked,
  canPark,
  onPark,
  onRecall,
  onDiscard,
}: ParkedSalesMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<ParkedSale | null>(null)

  const displayName = (entry: ParkedSale): string =>
    entry.customerName ??
    `${t("sell.parked.fallbackName")} · ${entry.id.slice(-4)}`

  const handleRecall = (entry: ParkedSale): void => {
    setOpen(false)
    onRecall(entry)
  }

  const handleDiscardClick = (
    entry: ParkedSale,
    stopPropagation: () => void,
  ): void => {
    stopPropagation()
    // zero-confirmation only when nothing would be lost
    if (entry.snapshot.cart.length > 0) setPendingDiscard(entry)
    else onDiscard(entry)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="park-sale"
        disabled={!canPark}
        onClick={onPark}
      >
        <Save className="mr-2 h-4 w-4" />
        {t("sell.park")}
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="parked-sales-toggle"
          >
            <Archive className="mr-2 h-4 w-4" />
            {t("sell.parked.count", { count: parked.length })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96">
          <p className="mb-2 text-sm font-medium">{t("sell.parked.title")}</p>
          {parked.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sell.parked.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {parked.map((entry) => {
                const { total } = computeTotals(
                  entry.snapshot.cart,
                  entry.snapshot.discountTotal,
                )
                return (
                  <div
                    key={entry.id}
                    data-testid="parked-sale-row"
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    {/* row click recalls, the inner buttons opt out */}
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer text-left"
                      onClick={() => handleRecall(entry)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {displayName(entry)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("sell.parked.items", {
                          count: entry.snapshot.cart.length,
                        })}
                        {" · "}
                        {`$${formatMoneyStatic(total)}`}
                        {" · "}
                        {t("sell.parked.parkedAt", {
                          time: formatDateTimeStatic(entry.parkedAt),
                        })}
                      </span>
                    </button>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid="parked-sale-recall"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRecall(entry)
                        }}
                      >
                        {t("sell.parked.recall")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        data-testid="parked-sale-discard"
                        onClick={(e) =>
                          handleDiscardClick(entry, () => e.stopPropagation())
                        }
                      >
                        {t("sell.parked.discard")}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDiscard(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sell.parked.discard")}</DialogTitle>
            <DialogDescription>
              {t("sell.parked.discardConfirm", {
                customer:
                  pendingDiscard != null ? displayName(pendingDiscard) : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              data-testid="parked-sale-discard-confirm"
              onClick={() => {
                if (pendingDiscard) onDiscard(pendingDiscard)
                setPendingDiscard(null)
              }}
            >
              {t("sell.parked.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
