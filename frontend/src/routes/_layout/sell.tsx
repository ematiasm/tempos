import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CheckCircle2, Printer } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { DocumentPublic } from "@/client"
import {
  CustomersService,
  DocumentsService,
  DocumentTypesService,
  PaymentMethodsService,
} from "@/client"
import { PrintVoucherDialog } from "@/components/Documents/VoucherPrint"
import { CartTable } from "@/components/Sell/CartTable"
import { CashRegisterBar } from "@/components/Sell/CashRegisterBar"
import ProductSearch from "@/components/Sell/ProductSearch"
import { round2 } from "@/components/Sell/paymentMath"
import { SellSidebar } from "@/components/Sell/SellSidebar"
import { computeTotals, useSellCart } from "@/components/Sell/useSellCart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { formatStatic, useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/sell")({
  component: Sell,
  head: () => ({
    meta: [{ title: `${formatStatic("sell.title")} - tempos` }],
  }),
})

const SALE_PREFIXES = ["FA", "FB", "FC", "TCK"]

function useReferenceData() {
  const { data: customersData } = useQuery({
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
  })
  const { data: typesData } = useQuery({
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  })
  const customers = useMemo(
    () => (customersData?.data ?? []).filter((c) => c.is_active !== false),
    [customersData],
  )
  const consumidorFinal = useMemo(
    () => customers.find((c) => c.razon_social === "Consumidor Final"),
    [customers],
  )
  const methods = methodsData?.data ?? []
  const saleTypes = useMemo(
    () =>
      (typesData?.data ?? []).filter(
        (t) =>
          t.is_active &&
          t.operation === "venta" &&
          SALE_PREFIXES.includes(t.prefix),
      ),
    [typesData],
  )
  return { customers, consumidorFinal, methods, saleTypes }
}

function Sell() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()
  const { numberFormat } = useLocale()
  const { customers, consumidorFinal, methods, saleTypes } = useReferenceData()

  const {
    cart,
    addLine,
    updateLine,
    removeLine,
    reset: resetCart,
  } = useSellCart()
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [docTypeId, setDocTypeId] = useState<string | null>(null)
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [discountTotal, setDiscountTotal] = useState(0)
  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number>(0)
  const [useCredit, setUseCredit] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [autoAmount, setAutoAmount] = useState(true)
  const [created, setCreated] = useState<DocumentPublic | null>(null)

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const creditInFavor =
    selectedCustomer && Number(selectedCustomer.saldo) < 0
      ? -Number(selectedCustomer.saldo)
      : 0

  const creditMethod = methods.find((m) => m.marks_paid === false) ?? null
  const defaultMethod =
    methods.find((m) => m.marks_paid !== false) ?? methods[0] ?? null
  const onCredit = !!creditMethod && methodId === creditMethod.id

  useEffect(() => {
    if (consumidorFinal && !customerId) setCustomerId(consumidorFinal.id)
    if (defaultMethod && !methodId) setMethodId(defaultMethod.id)
  }, [consumidorFinal, customerId, methodId, defaultMethod])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    DocumentsService.suggestFiscalSaleType({ customerId }).then(
      (suggested) => {
        if (cancelled) return
        if (saleTypes.some((t) => t.id === suggested.id))
          setDocTypeId(suggested.id)
      },
      () => {
        if (!cancelled) setDocTypeId((prev) => prev ?? saleTypes[0]?.id ?? null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [customerId, saleTypes])

  useEffect(() => {
    if (selectedCustomer && Number(selectedCustomer.saldo) < 0)
      setUseCredit(true)
  }, [selectedCustomer])

  const { subtotal, perceptions, total } = useMemo(
    () => computeTotals(cart, discountTotal),
    [cart, discountTotal],
  )

  useEffect(() => {
    if (!autoAmount) return
    const base = useCredit ? Math.max(total - creditInFavor, 0) : total
    setAmount(round2(base))
  }, [total, useCredit, creditInFavor, autoAmount])

  const cashChange = total > 0 && amount > total ? round2(amount - total) : 0

  const appliedFavor =
    creditInFavor > 0
      ? round2(
          Math.min(
            creditInFavor,
            onCredit ? total : Math.max(total - amount, 0),
          ),
        )
      : 0

  const createMutation = useMutation({
    mutationFn: () => {
      if (!docTypeId || !customerId) throw new Error("Missing type or customer")
      return DocumentsService.createDocument({
        requestBody: {
          document_type_id: docTypeId,
          contraparte_id: customerId,
          fecha: new Date(`${date}T12:00:00`).toISOString(),
          descuento_total: discountTotal,
          lines: cart.map((l) => ({
            product_id: l.product.id,
            variant_id: l.variant?.id ?? null,
            cantidad: l.qty,
            precio_unit: l.unitPrice,
            descuento_pct: l.discountPct,
          })),
          payments:
            amount > 0 ? [{ payment_method_id: methodId!, monto: amount }] : [],
        },
      })
    },
    onSuccess: (doc) => {
      showSuccessToast(t("sell.issued", { numero: doc.numero }))
      setCreated(doc)
      resetCart()
      setDiscountTotal(0)
      setUseCredit(false)
      setAutoAmount(true)
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["products-search"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const issueDisabled =
    cart.length === 0 || !docTypeId || !customerId || createMutation.isPending

  if (created) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <div>
          <h2
            className="text-xl font-semibold"
            data-testid="sale-success-numero"
          >
            {created.numero}
          </h2>
          <p className="text-muted-foreground">
            {t("sell.totaling", {
              total: money(Number(created.total), numberFormat),
              customer: created.contraparte_name ?? "",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <PrintVoucherDialog
            document={created}
            open={printOpen}
            onOpenChange={setPrintOpen}
          />
          <Button onClick={() => setCreated(null)}>{t("sell.newSale")}</Button>
          <Button variant="secondary" onClick={() => setCreated(null)}>
            {t("sell.keepSelling")}
          </Button>
          <Button variant="outline" onClick={() => setPrintOpen(true)}>
            <Printer className="mr-2 h-4 w-4" />
            {t("sell.printVoucher")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("sell.title")}</h1>
        <p className="text-muted-foreground">{t("sell.subtitle")}</p>
      </div>

      <CashRegisterBar />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-4">
          <ProductSearch onAdd={addLine} />

          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sell.emptyCartHint")}
            </p>
          ) : (
            <CartTable
              cart={cart}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
            />
          )}
        </div>

        <SellSidebar
          customers={customers}
          saleTypes={saleTypes}
          selectedCustomer={selectedCustomer}
          customerId={customerId}
          onCustomerChange={(v) => {
            setCustomerId(v)
            setAutoAmount(true)
          }}
          docTypeId={docTypeId}
          onDocTypeChange={setDocTypeId}
          date={date}
          onDateChange={setDate}
          discountTotal={discountTotal}
          onDiscountChange={setDiscountTotal}
          subtotal={subtotal}
          perceptions={perceptions}
          total={total}
          appliedFavor={appliedFavor}
        >
          <div className="grid gap-3">
            {creditMethod && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={onCredit}
                  onChange={(e) => {
                    setMethodId(
                      e.target.checked
                        ? creditMethod.id
                        : (defaultMethod?.id ?? null),
                    )
                    setAutoAmount(true)
                  }}
                  className="h-3.5 w-3.5"
                />
                {t("sell.onCredit")}
              </label>
            )}
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sell.paymentMethod")}
              </span>
              <Select value={methodId ?? ""} onValueChange={setMethodId}>
                <SelectTrigger data-testid="payment-method-select">
                  <SelectValue placeholder={t("sell.selectMethod")} />
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
            {onCredit ? (
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("sell.amountReceived")}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t("sell.onCreditHint", {
                    amount: money(
                      round2(Math.max(total - appliedFavor, 0)),
                      numberFormat,
                    ),
                  })}
                </p>
              </div>
            ) : (
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("sell.amountReceived")}
                </span>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(Number(e.target.value) || 0)
                    setAutoAmount(false)
                  }}
                />
                {amount > 0 && amount < total && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("sell.goOnBalance", {
                      amount: money(round2(total - amount), numberFormat),
                    })}
                  </p>
                )}
                {cashChange > 0 && (
                  <p className="mt-1 text-xs text-emerald-600">
                    {t("sell.changeDue", {
                      change: money(cashChange, numberFormat),
                    })}
                  </p>
                )}
              </div>
            )}

            {creditInFavor > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useCredit}
                  onChange={(e) => {
                    setUseCredit(e.target.checked)
                    setAutoAmount(true)
                  }}
                  className="h-3.5 w-3.5"
                />
                {t("sell.useCredit", {
                  credit: money(creditInFavor, numberFormat),
                })}
              </label>
            )}
          </div>
          <LoadingButton
            className="w-full"
            data-testid="issue-sale-button"
            loading={createMutation.isPending}
            disabled={issueDisabled}
            onClick={() => createMutation.mutate()}
          >
            {t("sell.issueSale", { total: money(total, numberFormat) })}
          </LoadingButton>
        </SellSidebar>
      </div>
    </div>
  )
}

export default Sell
