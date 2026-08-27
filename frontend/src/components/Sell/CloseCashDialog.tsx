import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

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
import { useLocale, useT } from "@/i18n"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

interface CloseCashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: CashSessionPublic | null
}

const money = (
  value: number | string | null | undefined,
  format: "es" | "en",
) =>
  value == null || value === "" ? "—" : `$${formatMoney(Number(value), format)}`

export function CloseCashDialog({
  open,
  onOpenChange,
  session,
}: CloseCashDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [counted, setCounted] = useState("")
  const [notes, setNotes] = useState("")

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
  const difference =
    counted === "" ? null : Math.round((countedNum - expected) * 100) / 100

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
              {money(expected, numberFormat)}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1">
            <span className="text-muted-foreground">{t("cash.counted")}</span>
            <span className="font-mono">{money(countedNum, numberFormat)}</span>
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
              {money(difference, numberFormat)}
            </span>
          </div>
        </div>

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
            disabled={counted === ""}
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
