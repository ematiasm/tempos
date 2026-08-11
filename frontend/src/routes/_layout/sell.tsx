import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CheckCircle2, Minus, Plus, Printer, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { DocumentPublic } from "@/client"
import {
  CustomersService,
  DocumentsService,
  DocumentTypesService,
  PaymentMethodsService,
} from "@/client"
import { PrintVoucherDialog } from "@/components/Documents/VoucherPrint"
import ProductSearch, { type CartLine } from "@/components/Sell/ProductSearch"
import { Badge } from "@/components/ui/badge"
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
import { formatStatic, useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/sell")({
  component: Sell,
  head: () => ({
    meta: [{ title: `${formatStatic("sell.title")} - tempos` }],
  }),
})

const SALE_PREFIXES = ["FA", "FB", "FC", "TCK"]

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${n.toFixed(2)}`

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

function computeTotals(cart: CartLine[], discountTotal: number) {
  let subtotal = 0
  const perceptionsBase: { rate: number; isPercent: boolean }[] = []
  for (const line of cart) {
    const lineSubtotal = round2(
      line.qty * line.unitPrice * (1 - line.discountPct / 100),
    )
    subtotal = round2(subtotal + lineSubtotal)
    for (const tax of line.product.taxes ?? []) {
      if (tax.aplica_a === "documento") {
        perceptionsBase.push({
          rate: Number(tax.rate),
          isPercent: tax.is_percent === true,
        })
      }
    }
  }
  let perceptions = 0
  for (const p of perceptionsBase) {
    const monto = p.isPercent ? subtotal * (p.rate / 100) : p.rate
    perceptions = round2(perceptions + monto)
  }
  const total = round2(subtotal - discountTotal + perceptions)
  return { subtotal, perceptions, total }
}

function Sell() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()
  const { customers, consumidorFinal, methods, saleTypes } = useReferenceData()

  const [cart, setCart] = useState<CartLine[]>([])
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

  const addLine = (
    product: CartLine["product"],
    variant?: CartLine["variant"],
  ) => {
    const existing = cart.find(
      (l) =>
        l.product.id === product.id &&
        (l.variant?.id ?? null) === (variant?.id ?? null),
    )
    if (existing) {
      setCart((prev) =>
        prev.map((l) =>
          l === existing ? { ...l, qty: round2(l.qty + 1) } : l,
        ),
      )
    } else {
      setCart([
        ...cart,
        {
          product,
          variant,
          qty: 1,
          unitPrice: Number(product.precio_venta),
          discountPct: 0,
        },
      ])
    }
  }

  const updateLine = (index: number, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    )
  }

  const removeLine = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index))
  }

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
      setCart([])
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
              total: money(Number(created.total)),
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

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-4">
          <ProductSearch onAdd={addLine} />

          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sell.emptyCartHint")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t("sell.product")}</th>
                    <th className="w-24 px-2 py-2 text-right">
                      {t("sell.price")}
                    </th>
                    <th className="w-24 px-2 py-2 text-right">
                      {t("sell.qty")}
                    </th>
                    <th className="w-24 px-2 py-2 text-right">
                      {t("sell.discPct")}
                    </th>
                    <th className="w-24 px-3 py-2 text-right">
                      {t("sell.lineTotal")}
                    </th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cart.map((line, index) => {
                    const stock = line.variant
                      ? Number(line.variant.stock_current)
                      : Number(line.product.stock_current)
                    const lineTotal = round2(
                      line.qty * line.unitPrice * (1 - line.discountPct / 100),
                    )
                    const lowStock = line.qty > stock
                    return (
                      <tr
                        key={`${line.product.id}-${line.variant?.id ?? "base"}`}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {line.product.name}
                          </span>
                          {line.variant && (
                            <div className="flex gap-1">
                              {line.variant.sku_suffix && (
                                <Badge
                                  variant="secondary"
                                  className="font-mono text-[10px]"
                                >
                                  {line.variant.sku_suffix}
                                </Badge>
                              )}
                              {(line.variant.attribute_values ?? []).map(
                                (av) => (
                                  <Badge
                                    key={av.id}
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    {av.value}
                                  </Badge>
                                ),
                              )}
                            </div>
                          )}
                          <span
                            className={cn(
                              "text-xs",
                              lowStock
                                ? "text-amber-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {t("sell.stockHint", { stock })}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="ml-auto h-8 w-24 text-right"
                            value={line.unitPrice}
                            onChange={(e) =>
                              updateLine(index, {
                                unitPrice: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex h-8 items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() =>
                                updateLine(index, {
                                  qty: Math.max(0.001, round2(line.qty - 1)),
                                })
                              }
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              step="0.001"
                              className="h-8 w-16 px-1 text-right"
                              value={line.qty}
                              onChange={(e) =>
                                updateLine(index, {
                                  qty: Number(e.target.value) || 0,
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() =>
                                updateLine(index, { qty: round2(line.qty + 1) })
                              }
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="ml-auto h-8 w-16 px-1 text-right"
                            value={line.discountPct}
                            onChange={(e) =>
                              updateLine(index, {
                                discountPct: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {money(lineTotal)}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeLine(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-4 rounded-lg border p-4 lg:w-[340px]">
          <div className="grid gap-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sell.customer")}
              </span>
              <Select
                value={customerId ?? ""}
                onValueChange={(v) => {
                  setCustomerId(v)
                  setAutoAmount(true)
                }}
              >
                <SelectTrigger data-testid="customer-select">
                  <SelectValue placeholder={t("sell.selectCustomer")} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.razon_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer && Number(selectedCustomer.saldo) !== 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sell.balance", {
                    balance: money(Number(selectedCustomer.saldo)),
                  })}
                </p>
              )}
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sell.documentType")}
              </span>
              <Select value={docTypeId ?? ""} onValueChange={setDocTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("sell.auto")} />
                </SelectTrigger>
                <SelectContent>
                  {saleTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.prefix})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sell.date")}
              </span>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sell.documentDiscount")}
              </span>
              <Input
                type="number"
                step="0.01"
                value={discountTotal}
                onChange={(e) => setDiscountTotal(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("sell.subtotal")}
              </span>
              <span>{money(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("sell.discount")}
                </span>
                <span>-{money(discountTotal)}</span>
              </div>
            )}
            {perceptions > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("sell.perceptions")}
                </span>
                <span>{money(perceptions)}</span>
              </div>
            )}
            <div className="flex justify-between border-t font-semibold">
              <span>{t("sell.total")}</span>
              <span>{money(total)}</span>
            </div>
            {appliedFavor > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("sell.creditInFavor")}
                </span>
                <span>-{money(appliedFavor)}</span>
              </div>
            )}
          </div>

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
                    amount: money(round2(Math.max(total - appliedFavor, 0))),
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
                      amount: money(round2(total - amount)),
                    })}
                  </p>
                )}
                {cashChange > 0 && (
                  <p className="mt-1 text-xs text-emerald-600">
                    {t("sell.changeDue", { change: money(cashChange) })}
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
                {t("sell.useCredit", { credit: money(creditInFavor) })}
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
            {t("sell.issueSale", { total: money(total) })}
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}

export default Sell
