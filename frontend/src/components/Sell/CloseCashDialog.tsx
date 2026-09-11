import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { type CashSessionPublic, CashSessionsService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { moneyStatic } from "@/lib/format"
import { round2 } from "@/lib/money"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"
import {
  clearParkedSales,
  countOpenSales,
  SELL_EXTERNAL_RESET_EVENT,
} from "./parkedSales"
import { clearCartSnapshot } from "./useSellCart"

interface CloseCashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: CashSessionPublic | null
}

export function CloseCashDialog({
  open,
  onOpenChange,
  session,
}: CloseCashDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [counted, setCounted] = useState("")
  const [notes, setNotes] = useState("")

  // --- Open sales gate -------------------------------------------------------
  // Parked sales and the in-progress sale must not vanish silently when the
  // register closes: the close stays blocked until they are discarded here.
  const [openSales, setOpenSales] = useState(() => countOpenSales())
  const hasOpenSales = openSales.parkedCount > 0 || openSales.activeHasItems

  useEffect(() => {
    if (open) setOpenSales(countOpenSales())
  }, [open])

  const discardOpenSales = () => {
    clearParkedSales()
    clearCartSnapshot()
    // the sell screen listens and resets its in-flight state on this event
    // instead of re-persisting the stale cart into the snapshot
    window.dispatchEvent(new CustomEvent(SELL_EXTERNAL_RESET_EVENT))
    setOpenSales(countOpenSales())
  }

  const { data: report } = useQuery({
    queryFn: () =>
      CashSessionsService.readCashSessionReport({
        cashSessionId: session!.id,
      }),
    queryKey: ["cash-sessions-report", session?.id],
    enabled: open && session != null,
  })

  const expected = useMemo(() => Number(report?.expected_amount ?? 0), [report])
  const countedNum = Number(counted)
  const difference = counted === "" ? null : round2(countedNum - expected)

  const mutation = useMutation({
    mutationFn: () =>
      CashSessionsService.closeCashSession({
        cashSessionId: session!.id,
        requestBody: {
          counted_amount: countedNum,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("cash.closeSuccess"))
      onOpenChange(false)
      setCounted("")
      setNotes("")
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setCounted("")
          setNotes("")
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cash.closeTitle")}</DialogTitle>
          <DialogDescription>{t("cash.closeHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("cash.expected")}</span>
            <span className="font-mono" data-testid="cash-expected">
              {moneyStatic(expected)}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1">
            <span className="text-muted-foreground">{t("cash.counted")}</span>
            <span className="font-mono">{moneyStatic(countedNum)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-medium">
            <span className="text-muted-foreground">
              {t("cash.difference")}
            </span>
            <span
              className={cn(
                "font-mono",
                difference != null && difference < 0 && "text-destructive",
                difference != null && difference > 0 && "text-emerald-600",
              )}
              data-testid="cash-difference"
            >
              {moneyStatic(difference)}
            </span>
          </div>
        </div>

        {hasOpenSales && (
          <div
            className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            data-testid="cash-open-sales-warning"
          >
            {openSales.parkedCount > 0 && (
              <span className="font-medium text-destructive">
                {t("cash.openSalesWarning", { count: openSales.parkedCount })}
              </span>
            )}
            {openSales.activeHasItems && (
              <span className="font-medium text-destructive">
                {t("cash.openSalesActive")}
              </span>
            )}
            <span className="text-muted-foreground">
              {t("cash.openSalesHint")}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="w-fit"
              data-testid="cash-discard-open-sales"
              onClick={discardOpenSales}
            >
              {t("cash.discardAll")}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("cash.countedAmount")}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              data-testid="cash-counted-amount"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("cash.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            type="button"
            data-testid="cash-close-submit"
            loading={mutation.isPending}
            // open sales block the close even with a counted amount filled
            disabled={counted === "" || hasOpenSales}
            onClick={() => mutation.mutate()}
          >
            {t("cash.close")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CloseCashDialog
