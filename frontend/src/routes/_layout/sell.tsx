import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { SplitSquareHorizontal } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type {
  DocumentPaymentCreate,
  DocumentPublic,
  PaymentMethodPublic,
  ProductPublic,
  ProductVariantPublic,
} from "@/client"
import { DocumentsService } from "@/client"
import { CartTable } from "@/components/Sell/CartTable"
import { CashRegisterBar } from "@/components/Sell/CashRegisterBar"
import { PostSaleDialog } from "@/components/Sell/PostSaleDialog"
import ProductSearch from "@/components/Sell/ProductSearch"
import { round2 } from "@/components/Sell/paymentMath"
import { QuantityModal } from "@/components/Sell/QuantityModal"
import { QuickPaymentBar } from "@/components/Sell/QuickPaymentBar"
import { SellSidebar } from "@/components/Sell/SellSidebar"
import { SplitPaymentDialog } from "@/components/Sell/SplitPaymentDialog"
import { useOpenCashSession } from "@/components/Sell/useOpenCashSession"
import { useReferenceData } from "@/components/Sell/useReferenceData"
import { computeTotals, useSellCart } from "@/components/Sell/useSellCart"
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

function Sell() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()
  const { customers, consumidorFinal, methods, saleTypes } = useReferenceData()
  const { isOpen: sessionOpen } = useOpenCashSession()

  const {
    cart,
    addLine,
    updateLine,
    removeLine,
    reset: resetCart,
  } = useSellCart()
  const [customerId, setCustomerId] = useState<string | null>(null)
  // once the operator explicitly picks (or clears) a customer, the
  // Consumidor Final default must never re-apply
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
  // decimal-UoM product waiting for a hand-typed quantity (see QuantityModal)
  const [qtyTarget, setQtyTarget] = useState<{
    product: ProductPublic
    variant?: ProductVariantPublic
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const creditInFavor =
    selectedCustomer && Number(selectedCustomer.saldo) < 0
      ? -Number(selectedCustomer.saldo)
      : 0

  useEffect(() => {
    if (!customerTouched && consumidorFinal && !customerId)
      setCustomerId(consumidorFinal.id)
  }, [consumidorFinal, customerId, customerTouched])

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
      setCreated(doc)
      setVuelto(saleVuelto)
      resetCart()
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

  // Products whose UoM allows decimals never auto-add 1: the operator hand-
  // types the quantity in the modal. Integer UoMs keep the auto-add behavior.
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
    searchInputRef.current?.focus()
  }

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
          <ProductSearch onAdd={handleAdd} inputRef={searchInputRef} />

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
            setCustomerTouched(true)
            setCustomerId(v === "none" ? null : v)
          }}
          docTypeId={docTypeId}
          onDocTypeChange={setDocTypeId}
          date={date}
          onDateChange={setDate}
          discountTotal={discountTotal}
          onDiscountChange={setDiscountTotal}
          notes={notes}
          onNotesChange={setNotes}
          subtotal={subtotal}
          perceptions={perceptions}
          total={total}
          appliedFavor={round2(Math.min(creditInFavor, total))}
        >
          <div className="flex flex-col gap-3">
            <QuickPaymentBar
              methods={methods}
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
        pending={createMutation.isPending}
        onConfirm={(payments, saleVuelto) => {
          setSplitOpen(false)
          createMutation.mutate({ payments, vuelto: saleVuelto })
        }}
      />

      <QuantityModal
        open={qtyTarget !== null}
        product={qtyTarget?.product ?? null}
        variant={qtyTarget?.variant}
        onConfirm={(qty) => {
          if (qtyTarget) addLine(qtyTarget.product, qtyTarget.variant, qty)
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
