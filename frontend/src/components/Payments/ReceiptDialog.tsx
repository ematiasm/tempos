import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HandCoins } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { CounterpartType } from "@/client"
import {
  CustomersService,
  PaymentMethodsService,
  PaymentsService,
  SuppliersService,
} from "@/client"
import { money } from "@/components/Reports/reportFormat"
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
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  counterpartType?: CounterpartType | null
  counterpartId?: string | null
  onCreated: () => void
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function ReceiptDialog({
  open,
  onOpenChange,
  counterpartType: fixedType,
  counterpartId: fixedId,
  onCreated,
}: ReceiptDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [partyType, setPartyType] = useState<CounterpartType | null>(
    fixedType ?? "customer",
  )
  const [partyId, setPartyId] = useState<string | null>(fixedId ?? null)
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [autoAmount, setAutoAmount] = useState(true)

  const { data: customersData } = useQuery({
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  })
  const { data: suppliersData } = useQuery({
    queryFn: () => SuppliersService.readSuppliers({ skip: 0, limit: 1000 }),
    queryKey: ["suppliers"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
  })

  const parties = useMemo(
    () =>
      (partyType === "supplier"
        ? (suppliersData?.data ?? [])
        : (customersData?.data ?? [])
      ).filter((p) => p.is_active !== false),
    [partyType, customersData, suppliersData],
  )

  const methods = useMemo(
    () => (methodsData?.data ?? []).filter((m) => m.marks_paid !== false),
    [methodsData],
  )

  useEffect(() => {
    if (fixedType && !fixedId) setPartyType(fixedType)
  }, [fixedType, fixedId])

  useEffect(() => {
    if (methods.length > 0 && !methodId) setMethodId(methods[0].id)
  }, [methods, methodId])

  const { data: outstanding } = useQuery({
    queryFn: () =>
      PaymentsService.readOutstanding({
        contraparteType: partyType!,
        contraparteId: partyId!,
      }),
    queryKey: ["payments-outstanding", partyType, partyId],
    enabled: open && partyType != null && partyId != null,
  })

  const totalOutstanding = round2(
    (outstanding?.data ?? []).reduce(
      (acc, doc) => acc + Number(doc.pendiente),
      0,
    ),
  )

  useEffect(() => {
    if (!autoAmount || !open) return
    setAmount(totalOutstanding > 0 ? String(totalOutstanding) : "")
  }, [totalOutstanding, autoAmount, open])

  const selectedParty = parties.find((p) => p.id === partyId) ?? null
  const amountNum = Number(amount)
  const canSubmit = partyId != null && methodId != null && amountNum > 0

  const mutation = useMutation({
    mutationFn: () =>
      PaymentsService.createPaymentReceipt({
        requestBody: {
          contraparte_type: partyType!,
          contraparte_id: partyId!,
          fecha: new Date(`${date}T12:00:00`).toISOString(),
          payments: [{ payment_method_id: methodId!, monto: amountNum }],
        },
      }),
    onSuccess: (receipt) => {
      const name = selectedParty?.razon_social ?? ""
      showSuccessToast(
        t("payments.issued", {
          numero: receipt.document.numero,
          name,
        }),
      )
      onOpenChange(false)
      setPartyId(fixedId ?? null)
      setAmount("")
      setAutoAmount(true)
      onCreated()
      queryClient.invalidateQueries({ queryKey: ["payments-outstanding"] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      queryClient.invalidateQueries({ queryKey: ["account-movements"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setPartyId(fixedId ?? null)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5" />
            {t("payments.receiptDialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("payments.receiptHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!fixedType && (
            <div className="flex flex-col gap-2">
              <Label>{t("payments.counterpartType")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  data-testid="receipt-party-type-customer"
                  variant={partyType === "customer" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setPartyType("customer")
                    setPartyId(null)
                    setAutoAmount(true)
                  }}
                >
                  {t("payments.customer")}
                </Button>
                <Button
                  type="button"
                  data-testid="receipt-party-type-supplier"
                  variant={partyType === "supplier" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setPartyType("supplier")
                    setPartyId(null)
                    setAutoAmount(true)
                  }}
                >
                  {t("payments.supplier")}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t("payments.counterpart")}</Label>
            <Select value={partyId ?? ""} onValueChange={setPartyId}>
              <SelectTrigger
                className="w-full"
                data-testid="receipt-party-select"
              >
                <SelectValue placeholder={t("payments.selectCounterpart")} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.razon_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>{t("payments.date")}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("payments.paymentMethod")}</Label>
              <Select value={methodId ?? ""} onValueChange={setMethodId}>
                <SelectTrigger
                  className="w-full"
                  data-testid="receipt-method-select"
                >
                  <SelectValue placeholder={t("payments.selectMethod")} />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("payments.outstanding")}</Label>
            {partyId ? (
              outstanding === undefined ? (
                <Skeleton className="h-20 w-full" />
              ) : (outstanding?.data ?? []).length === 0 ? (
                <p className="rounded border px-3 py-2 text-sm text-muted-foreground">
                  {t("payments.noOutstanding")}
                </p>
              ) : (
                <ul className="divide-y rounded border py-0">
                  {(outstanding?.data ?? []).map((doc) => (
                    <li
                      key={doc.document_id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs">
                        {doc.numero} · {doc.fecha ? doc.fecha.slice(0, 10) : ""}
                      </span>
                      <span
                        className={cn(
                          "font-mono",
                          Number(doc.pendiente) > 0 && "text-destructive",
                        )}
                      >
                        {money(Number(doc.pendiente))}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="rounded border px-3 py-2 text-sm text-muted-foreground">
                {t("payments.selectCounterpartFirst")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("payments.amount")}</Label>
              <span className="text-xs text-muted-foreground">
                {t("payments.totalOutstanding")}:{" "}
                <span className="font-mono">{money(totalOutstanding)}</span>
              </span>
            </div>
            <Input
              type="number"
              min="0"
              step="0.01"
              data-testid="receipt-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setAutoAmount(false)
              }}
            />
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
            data-testid="receipt-submit"
            loading={mutation.isPending}
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {t("payments.issue")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
