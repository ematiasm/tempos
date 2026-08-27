import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Wallet } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  CashSessionsService,
  FinancialAccountsService,
  PaymentMethodsService,
} from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"

interface OpenCashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenCashDialog({ open, onOpenChange }: OpenCashDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [openingAmount, setOpeningAmount] = useState("")
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null)

  const { data: accountsData } = useQuery({
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
  })

  const drawerAccountId = useMemo(() => {
    const drawerMethod = (methodsData?.data ?? []).find((m) => m.is_cash_drawer)
    return drawerMethod?.financial_account_id ?? null
  }, [methodsData])

  useEffect(() => {
    if (open && drawerAccountId && !sourceAccountId) {
      setSourceAccountId(drawerAccountId)
    }
  }, [open, drawerAccountId, sourceAccountId])

  const accounts = accountsData?.data ?? []

  const mutation = useMutation({
    mutationFn: () =>
      CashSessionsService.openCashSession({
        requestBody: {
          opening_amount: Number(openingAmount) || 0,
          opening_source_account_id: sourceAccountId ?? undefined,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("cash.openSuccess"))
      onOpenChange(false)
      setOpeningAmount("")
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setOpeningAmount("")
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {t("cash.openTitle")}
          </DialogTitle>
          <DialogDescription>{t("cash.openHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("cash.openingAmount")}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              data-testid="cash-opening-amount"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("cash.openingSource")}</Label>
            <Select
              value={sourceAccountId ?? ""}
              onValueChange={setSourceAccountId}
            >
              <SelectTrigger data-testid="cash-opening-source">
                <SelectValue placeholder={t("cash.selectAccount")} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("cash.openingSourceHint")}
            </p>
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
            data-testid="cash-open-submit"
            loading={mutation.isPending}
            disabled={Number(openingAmount) < 0}
            onClick={() => mutation.mutate()}
          >
            {t("cash.open")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default OpenCashDialog
