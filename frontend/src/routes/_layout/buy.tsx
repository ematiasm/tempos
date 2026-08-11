import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CheckCircle2, Minus, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type {
  CostChangeSuggestion,
  DocumentPublic,
  ProductPublic,
  ProductVariantPublic,
} from "@/client"
import {
  DocumentsService,
  DocumentTypesService,
  PaymentMethodsService,
  SupplierProductsService,
  SuppliersService,
} from "@/client"
import ProductSearch, { type CartLine } from "@/components/Sell/ProductSearch"
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
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/buy")({
  component: Buy,
  head: () => ({
    meta: [{ title: `${formatStatic("buy.title")} - tempos` }],
  }),
})

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${n.toFixed(2)}`

function Buy() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()

  const { data: suppliersData } = useQuery({
    queryFn: () => SuppliersService.readSuppliers({ skip: 0, limit: 1000 }),
    queryKey: ["suppliers"],
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

  const suppliers = (suppliersData?.data ?? []).filter(
    (s) => s.is_active !== false,
  )
  const methods = methodsData?.data ?? []
  const ocType = typesData?.data.find(
    (t) => t.is_active && t.operation === "compra" && t.prefix === "OC",
  )

  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [discountTotal, setDiscountTotal] = useState(0)
  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState(0)
  const [created, setCreated] = useState<DocumentPublic | null>(null)
  const [suggestions, setSuggestions] = useState<CostChangeSuggestion[]>([])
  const [applied, setApplied] = useState<Set<string>>(new Set())

  const creditMethod = methods.find((m) => m.marks_paid === false) ?? null
  const defaultMethod =
    methods.find((m) => m.marks_paid !== false) ?? methods[0] ?? null
  const onCredit = !!creditMethod && methodId === creditMethod.id

  const { data: pairCostsData } = useQuery({
    queryFn: () =>
      SupplierProductsService.readSupplierProducts({
        supplierId: supplierId ?? undefined,
        limit: 100,
      }),
    queryKey: ["supplier-products", supplierId],
    enabled: !!supplierId,
  })
  const pairCosts = pairCostsData?.data ?? []

  useEffect(() => {
    if (defaultMethod && !methodId) setMethodId(defaultMethod.id)
  }, [methodId, defaultMethod])

  const subtotal = useMemo(() => {
    let s = 0
    for (const line of cart) {
      s = round2(s + line.qty * line.unitPrice * (1 - line.discountPct / 100))
    }
    return s
  }, [cart])
  const total = round2(subtotal - discountTotal)

  useEffect(() => {
    setAmount(total)
  }, [total])

  const defaultCostFor = (
    product: ProductPublic,
    _variant?: ProductVariantPublic,
  ) => {
    const pair = pairCosts.find((p) => p.product_id === product.id)
    return pair ? Number(pair.costo_actual) : Number(product.costo_actual)
  }

  const addLine = (product: ProductPublic, variant?: ProductVariantPublic) => {
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
          unitPrice: defaultCostFor(product, variant),
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
      if (!ocType || !supplierId)
        throw new Error("Missing supplier or doc type")
      return DocumentsService.createDocument({
        requestBody: {
          document_type_id: ocType.id,
          contraparte_id: supplierId,
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
      showSuccessToast(t("buy.created", { numero: doc.numero }))
      setCreated(doc)
      setSuggestions(doc.cost_change_suggestions ?? [])
      setApplied(new Set())
      setCart([])
      setDiscountTotal(0)
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["supplier-products"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const applyMutation = useMutation({
    mutationFn: (suggestion: CostChangeSuggestion) => {
      const costo_actual = Number(suggestion.suggested_cost)
      if (suggestion.previous_cost == null) {
        return SupplierProductsService.createSupplierProduct({
          requestBody: {
            supplier_id: suggestion.supplier_id,
            product_id: suggestion.product_id,
            costo_actual,
            es_referencia: true,
          },
        })
      }
      return SupplierProductsService.updateSupplierProduct({
        supplierId: suggestion.supplier_id,
        productId: suggestion.product_id,
        requestBody: { costo_actual, es_referencia: true },
      })
    },
    onSuccess: (_data, suggestion) => {
      showSuccessToast(t("buy.costUpdated"))
      setApplied((prev) => new Set(prev).add(suggestion.product_id))
      queryClient.invalidateQueries({ queryKey: ["supplier-products"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const issueDisabled =
    cart.length === 0 || !ocType || !supplierId || createMutation.isPending

  const newPurchase = () => {
    setCreated(null)
    setSuggestions([])
    setCart([])
  }

  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <div>
            <h2 className="text-xl font-semibold">{created.numero}</h2>
            <p className="text-muted-foreground">
              {t("buy.totaling", {
                total: money(Number(created.total)),
                supplier: created.contraparte_name ?? "",
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={newPurchase}>{t("buy.newPurchase")}</Button>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-lg border p-4">
            <h3 className="mb-2 font-medium">{t("buy.suggestionsTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("buy.suggestionsHint")}
            </p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => {
                const already = applied.has(s.product_id)
                return (
                  <li
                    key={s.product_id}
                    className="flex items-center justify-between gap-3 rounded border px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium">{s.product_name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {s.previous_cost == null
                          ? t("buy.noPreviousCost")
                          : `${money(Number(s.previous_cost))} → ${money(Number(s.suggested_cost))}`}
                      </span>
                      {s.is_reference && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("buy.referenceSupplier")}
                        </span>
                      )}
                    </div>
                    <LoadingButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={already || applyMutation.isPending}
                      loading={
                        applyMutation.isPending &&
                        applyMutation.variables?.product_id === s.product_id
                      }
                      onClick={() => applyMutation.mutate(s)}
                    >
                      {already
                        ? t("buy.applied")
                        : t("buy.apply", {
                            cost: money(Number(s.suggested_cost)),
                          })}
                    </LoadingButton>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("buy.title")}</h1>
        <p className="text-muted-foreground">{t("buy.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-4">
          <ProductSearch onAdd={addLine} />

          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("buy.emptyCartHint")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t("buy.product")}</th>
                    <th className="w-24 px-2 py-2 text-right">
                      {t("buy.unitCost")}
                    </th>
                    <th className="w-24 px-2 py-2 text-right">
                      {t("buy.qty")}
                    </th>
                    <th className="w-20 px-2 py-2 text-right">
                      {t("buy.discPct")}
                    </th>
                    <th className="w-24 px-3 py-2 text-right">
                      {t("buy.lineTotal")}
                    </th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cart.map((line, index) => {
                    const lineTotal = round2(
                      line.qty * line.unitPrice * (1 - line.discountPct / 100),
                    )
                    return (
                      <tr
                        key={`${line.product.id}-${line.variant?.id ?? "base"}`}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {line.product.name}
                          </span>
                          {line.variant?.sku_suffix && (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {line.variant.sku_suffix}
                            </span>
                          )}
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
                {t("buy.supplier")}
              </span>
              <Select
                value={supplierId ?? ""}
                onValueChange={(v) => {
                  setSupplierId(v)
                  setCart([])
                }}
              >
                <SelectTrigger data-testid="supplier-select">
                  <SelectValue placeholder={t("buy.selectSupplier")} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.razon_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("buy.date")}
              </span>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("buy.documentDiscount")}
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
              <span className="text-muted-foreground">{t("buy.subtotal")}</span>
              <span>{money(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("buy.discount")}
                </span>
                <span>-{money(discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t font-semibold">
              <span>{t("buy.total")}</span>
              <span>{money(total)}</span>
            </div>
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
                    setAmount(total)
                  }}
                  className="h-3.5 w-3.5"
                />
                {t("buy.onCredit")}
              </label>
            )}
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("buy.paymentMethod")}
              </span>
              <Select value={methodId ?? ""} onValueChange={setMethodId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("buy.selectMethod")} />
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
                  {t("buy.amountPaid")}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t("buy.onCreditHint", { amount: money(total) })}
                </p>
              </div>
            ) : (
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("buy.amountPaid")}
                </span>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                />
                {amount > 0 && amount < total && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("buy.onSupplierBalance", {
                      amount: money(round2(total - amount)),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <LoadingButton
            className="w-full"
            data-testid="create-purchase-button"
            loading={createMutation.isPending}
            disabled={issueDisabled}
            onClick={() => createMutation.mutate()}
          >
            {t("buy.createPurchase", { total: money(total) })}
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}

export default Buy
