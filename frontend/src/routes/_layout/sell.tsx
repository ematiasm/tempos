import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { SplitSquareHorizontal } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import type {
  DocumentPaymentCreate,
  DocumentPublic,
  PaymentMethodPublic,
  ProductPublic,
  ProductVariantPublic,
} from "@/client"
import { DocumentsService } from "@/client"
import type { CounterpartComboboxControls } from "@/components/Common/CounterpartCombobox"
import { round2, toPaymentCreates } from "@/components/Payments/paymentMath"
import {
  SplitPaymentDialog,
  type SplitPaymentResult,
} from "@/components/Payments/SplitPaymentDialog"
import { CartActionBar } from "@/components/Sell/CartActionBar"
import { CartTable } from "@/components/Sell/CartTable"
import { CashRegisterBar } from "@/components/Sell/CashRegisterBar"
import { PostSaleDialog } from "@/components/Sell/PostSaleDialog"
import ProductSearch from "@/components/Sell/ProductSearch"
import { QuantityModal } from "@/components/Sell/QuantityModal"
import { QuickPaymentBar } from "@/components/Sell/QuickPaymentBar"
import { SellSidebar } from "@/components/Sell/SellSidebar"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { useOpenCashSession } from "@/components/Sell/useOpenCashSession"
import { useReferenceData } from "@/components/Sell/useReferenceData"
import {
  clampQty,
  clearCartSnapshot,
  computeTotals,
  loadCartSnapshot,
  qtyStepFor,
  saveCartSnapshot,
  useSellCart,
} from "@/components/Sell/useSellCart"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { formatStatic, useT } from "@/i18n"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/sell")({
  component: Sell,
  head: () => ({
    meta: [{ title: `${formatStatic("sell.title")} - tempos` }],
  }),
})

/** Payment shortcut keys, mapped by position to the quick methods. */
const PAYMENT_FKEYS = ["F2", "F3", "F4", "F5", "F6"]

function Sell() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()
  const { customers, consumidorFinal, methods, saleTypes } = useReferenceData()
  const { isOpen: sessionOpen } = useOpenCashSession()
  const { settings } = useBusinessSettings()

  const {
    cart,
    addLine,
    updateLine,
    removeLine,
    reset: resetCart,
    restore: restoreCartLines,
  } = useSellCart()
  const [customerId, setCustomerId] = useState<string | null>(null)
  // once the operator explicitly picks (or clears) a customer, the
  // configured default must never re-apply
  const [customerTouched, setCustomerTouched] = useState(false)
  const [docTypeId, setDocTypeId] = useState<string | null>(null)
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [discountTotal, setDiscountTotal] = useState(0)
  const [notes, setNotes] = useState("")
  const [splitOpen, setSplitOpen] = useState(false)
  const [creditWarning, setCreditWarning] = useState(false)
  const [created, setCreated] = useState<DocumentPublic | null>(null)
  const [vuelto, setVuelto] = useState(0)
  // selected cart line (keyboard / action-bar target)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  // decimal-UoM product waiting for a hand-typed quantity (see QuantityModal);
  // lineIndex != null means an existing cart line is being re-quantified
  const [qtyTarget, setQtyTarget] = useState<{
    product: ProductPublic
    variant?: ProductVariantPublic
    lineIndex?: number
    qty?: number
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // customer combobox handle (Alt+C opens + focuses it)
  const customerControlsRef = useRef<CounterpartComboboxControls | null>(null)

  // --- Cart snapshot (sessionStorage) --------------------------------------
  // Nothing is persisted before the restore pass runs, so a reload can never
  // overwrite the stored snapshot with the pristine initial state.
  const [hydrated, setHydrated] = useState(false)
  // one-shot: keeps the restored document type safe from the fiscal-type
  // suggestion that re-runs for the restored customer
  const suppressSuggestRef = useRef<string | null>(null)
  // always-fresh closure for the restore-toast discard action
  const discardRef = useRef<() => void>(() => {})

  // --- Configuration-driven behavior -------------------------------------
  // Ordered quick shortcuts; null (unset) keeps ALL methods in list order.
  const quickMethods = useMemo(() => {
    const ids = settings?.sell_quick_method_ids
    if (!ids) return methods
    const byId = new Map(methods.map((m) => [m.id, m]))
    return ids
      .map((id) => byId.get(id))
      .filter((m): m is PaymentMethodPublic => m != null)
  }, [methods, settings])
  // Fixed document type wins over the tax-condition auto-suggestion.
  const fixedDocTypeId = settings?.sell_default_document_type_id ?? null
  // Preselected customer per sale; falls back to Consumidor Final when the
  // configured customer is missing or inactive.
  const defaultCustomerId = settings?.sell_default_customer_id ?? null
  const blockPriceEdit = settings?.sell_block_price_edit ?? true
  const hideDate = settings?.sell_hide_date ?? false

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const creditInFavor =
    selectedCustomer && Number(selectedCustomer.saldo) < 0
      ? -Number(selectedCustomer.saldo)
      : 0

  // Applies the configured default customer (or Consumidor Final) while the
  // operator has not picked one. DECLARED BEFORE the restore effect on
  // purpose: when reference data lands in the same commit as the restore,
  // both write customerId and the restore's write must win the batch.
  useEffect(() => {
    if (customerTouched) return
    if (defaultCustomerId) {
      const candidate = customers.find((c) => c.id === defaultCustomerId)
      if (candidate) {
        setCustomerId(candidate.id)
        return
      }
    }
    if (!customerId && consumidorFinal) setCustomerId(consumidorFinal.id)
  }, [
    consumidorFinal,
    customerId,
    customerTouched,
    customers,
    defaultCustomerId,
  ])

  // --- Cart snapshot restore (once, when reference data is settled) --------
  // Reference data must be settled before restoring: the fiscal-type
  // suggestion re-runs when saleTypes loads and would clobber the restored
  // document type otherwise. The restored customer is validated here too —
  // the gate below guarantees customers is already loaded.
  useEffect(() => {
    if (hydrated) return
    if (customers.length === 0 || saleTypes.length === 0) return
    setHydrated(true)
    const snapshot = loadCartSnapshot()
    if (!snapshot || snapshot.cart.length === 0) return
    restoreCartLines(snapshot.cart)
    if (snapshot.customerTouched) {
      const restoredId = snapshot.customerId
      if (restoredId && customers.some((c) => c.id === restoredId)) {
        // the operator's pick still exists: it wins over the default the
        // effect above applied within this same commit
        setCustomerTouched(true)
        setCustomerId(restoredId)
      } else if (restoredId) {
        // stale pick (customer deleted or deactivated): fall back to the
        // configured default via the default-customer effect
        setCustomerTouched(false)
      } else {
        // the operator explicitly cleared the customer: keep it cleared
        setCustomerTouched(true)
        setCustomerId(null)
      }
    }
    if (snapshot.docTypeId) {
      setDocTypeId(snapshot.docTypeId)
      if (snapshot.customerId) {
        suppressSuggestRef.current = snapshot.customerId
      }
    }
    setDate(snapshot.date)
    setDiscountTotal(snapshot.discountTotal)
    setNotes(snapshot.notes)
    toast.success(t("sell.cartRestored"), {
      duration: 10000,
      action: {
        label: t("sell.cartRestored.discard"),
        onClick: () => discardRef.current(),
      },
    })
  }, [hydrated, customers, saleTypes, t, restoreCartLines])

  // Discard: clear the snapshot and reset the sell state to its defaults.
  // Re-bound every render so the toast action never closes over stale config.
  useEffect(() => {
    discardRef.current = () => {
      clearCartSnapshot()
      resetCart()
      setCustomerId(null)
      setCustomerTouched(false)
      setDocTypeId(fixedDocTypeId)
      setDate(new Date().toISOString().slice(0, 10))
      setDiscountTotal(0)
      setNotes("")
      setSelectedLine(null)
    }
  })

  // Persist the in-progress sale on every change once hydration is done; an
  // empty cart clears the snapshot instead of storing a husk.
  useEffect(() => {
    if (!hydrated) return
    if (cart.length === 0) {
      clearCartSnapshot()
      return
    }
    saveCartSnapshot({
      version: 1,
      cart,
      customerId,
      customerTouched,
      docTypeId,
      date,
      discountTotal,
      notes,
    })
  }, [
    cart,
    customerId,
    customerTouched,
    docTypeId,
    date,
    discountTotal,
    notes,
    hydrated,
  ])

  useEffect(() => {
    if (fixedDocTypeId) setDocTypeId(fixedDocTypeId)
  }, [fixedDocTypeId])

  useEffect(() => {
    if (!customerId || fixedDocTypeId) return
    // a restored document type survives the suggestion for that customer
    if (
      suppressSuggestRef.current &&
      suppressSuggestRef.current === customerId
    ) {
      suppressSuggestRef.current = null
      return
    }
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
  }, [customerId, fixedDocTypeId, saleTypes])

  useEffect(() => {
    if (customerId) setCreditWarning(false)
  }, [customerId])

  const { subtotal, perceptions, total } = useMemo(
    () => computeTotals(cart, discountTotal),
    [cart, discountTotal],
  )

  const createMutation = useMutation({
    mutationFn: ({
      payments,
      vuelto: saleVuelto,
    }: {
      payments: DocumentPaymentCreate[]
      vuelto: number
    }) => {
      if (!docTypeId || !customerId) throw new Error("Missing type or customer")
      return DocumentsService.createDocument({
        requestBody: {
          document_type_id: docTypeId,
          contraparte_id: customerId,
          fecha: new Date(`${date}T12:00:00`).toISOString(),
          descuento_total: discountTotal,
          notes: notes.trim() ? notes : null,
          lines: cart.map((l) => ({
            product_id: l.product.id,
            variant_id: l.variant?.id ?? null,
            cantidad: l.qty,
            precio_unit: l.unitPrice,
            descuento_pct: l.discountPct,
          })),
          payments,
        },
      }).then((doc) => ({ doc, vuelto: saleVuelto }))
    },
    onSuccess: ({ doc, vuelto: saleVuelto }) => {
      showSuccessToast(t("sell.issued", { numero: doc.numero }))
      clearCartSnapshot()
      setCreated(doc)
      setVuelto(saleVuelto)
      resetCart()
      setSelectedLine(null)
      setDiscountTotal(0)
      setNotes("")
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["products-search"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  // Cash-session gate: without an open session no sale can be issued and the
  // CashRegisterBar open prompt is the visible call to action. A
  // cash_session_required slip-through is surfaced by handleError and the
  // cart is preserved (the failed mutation never resets state).
  const baseDisabled =
    !sessionOpen ||
    cart.length === 0 ||
    !docTypeId ||
    !customerId ||
    createMutation.isPending
  const quickCreditDisabled =
    !sessionOpen || cart.length === 0 || !docTypeId || createMutation.isPending

  const payWithMethod = (method: PaymentMethodPublic) => {
    if (method.marks_paid === false && !customerId) {
      setCreditWarning(true)
      return
    }
    createMutation.mutate({
      payments: [{ payment_method_id: method.id, monto: total }],
      vuelto: 0,
    })
  }

  /** Removes a line and keeps the selection on a sensible neighbor. */
  const handleRemoveLine = (index: number) => {
    removeLine(index)
    setSelectedLine((prev) => {
      if (prev === null) return null
      const remaining = cart.length - 1
      if (remaining === 0) return null
      if (prev === index) return Math.min(prev, remaining - 1)
      return prev < index ? prev : prev - 1
    })
  }

  const focusLineDiscount = (index: number) => {
    document.getElementById(`cart-discount-${index}`)?.focus()
  }

  /** Products whose UoM allows decimals never auto-add 1: the operator hand-
   * types the quantity in the modal. Integer UoMs keep the auto-add behavior. */
  const handleAdd = (
    product: ProductPublic,
    variant?: ProductVariantPublic,
  ) => {
    if ((product.uom?.decimal_places ?? 0) > 0) {
      setQtyTarget({ product, variant })
      return
    }
    addLine(product, variant)
  }

  const handleNewSale = () => {
    setCreated(null)
    setVuelto(0)
    setSelectedLine(null)
    searchInputRef.current?.focus()
  }

  // --- Cart keyboard ------------------------------------------------------
  // Active only with focus OUTSIDE any text/number input, so the search bar,
  // price/discount/qty inputs and dialogs are never hijacked. The listener is
  // registered once; a ref always points at the freshest handler closure.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
    }

    const onKey = (e: KeyboardEvent) => {
      if (cart.length === 0) return
      if (created || splitOpen || qtyTarget) return
      // Skip while ANY Radix dialog is open (e.g. cash open/close): focus may
      // land on a button, so the typing-target check alone is not enough.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (isTypingTarget(e.target)) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedLine((prev) =>
          prev === null ? 0 : Math.min(prev + 1, cart.length - 1),
        )
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedLine((prev) => (prev === null ? 0 : Math.max(prev - 1, 0)))
        return
      }
      if (selectedLine === null) return
      const line = cart[selectedLine]
      if (!line) return
      const dp = line.product.uom?.decimal_places ?? 0

      if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        updateLine(selectedLine, {
          qty: clampQty(line.qty + qtyStepFor(dp), dp),
        })
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        updateLine(selectedLine, {
          qty: clampQty(line.qty - qtyStepFor(dp), dp),
        })
      } else if (e.key === "Enter" && dp > 0) {
        e.preventDefault()
        setQtyTarget({
          product: line.product,
          variant: line.variant,
          lineIndex: selectedLine,
          qty: line.qty,
        })
      } else if (e.key === "Delete") {
        e.preventDefault()
        handleRemoveLine(selectedLine)
      }
    }
    keyHandlerRef.current = onKey
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  // --- Payment shortcuts (global) -----------------------------------------
  // F2..F6 confirm the sale with the first five quick methods; Alt+C focuses
  // the customer combobox. Registered once; a ref always points at the
  // freshest handler closure. Decision: while ANY dialog is open (split
  // payment, quantity, print, ...) the shortcuts are swallowed — the modal
  // always wins over the payment keys.
  const payKeysHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyC") {
        e.preventDefault()
        customerControlsRef.current?.openAndFocus()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const index = PAYMENT_FKEYS.indexOf(e.key)
      if (index === -1) return
      e.preventDefault()
      const method = quickMethods[index]
      if (!method) return
      // Same gates as the quick buttons: reuse them, do not duplicate rules.
      if (method.marks_paid === false ? quickCreditDisabled : baseDisabled)
        return
      payWithMethod(method)
    }
    payKeysHandlerRef.current = onKey
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => payKeysHandlerRef.current(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  if (created) {
    return (
      <PostSaleDialog
        document={created}
        vuelto={vuelto}
        onDocumentChange={setCreated}
        onNewSale={handleNewSale}
      />
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
          {/* Scanner-friendly: debounced typing + Enter re-fetches the raw
              term when results are missing, so a scan is never lost. */}
          <ProductSearch
            onAdd={handleAdd}
            inputRef={searchInputRef}
            scanEnter
            debounceMs={150}
          />

          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sell.emptyCartHint")}
            </p>
          ) : (
            <>
              <CartTable
                cart={cart}
                onUpdateLine={updateLine}
                onRemoveLine={handleRemoveLine}
                selectedIndex={selectedLine}
                onSelectLine={setSelectedLine}
                blockPriceEdit={blockPriceEdit}
              />
              {selectedLine !== null && cart[selectedLine] && (
                <CartActionBar
                  line={cart[selectedLine]}
                  onIncrease={() => {
                    const line = cart[selectedLine]
                    const dp = line.product.uom?.decimal_places ?? 0
                    updateLine(selectedLine, {
                      qty: clampQty(line.qty + qtyStepFor(dp), dp),
                    })
                  }}
                  onDecrease={() => {
                    const line = cart[selectedLine]
                    const dp = line.product.uom?.decimal_places ?? 0
                    updateLine(selectedLine, {
                      qty: clampQty(line.qty - qtyStepFor(dp), dp),
                    })
                  }}
                  onDiscount={() => focusLineDiscount(selectedLine)}
                  onRemove={() => handleRemoveLine(selectedLine)}
                />
              )}
            </>
          )}
        </div>

        <SellSidebar
          customers={customers}
          saleTypes={saleTypes}
          selectedCustomer={selectedCustomer}
          customerId={customerId}
          customerControlsRef={customerControlsRef}
          onCustomerChange={(v) => {
            setCustomerTouched(true)
            setCustomerId(v)
          }}
          docTypeId={docTypeId}
          onDocTypeChange={setDocTypeId}
          date={date}
          onDateChange={setDate}
          discountTotal={discountTotal}
          onDiscountChange={setDiscountTotal}
          hideDate={hideDate}
          notes={notes}
          onNotesChange={setNotes}
          subtotal={subtotal}
          perceptions={perceptions}
          total={total}
          appliedFavor={round2(Math.min(creditInFavor, total))}
        >
          <div className="flex flex-col gap-3">
            <QuickPaymentBar
              methods={quickMethods}
              disabledForPaid={baseDisabled}
              disabledForCredit={quickCreditDisabled}
              onPay={payWithMethod}
            />
            {creditWarning && (
              <p
                className="text-xs text-destructive"
                role="alert"
                data-testid="credit-customer-warning"
              >
                {t("sell.quickPayment.customerRequired")}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              data-testid="split-payment-button"
              disabled={baseDisabled}
              title={!sessionOpen ? t("cash.registerClosedHint") : undefined}
              onClick={() => setSplitOpen(true)}
            >
              <SplitSquareHorizontal className="mr-2 h-4 w-4" />
              {t("sell.quickPayment.splitEntry")}
            </Button>
          </div>
        </SellSidebar>
      </div>

      <SplitPaymentDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        methods={methods}
        total={total}
        creditInFavor={creditInFavor}
        mode="counter"
        party="customer"
        pending={createMutation.isPending}
        onConfirm={(result: SplitPaymentResult) => {
          setSplitOpen(false)
          createMutation.mutate({
            payments: toPaymentCreates(result.rows),
            vuelto: result.vuelto,
          })
        }}
      />

      <QuantityModal
        open={qtyTarget !== null}
        product={qtyTarget?.product ?? null}
        variant={qtyTarget?.variant}
        initialQty={
          qtyTarget?.lineIndex != null ? (qtyTarget.qty ?? null) : null
        }
        onConfirm={(qty) => {
          if (qtyTarget) {
            if (qtyTarget.lineIndex != null) {
              updateLine(qtyTarget.lineIndex, { qty })
            } else {
              addLine(qtyTarget.product, qtyTarget.variant, qty)
            }
          }
          setQtyTarget(null)
        }}
        onOpenChange={(open) => {
          if (!open) setQtyTarget(null)
        }}
      />
    </div>
  )
}

export default Sell
