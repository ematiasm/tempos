import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  FilePlus2,
  Minus,
  Plus,
  Printer,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type {
  CostChangeSuggestion,
  DocumentPublic,
  ProductPublic,
  ProductVariantPublic,
} from "@/client"
import {
  CustomersService,
  DocumentsService,
  DocumentTypesService,
  PaymentMethodsService,
  SupplierProductsService,
  SuppliersService,
} from "@/client"
import { PrintVoucherDialog } from "@/components/Documents/VoucherPrint"
import ProductSearch, { type CartLine } from "@/components/Sell/ProductSearch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { useT } from "@/i18n"
import { handleError } from "@/utils"

interface NewDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Auto-issued by voiding (NC) or with dedicated screens (receipts).
const EXCLUDED_PREFIXES = new Set(["NCV", "NCC", "RC", "RP"])

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${n.toFixed(2)}`

const INITIAL_STATE = {
  typeId: null as string | null,
  counterpartId: null as string | null,
  date: new Date().toISOString().slice(0, 10),
  discountTotal: 0,
  methodId: null as string | null,
  amount: 0,
  useCredit: false,
  autoAmount: true,
  cart: [] as CartLine[],
  created: null as DocumentPublic | null,
  suggestions: [] as CostChangeSuggestion[],
  applied: new Set<string>(),
}

const NewDocumentDialog = ({ open, onOpenChange }: NewDocumentDialogProps) => {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [typeId, setTypeId] = useState<string | null>(INITIAL_STATE.typeId)
  const [counterpartId, setCounterpartId] = useState<string | null>(
    INITIAL_STATE.counterpartId,
  )
  const [date, setDate] = useState(INITIAL_STATE.date)
  const [discountTotal, setDiscountTotal] = useState(
    INITIAL_STATE.discountTotal,
  )
  const [methodId, setMethodId] = useState<string | null>(
    INITIAL_STATE.methodId,
  )
  const [amount, setAmount] = useState(INITIAL_STATE.amount)
  const [useCredit, setUseCredit] = useState(INITIAL_STATE.useCredit)
  const [autoAmount, setAutoAmount] = useState(INITIAL_STATE.autoAmount)
  const [cart, setCart] = useState<CartLine[]>(INITIAL_STATE.cart)
  const [created, setCreated] = useState<DocumentPublic | null>(
    INITIAL_STATE.created,
  )
  const [suggestions, setSuggestions] = useState<CostChangeSuggestion[]>(
    INITIAL_STATE.suggestions,
  )
  const [applied, setApplied] = useState<Set<string>>(INITIAL_STATE.applied)
  const [printOpen, setPrintOpen] = useState(false)

  const { data: typesData } = useQuery({
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  })
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

  const types = useMemo(
    () =>
      (typesData?.data ?? []).filter(
        (dt) => dt.is_active && !EXCLUDED_PREFIXES.has(dt.prefix),
      ),
    [typesData],
  )
  const selectedType = types.find((dt) => dt.id === typeId) ?? null
  const customers = useMemo(
    () => (customersData?.data ?? []).filter((c) => c.is_active !== false),
    [customersData],
  )
  const suppliers = useMemo(
    () => (suppliersData?.data ?? []).filter((s) => s.is_active !== false),
    [suppliersData],
  )
  const consumidorFinal = useMemo(
    () => customers.find((c) => c.razon_social === "Consumidor Final"),
    [customers],
  )
  const methods = methodsData?.data ?? []
  const creditMethod = methods.find((m) => m.marks_paid === false) ?? null
  const defaultMethod =
    methods.find((m) => m.marks_paid !== false) ?? methods[0] ?? null
  const onCredit = !!creditMethod && methodId === creditMethod.id

  const isAdjustment = selectedType?.operation === "ajuste"
  const takesPayments = (selectedType?.signo_caja ?? 0) !== 0
  const isCustomerOp = selectedType?.tipo_contraparte === "customer"
  const isSupplierOp = selectedType?.tipo_contraparte === "supplier"

  const selectedCustomer = customers.find((c) => c.id === counterpartId) ?? null
  const creditInFavor =
    selectedCustomer && Number(selectedCustomer.saldo) < 0
      ? -Number(selectedCustomer.saldo)
      : 0

  const { data: pairCostsData } = useQuery({
    queryFn: () =>
      SupplierProductsService.readSupplierProducts({
        supplierId: counterpartId ?? undefined,
        limit: 100,
      }),
    queryKey: ["supplier-products", counterpartId],
    enabled: isSupplierOp && !!counterpartId,
  })
  const pairCosts = pairCostsData?.data ?? []

  useEffect(() => {
    if (!open) return
    setTypeId(INITIAL_STATE.typeId)
    setCounterpartId(INITIAL_STATE.counterpartId)
    setDate(INITIAL_STATE.date)
    setDiscountTotal(INITIAL_STATE.discountTotal)
    setMethodId(INITIAL_STATE.methodId)
    setAmount(INITIAL_STATE.amount)
    setUseCredit(INITIAL_STATE.useCredit)
    setAutoAmount(INITIAL_STATE.autoAmount)
    setCart(INITIAL_STATE.cart)
    setCreated(INITIAL_STATE.created)
    setSuggestions(INITIAL_STATE.suggestions)
    setApplied(INITIAL_STATE.applied)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (isCustomerOp && consumidorFinal && !counterpartId)
      setCounterpartId(consumidorFinal.id)
    if (defaultMethod && !methodId) setMethodId(defaultMethod.id)
  }, [
    open,
    isCustomerOp,
    consumidorFinal,
    counterpartId,
    methodId,
    defaultMethod,
  ])

  const { subtotal, perceptions, total } = useMemo(() => {
    let s = 0
    const perceptionsBase: { rate: number; isPercent: boolean }[] = []
    for (const line of cart) {
      const lineSubtotal = round2(
        line.qty * line.unitPrice * (1 - line.discountPct / 100),
      )
      s = round2(s + lineSubtotal)
      if (!isAdjustment) {
        for (const tax of line.product.taxes ?? []) {
          if (tax.aplica_a === "documento") {
            perceptionsBase.push({
              rate: Number(tax.rate),
              isPercent: tax.is_percent === true,
            })
          }
        }
      }
    }
    let p = 0
    for (const perc of perceptionsBase) {
      const monto = perc.isPercent ? s * (perc.rate / 100) : perc.rate
      p = round2(p + monto)
    }
    const total = round2(s - discountTotal + p)
    return { subtotal: s, perceptions: p, total }
  }, [cart, discountTotal, isAdjustment])

  useEffect(() => {
    if (!autoAmount) return
    const base =
      useCredit && creditInFavor > 0
        ? Math.max(total - creditInFavor, 0)
        : total
    setAmount(round2(base))
  }, [total, useCredit, creditInFavor, autoAmount])

  const cashChange =
    total > 0 && amount > total && !onCredit ? round2(amount - total) : 0

  const appliedFavor =
    creditInFavor > 0
      ? round2(
          Math.min(
            creditInFavor,
            onCredit ? total : Math.max(total - amount, 0),
          ),
        )
      : 0

  const resetForm = () => {
    setCart([])
    setDiscountTotal(0)
    setUseCredit(false)
    setAutoAmount(true)
    setSuggestions([])
    setApplied(new Set())
    setCreated(null)
  }

  const selectType = (id: string) => {
    setTypeId(id)
    setCounterpartId(null)
    setUseCredit(false)
    setAutoAmount(true)
    setCart([])
  }

  const defaultUnitPrice = (
    product: ProductPublic,
    _variant?: ProductVariantPublic,
  ) => {
    if (selectedType?.operation === "compra") {
      const pair = pairCosts.find((p) => p.product_id === product.id)
      return pair ? Number(pair.costo_actual) : Number(product.costo_actual)
    }
    return Number(product.precio_venta)
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
          unitPrice: defaultUnitPrice(product, variant),
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
      if (!typeId) throw new Error("Missing document type")
      return DocumentsService.createDocument({
        requestBody: {
          document_type_id: typeId,
          contraparte_id: selectedType?.tipo_contraparte ? counterpartId : null,
          fecha: new Date(`${date}T12:00:00`).toISOString(),
          descuento_total: isAdjustment ? 0 : discountTotal,
          lines: cart.map((l) => ({
            product_id: l.product.id,
            variant_id: l.variant?.id ?? null,
            cantidad: l.qty,
            precio_unit: isAdjustment ? 0 : l.unitPrice,
            descuento_pct: isAdjustment ? 0 : l.discountPct,
          })),
          payments:
            takesPayments && amount > 0
              ? [{ payment_method_id: methodId!, monto: amount }]
              : [],
        },
      })
    },
    onSuccess: (doc) => {
      showSuccessToast(t("documents.created", { numero: doc.numero }))
      setCreated(doc)
      setSuggestions(doc.cost_change_suggestions ?? [])
      setApplied(new Set())
      setCart([])
      setDiscountTotal(0)
      setUseCredit(false)
      setAutoAmount(true)
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["products-search"] })
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
    !typeId ||
    cart.length === 0 ||
    (selectedType?.tipo_contraparte != null && !counterpartId) ||
    createMutation.isPending

  const counterpartOptions = isSupplierOp ? suppliers : customers

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5" />
            {t("documents.newDocument")}
          </DialogTitle>
          <DialogDescription>
            {t("documents.newDocumentHint")}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <div>
                <h3 className="text-lg font-semibold">{created.numero}</h3>
                <p className="text-muted-foreground">
                  {t("documents.totaling", {
                    total: money(Number(created.total)),
                    counterpart: created.contraparte_name ?? "",
                  })}
                </p>
              </div>
              <div className="flex gap-2">
                <PrintVoucherDialog
                  document={created}
                  open={printOpen}
                  onOpenChange={setPrintOpen}
                />
                <Button variant="outline" onClick={() => setPrintOpen(true)}>
                  <Printer className="mr-2 h-4 w-4" />
                  {t("documents.printVoucher")}
                </Button>
                <Button onClick={resetForm}>
                  {t("documents.newOperation")}
                </Button>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="rounded-lg border p-4">
                <h4 className="mb-2 font-medium">
                  {t("buy.suggestionsTitle")}
                </h4>
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
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("documents.type")}
              </span>
              <Select value={typeId ?? ""} onValueChange={selectType}>
                <SelectTrigger data-testid="doc-type-select">
                  <SelectValue placeholder={t("documents.selectType")} />
                </SelectTrigger>
                <SelectContent>
                  {types.map((dt) => (
                    <SelectItem key={dt.id} value={dt.id}>
                      {dt.name} ({dt.prefix})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedType && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedType.tipo_contraparte && (
                    <div>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {isSupplierOp ? t("buy.supplier") : t("sell.customer")}
                      </span>
                      <Select
                        value={counterpartId ?? ""}
                        onValueChange={(v) => {
                          setCounterpartId(v)
                          setAutoAmount(true)
                        }}
                      >
                        <SelectTrigger data-testid="doc-counterpart-select">
                          <SelectValue
                            placeholder={
                              isSupplierOp
                                ? t("buy.selectSupplier")
                                : t("sell.selectCustomer")
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {counterpartOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.razon_social}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isCustomerOp && selectedCustomer && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("sell.balance", {
                            balance: money(Number(selectedCustomer.saldo)),
                          })}
                        </p>
                      )}
                    </div>
                  )}
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
                  {!isAdjustment && (
                    <div>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t("sell.documentDiscount")}
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        value={discountTotal}
                        onChange={(e) =>
                          setDiscountTotal(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <ProductSearch onAdd={addLine} />
                  {cart.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isAdjustment
                        ? t("documents.ajsEmptyHint")
                        : t("sell.emptyCartHint")}
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">{t("sell.product")}</th>
                            {!isAdjustment && (
                              <th className="w-24 px-2 py-2 text-right">
                                {t("sell.price")}
                              </th>
                            )}
                            <th className="w-24 px-2 py-2 text-right">
                              {t("sell.qty")}
                            </th>
                            {!isAdjustment && (
                              <th className="w-24 px-2 py-2 text-right">
                                {t("sell.discPct")}
                              </th>
                            )}
                            {!isAdjustment && (
                              <th className="w-24 px-3 py-2 text-right">
                                {t("sell.lineTotal")}
                              </th>
                            )}
                            <th className="w-10 px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {cart.map((line, index) => {
                            const lineTotal = round2(
                              line.qty *
                                line.unitPrice *
                                (1 - line.discountPct / 100),
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
                                  {(line.variant?.attribute_values ?? []).map(
                                    (av) => (
                                      <Badge
                                        key={av.id}
                                        variant="outline"
                                        className="ml-1 text-[10px]"
                                      >
                                        {av.value}
                                      </Badge>
                                    ),
                                  )}
                                </td>
                                {!isAdjustment && (
                                  <td className="px-2 py-2 text-right">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="ml-auto h-8 w-24 text-right"
                                      value={line.unitPrice}
                                      onChange={(e) =>
                                        updateLine(index, {
                                          unitPrice:
                                            Number(e.target.value) || 0,
                                        })
                                      }
                                    />
                                  </td>
                                )}
                                <td className="px-2 py-2">
                                  <div className="flex h-8 items-center justify-end gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() =>
                                        updateLine(index, {
                                          qty: Math.max(
                                            0.001,
                                            round2(line.qty - 1),
                                          ),
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
                                        updateLine(index, {
                                          qty: round2(line.qty + 1),
                                        })
                                      }
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </td>
                                {!isAdjustment && (
                                  <td className="px-2 py-2 text-right">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="ml-auto h-8 w-16 px-1 text-right"
                                      value={line.discountPct}
                                      onChange={(e) =>
                                        updateLine(index, {
                                          discountPct:
                                            Number(e.target.value) || 0,
                                        })
                                      }
                                    />
                                  </td>
                                )}
                                {!isAdjustment && (
                                  <td className="px-3 py-2 text-right font-medium">
                                    {money(lineTotal)}
                                  </td>
                                )}
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

                <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("sell.subtotal")}
                    </span>
                    <span>{money(subtotal)}</span>
                  </div>
                  {!isAdjustment && discountTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("sell.discount")}
                      </span>
                      <span>-{money(discountTotal)}</span>
                    </div>
                  )}
                  {!isAdjustment && perceptions > 0 && (
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
                  {isCustomerOp && appliedFavor > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {t("sell.creditInFavor")}
                      </span>
                      <span>-{money(appliedFavor)}</span>
                    </div>
                  )}
                </div>

                {takesPayments && (
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
                        {isSupplierOp ? t("buy.onCredit") : t("sell.onCredit")}
                      </label>
                    )}
                    <div>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t("sell.paymentMethod")}
                      </span>
                      <Select
                        value={methodId ?? ""}
                        onValueChange={setMethodId}
                      >
                        <SelectTrigger data-testid="doc-method-select">
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
                          {isSupplierOp
                            ? t("buy.amountPaid")
                            : t("sell.amountReceived")}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {isSupplierOp
                            ? t("buy.onCreditHint", {
                                amount: money(
                                  round2(Math.max(total - appliedFavor, 0)),
                                ),
                              })
                            : t("sell.onCreditHint", {
                                amount: money(
                                  round2(Math.max(total - appliedFavor, 0)),
                                ),
                              })}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                          {isSupplierOp
                            ? t("buy.amountPaid")
                            : t("sell.amountReceived")}
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
                            {isSupplierOp
                              ? t("buy.onSupplierBalance", {
                                  amount: money(round2(total - amount)),
                                })
                              : t("sell.goOnBalance", {
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
                    {isCustomerOp && creditInFavor > 0 && (
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
                          credit: money(creditInFavor),
                        })}
                      </label>
                    )}
                  </div>
                )}

                <LoadingButton
                  className="w-full"
                  data-testid="create-document-button"
                  loading={createMutation.isPending}
                  disabled={issueDisabled}
                  onClick={() => createMutation.mutate()}
                >
                  {t("documents.issue", { name: selectedType.name })}
                </LoadingButton>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default NewDocumentDialog
