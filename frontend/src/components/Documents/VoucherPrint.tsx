import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
  BusinessSettingsService,
  type DocumentPublic,
  DocumentsService,
  OpenAPI,
  PaymentMethodsService,
  PaymentsService,
  type PrintFormat,
  TaxesService,
} from "@/client"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { useLocale, useT } from "@/i18n"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

const money = (
  value: string | number | null | undefined,
  format: "es" | "en",
) =>
  value == null || value === "" ? "—" : `$${formatMoney(Number(value), format)}`

const qty = (value: string | number | null | undefined) =>
  value == null || value === "" ? "—" : String(Number(value))

interface VoucherPrintProps {
  document: DocumentPublic
}

export function VoucherPrint({ document }: VoucherPrintProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 1000 }),
    queryKey: ["payment-methods"],
  })
  const { data: taxesData } = useQuery({
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
  })
  const isReceipt = document.document_type.operation === "recibo"
  const isDebtDocument =
    document.document_type.operation === "venta" ||
    document.document_type.operation === "compra"
  const { data: allocationsData } = useQuery({
    queryFn: () =>
      PaymentsService.readReceiptAllocations({
        receiptDocumentId: document.id,
      }),
    queryKey: ["receipt-allocations", document.id],
    enabled: isReceipt,
  })
  // Receipts applied to this sale/purchase after its issue (incoming
  // allocations). Lets a reprint reflect the current payment state instead
  // of the frozen at-issue one.
  const { data: incomingData } = useQuery({
    queryFn: () =>
      DocumentsService.readDocumentAllocations({ documentId: document.id }),
    queryKey: ["documents-allocations", document.id],
    enabled: !isReceipt && isDebtDocument,
  })

  const methodNames = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.name] as const),
  )
  const methodMarksPaid = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.marks_paid] as const),
  )
  const taxNames = new Map(
    (taxesData?.data ?? []).map((t) => [t.id, t.name] as const),
  )
  const allocations = allocationsData ?? []
  const totalInitial = allocations.reduce(
    (sum, a) => sum + (a.saldo_inicial == null ? 0 : Number(a.saldo_inicial)),
    0,
  )
  const totalPaid = allocations.reduce((sum, a) => sum + Number(a.monto), 0)
  const totalRemaining = allocations.reduce(
    (sum, a) =>
      sum +
      (a.saldo_inicial == null ? 0 : Number(a.saldo_inicial) - Number(a.monto)),
    0,
  )
  const onAccount = Math.max(0, Number(document.total) - totalPaid)
  // Credit/current-account rows (marks_paid = false) never move money: they
  // are not payments, so only effectively-paid rows list under Pagos and the
  // remainder shows as pending.
  const incoming = incomingData ?? []
  const incomingInitial = incoming.reduce(
    (sum, a) => sum + (a.saldo_inicial == null ? 0 : Number(a.saldo_inicial)),
    0,
  )
  const incomingPaid = incoming.reduce((sum, a) => sum + Number(a.monto), 0)
  const incomingRemaining = incoming.reduce(
    (sum, a) =>
      sum +
      (a.saldo_inicial == null ? 0 : Number(a.saldo_inicial) - Number(a.monto)),
    0,
  )
  const paidRows = (document.payments ?? []).filter(
    (p) => methodMarksPaid.get(p.payment_method_id) !== false,
  )
  const paidAtIssue = paidRows.reduce((sum, p) => sum + Number(p.monto), 0)
  const saldoPendiente =
    Number(document.total) -
    Number(document.favor_monto ?? 0) -
    paidAtIssue -
    incomingPaid
  const lines = [...(document.lines ?? [])].sort((a, b) => a.orden - b.orden)
  const date = new Date(document.fecha).toLocaleDateString("es-AR")

  return (
    <div
      id="voucher-print"
      className="mx-auto max-w-[700px] bg-white text-black"
    >
      <div className="border-b border-black pb-4 text-center">
        {settings?.logo_path && (
          <img
            src={`${OpenAPI.BASE}${settings.logo_path}`}
            alt={settings.business_name}
            className="mx-auto mb-2 max-h-20 object-contain"
          />
        )}
        <h1 className="text-xl font-bold uppercase tracking-wide">
          {settings?.business_name ?? t("voucher.businessName")}
        </h1>
        {settings?.cuit && <p className="text-sm">CUIT: {settings.cuit}</p>}
        {settings?.address && <p className="text-sm">{settings.address}</p>}
        {(settings?.phone || settings?.email) && (
          <p className="text-sm">
            {[settings.phone, settings.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-black py-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide">
            {document.document_type.name}
          </p>
          <p className="font-mono text-2xl font-bold">{document.numero}</p>
        </div>
        <div className="text-right text-sm">
          <p>
            {t("voucher.date")}: {date}
          </p>
          <p>
            {t("voucher.status")}:{" "}
            <span className="capitalize">{document.estado}</span>
          </p>
          {document.parent_document_id && <p>{t("voucher.linkedDocument")}</p>}
        </div>
      </div>

      {document.contraparte_name && (
        <div className="border-b border-black py-4 text-sm">
          <p>
            <span className="font-semibold">
              {document.contraparte_type === "supplier"
                ? t("voucher.supplier")
                : t("voucher.customer")}
              :
            </span>{" "}
            {document.contraparte_name}
          </p>
        </div>
      )}

      {isReceipt ? (
        <div className="border-b border-black py-3">
          <p className="mb-2 text-sm font-semibold">
            {t("voucher.allocationsTitle")}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-2 font-semibold">
                  {t("voucher.document")}
                </th>
                <th className="py-2 pr-2 text-right font-semibold">
                  {t("voucher.balanceInitial")}
                </th>
                <th className="py-2 pr-2 text-right font-semibold">
                  {t("voucher.balancePaid")}
                </th>
                <th className="py-2 text-right font-semibold">
                  {t("voucher.balanceRemaining")}
                </th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((allocation) => (
                <tr
                  key={allocation.document_id}
                  className="border-b border-dotted border-black/40"
                >
                  <td className="py-2 pr-2">
                    <span className="font-mono">{allocation.numero}</span>
                    {allocation.fecha && (
                      <div className="text-xs text-black/60">
                        {new Date(allocation.fecha).toLocaleDateString("es-AR")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(allocation.saldo_inicial, numberFormat)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(allocation.monto, numberFormat)}
                  </td>
                  <td className="py-2 text-right">
                    {allocation.saldo_inicial == null
                      ? "—"
                      : money(
                          Number(allocation.saldo_inicial) -
                            Number(allocation.monto),
                          numberFormat,
                        )}
                  </td>
                </tr>
              ))}
              {(allocations.length > 0 || onAccount > 0) && (
                <tr className="border-b border-black font-semibold">
                  <td className="py-2 pr-2">{t("voucher.totals")}</td>
                  <td className="py-2 pr-2 text-right">
                    {allocations.length > 0
                      ? money(totalInitial, numberFormat)
                      : ""}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(totalPaid, numberFormat)}
                  </td>
                  <td className="py-2 text-right">
                    {allocations.length > 0
                      ? money(totalRemaining, numberFormat)
                      : ""}
                  </td>
                </tr>
              )}
              {onAccount > 0 && (
                <tr className="border-b border-dotted border-black/40">
                  <td className="py-2 pr-2">{t("voucher.onAccount")}</td>
                  <td className="py-2 pr-2 text-right" />
                  <td className="py-2 pr-2 text-right">
                    {money(onAccount, numberFormat)}
                  </td>
                  <td className="py-2 text-right" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <table className="w-full border-b border-black text-sm">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-2 pr-2 font-semibold">
                {t("voucher.product")}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t("voucher.qty")}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t("voucher.unitPrice")}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t("voucher.disc")}
              </th>
              <th className="py-2 text-right font-semibold">
                {t("voucher.subtotal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.id}
                className="border-b border-dotted border-black/40"
              >
                <td className="py-2 pr-2">
                  {line.product_name ?? line.product_id}
                  {Number(line.descuento_pct) > 0 && (
                    <span className="ml-1 text-xs">
                      ({qty(line.descuento_pct)}%)
                    </span>
                  )}
                  <div className="text-xs text-black/60">
                    {(line.taxes ?? [])
                      .filter((t) => t.aplicado)
                      .map((tt) => taxNames.get(tt.tax_id) ?? t("voucher.tax"))
                      .join(" · ")}
                  </div>
                </td>
                <td className="py-2 pr-2 text-right">{qty(line.cantidad)}</td>
                <td className="py-2 pr-2 text-right">
                  {money(line.precio_unit, numberFormat)}
                </td>
                <td className="py-2 pr-2 text-right">
                  {money(line.descuento_monto, numberFormat)}
                </td>
                <td className="py-2 text-right font-medium">
                  {money(line.subtotal_line, numberFormat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(document.taxes ?? []).length > 0 && (
        <div className="border-b border-black py-3 text-sm">
          {document.taxes?.map((tax) => (
            <div key={tax.id} className="flex justify-between py-0.5">
              <span>
                {taxNames.get(tax.tax_id) ?? t("voucher.tax")}
                <span className="text-black/60">
                  {" "}
                  ({t("voucher.base", { base: money(tax.base, numberFormat) })})
                </span>
              </span>
              <span>{money(tax.monto, numberFormat)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="voucher-totals ml-auto flex w-64 flex-col gap-1 py-4 text-sm">
        <div className="flex justify-between">
          <span>{t("voucher.subtotal")}</span>
          <span>{money(document.subtotal, numberFormat)}</span>
        </div>
        {Number(document.descuento_total) > 0 && (
          <div className="flex justify-between">
            <span>{t("voucher.discount")}</span>
            <span>-{money(document.descuento_total, numberFormat)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-black pt-1 text-base font-bold">
          <span>{t("voucher.total")}</span>
          <span>{money(document.total, numberFormat)}</span>
        </div>
      </div>

      {paidRows.length > 0 && (
        <div className="border-t border-black py-3 text-sm">
          <p className="mb-1 font-semibold">{t("voucher.payments")}</p>
          {paidRows.map((payment) => (
            <div key={payment.id} className="flex justify-between py-0.5">
              <span>
                {methodNames.get(payment.payment_method_id) ??
                  payment.payment_method_id}
              </span>
              <span>{money(payment.monto, numberFormat)}</span>
            </div>
          ))}
        </div>
      )}

      {incoming.length === 0 && isDebtDocument && saldoPendiente > 0 && (
        <div className="flex justify-between border-t border-black py-3 text-sm font-semibold">
          <span>{t("voucher.balancePending")}</span>
          <span>{money(saldoPendiente, numberFormat)}</span>
        </div>
      )}

      {incoming.length > 0 && (
        <div className="border-t border-black py-3">
          <p className="mb-2 text-sm font-semibold">
            {t("voucher.receiptsTitle")}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-2 font-semibold">
                  {t("voucher.document")}
                </th>
                <th className="py-2 pr-2 text-right font-semibold">
                  {t("voucher.balanceInitial")}
                </th>
                <th className="py-2 pr-2 text-right font-semibold">
                  {t("voucher.balancePaid")}
                </th>
                <th className="py-2 text-right font-semibold">
                  {t("voucher.balanceRemaining")}
                </th>
              </tr>
            </thead>
            <tbody>
              {incoming.map((allocation) => (
                <tr
                  key={allocation.receipt_document_id}
                  className="border-b border-dotted border-black/40"
                >
                  <td className="py-2 pr-2">
                    <span className="font-mono">
                      {allocation.receipt_numero}
                    </span>
                    {allocation.fecha && (
                      <div className="text-xs text-black/60">
                        {new Date(allocation.fecha).toLocaleDateString("es-AR")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(allocation.saldo_inicial, numberFormat)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(allocation.monto, numberFormat)}
                  </td>
                  <td className="py-2 text-right">
                    {allocation.saldo_inicial == null
                      ? "—"
                      : money(
                          Number(allocation.saldo_inicial) -
                            Number(allocation.monto),
                          numberFormat,
                        )}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-black font-semibold">
                <td className="py-2 pr-2">{t("voucher.totals")}</td>
                <td className="py-2 pr-2 text-right">
                  {money(incomingInitial, numberFormat)}
                </td>
                <td className="py-2 pr-2 text-right">
                  {money(incomingPaid, numberFormat)}
                </td>
                <td className="py-2 text-right">
                  {money(incomingRemaining, numberFormat)}
                </td>
              </tr>
              <tr className="font-semibold">
                <td className="py-2 pr-2" colSpan={3}>
                  {t("voucher.balancePending")}
                </td>
                <td className="py-2 text-right">
                  {money(Math.max(0, saldoPendiente), numberFormat)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {Number(document.favor_monto) > 0 && (
        <div className="flex justify-between py-0.5 text-sm">
          <span>{t("voucher.favorApplied")}</span>
          <span>{money(Number(document.favor_monto), numberFormat)}</span>
        </div>
      )}

      {document.notes && (
        <div className="border-t border-black py-3 text-sm">
          <p className="mb-1 font-semibold">{t("voucher.notes")}</p>
          <p data-testid="voucher-notes" className="whitespace-pre-line">
            {document.notes}
          </p>
        </div>
      )}

      {(settings?.voucher_footer || settings?.voucher_legends) && (
        <div className="border-t border-black pt-3 text-center text-xs">
          {settings?.voucher_footer && (
            <p data-testid="voucher-footer" className="whitespace-pre-line">
              {settings.voucher_footer}
            </p>
          )}
          {settings?.voucher_legends && (
            <div
              data-testid="voucher-legends"
              className="whitespace-pre-line text-black/60"
            >
              {settings.voucher_legends}
            </div>
          )}
        </div>
      )}

      <p className="pt-8 text-center text-xs text-black/50">
        {t("voucher.nonElectronic")} — tempos
      </p>
    </div>
  )
}

interface PrintVoucherDialogProps {
  document: DocumentPublic
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens with the save-as-PDF destination hint (same print flow). */
  savePdf?: boolean
}

export function PrintVoucherDialog({
  document,
  open,
  onOpenChange,
  savePdf = false,
}: PrintVoucherDialogProps) {
  const t = useT()
  const { settings } = useBusinessSettings()
  const [format, setFormat] = useState<PrintFormat>("a4")
  const [pdfMode, setPdfMode] = useState(savePdf)

  // every open re-preselects the configured default format
  useEffect(() => {
    if (open) {
      setFormat(settings?.default_print_format ?? "a4")
      setPdfMode(savePdf)
    }
  }, [open, settings?.default_print_format, savePdf])

  if (!open) return null

  const atPage =
    format === "ticket80"
      ? "size: 80mm auto; margin: 4mm 3mm"
      : "size: A4; margin: 12mm"

  return (
    <div
      className="voucher-overlay fixed inset-0 z-50 flex flex-col bg-background"
      data-print-format={format}
    >
      {/* active print profile: @page must live in the printed document */}
      <style>{`@media print { @page { ${atPage}; } }`}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <h2 className="text-lg font-semibold">{t("voucher.preview")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border">
            <button
              type="button"
              data-testid="print-format-ticket80"
              onClick={() => setFormat("ticket80")}
              className={cn(
                "px-3 py-1.5 text-sm",
                format === "ticket80"
                  ? "bg-black text-white"
                  : "hover:bg-muted",
              )}
            >
              {t("voucher.formatTicket")}
            </button>
            <button
              type="button"
              data-testid="print-format-a4"
              onClick={() => setFormat("a4")}
              className={cn(
                "px-3 py-1.5 text-sm",
                format === "a4" ? "bg-black text-white" : "hover:bg-muted",
              )}
            >
              {t("voucher.formatA4")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("common.close")}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className={cn(
              "rounded bg-black px-3 py-1.5 text-sm font-medium text-white",
              "hover:bg-neutral-800",
            )}
          >
            {t("common.print")}
          </button>
        </div>
      </div>
      {pdfMode && (
        <p
          data-testid="print-pdf-hint"
          className="no-print border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
        >
          {t("voucher.pdfHint")}
        </p>
      )}
      <div className="voucher-scroll flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-8">
        <VoucherPrint document={document} />
      </div>
    </div>
  )
}

export default PrintVoucherDialog
