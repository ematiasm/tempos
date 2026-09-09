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
import { useT } from "@/i18n"
import { LOCALE_TAGS } from "@/i18n/locale"
import { formatDateStatic, getStaticLocale, moneyStatic } from "@/lib/format"
import { cn } from "@/lib/utils"

const qty = (value: string | number | null | undefined) =>
  value == null || value === "" ? "—" : String(Number(value))

interface VoucherPrintProps {
  document: DocumentPublic
}

export function VoucherPrint({ document }: VoucherPrintProps) {
  const t = useT()
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
  const date = formatDateStatic(document.fecha)

  const aggregatedLineTaxes = new Map<string, number>()
  for (const line of lines) {
    for (const tax of line.taxes ?? []) {
      if (!tax.aplicado) continue
      const key = taxNames.get(tax.tax_id) ?? t("voucher.tax")
      aggregatedLineTaxes.set(
        key,
        (aggregatedLineTaxes.get(key) ?? 0) + Number(tax.monto),
      )
    }
  }
  const docTaxes = document.taxes ?? []
  const timeLabel = new Intl.DateTimeFormat(LOCALE_TAGS[getStaticLocale()], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(document.fecha))
  const isVoided = document.estado === "voided"

  return (
    <div
      id="voucher-print"
      className="mx-auto max-w-[700px] bg-white text-black"
    >
      {/* --- Header: logo, business name, CUIT (centered) --- */}
      <div className="border-b-2 border-black pb-4 pt-2 text-center">
        {settings?.logo_path && (
          <img
            src={`${OpenAPI.BASE}${settings.logo_path}`}
            alt={settings.business_name}
            className="mx-auto mb-3 max-h-20 object-contain"
          />
        )}
        <h1 className="text-xl font-extrabold uppercase tracking-[0.2em]">
          {settings?.business_name ?? t("voucher.businessName")}
        </h1>
        {settings?.cuit && (
          <p className="mt-1 text-sm font-medium tracking-wider">
            CUIT {settings.cuit}
          </p>
        )}
        {(settings?.address || settings?.phone || settings?.email) && (
          <p className="mt-1 text-xs text-black/60">
            {[settings.address, settings.phone, settings.email]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      {/* --- Document block: type · number, date · time, counterpart --- */}
      <div className="border-b-2 border-black py-3">
        <p className="text-base font-bold">
          <span className="uppercase">{document.document_type.name}</span>
          <span className="mx-1.5 text-black/50">·</span>
          <span className="font-mono">{document.numero}</span>
          {isVoided && (
            <span
              data-testid="voucher-voided"
              className="ml-2 rounded border-2 border-black px-1.5 py-0.5 align-middle text-xs font-bold uppercase"
            >
              {t("voucher.voided")}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm">
          {date}
          <span className="mx-1.5 text-black/50">·</span>
          {timeLabel}
        </p>
        <p className="mt-1 text-sm font-medium">
          {document.contraparte_name ?? t("voucher.consumidorFinal")}
        </p>
        {document.parent_document_id && (
          <p className="text-xs text-black/60">{t("voucher.linkedDocument")}</p>
        )}
      </div>

      {isReceipt ? (
        /* --- Receipt: allocation table (Saldo inicial / pagado / restante) --- */
        <div className="border-b-2 border-black py-3">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide">
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
                        {formatDateStatic(allocation.fecha)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(allocation.saldo_inicial)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(allocation.monto)}
                  </td>
                  <td className="py-2 text-right">
                    {allocation.saldo_inicial == null
                      ? "—"
                      : moneyStatic(
                          Number(allocation.saldo_inicial) -
                            Number(allocation.monto),
                        )}
                  </td>
                </tr>
              ))}
              {(allocations.length > 0 || onAccount > 0) && (
                <tr className="border-b border-black font-semibold">
                  <td className="py-2 pr-2">{t("voucher.totals")}</td>
                  <td className="py-2 pr-2 text-right">
                    {allocations.length > 0 ? moneyStatic(totalInitial) : ""}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(totalPaid)}
                  </td>
                  <td className="py-2 text-right">
                    {allocations.length > 0 ? moneyStatic(totalRemaining) : ""}
                  </td>
                </tr>
              )}
              {onAccount > 0 && (
                <tr className="border-b border-dotted border-black/40">
                  <td className="py-2 pr-2">{t("voucher.onAccount")}</td>
                  <td className="py-2 pr-2 text-right" />
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(onAccount)}
                  </td>
                  <td className="py-2 text-right" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* --- Items: PRODUCTO | CANT. × P. UNIT. | TOTAL --- */}
          <table className="w-full border-b-2 border-black text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2 pr-2 font-bold uppercase">
                  {t("voucher.product")}
                </th>
                <th className="py-2 pr-2 text-right font-bold uppercase">
                  {t("voucher.qtyByUnit")}
                </th>
                <th className="py-2 text-right font-bold uppercase">
                  {t("voucher.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="py-2 pr-2">
                    {line.product_name ?? line.product_id}
                    {(Number(line.descuento_pct) > 0 ||
                      (line.taxes ?? []).some((tt) => tt.aplicado)) && (
                      <div className="text-xs text-black/60">
                        {Number(line.descuento_pct) > 0 && (
                          <span>
                            {t("voucher.lineDiscount", {
                              pct: qty(line.descuento_pct),
                            })}
                          </span>
                        )}
                        {Number(line.descuento_pct) > 0 &&
                          (line.taxes ?? []).some((tt) => tt.aplicado) && (
                            <span> · </span>
                          )}
                        {(line.taxes ?? [])
                          .filter((tt) => tt.aplicado)
                          .map(
                            (tt) => taxNames.get(tt.tax_id) ?? t("voucher.tax"),
                          )
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {qty(line.cantidad)}
                    <span className="mx-1 text-black/50">×</span>
                    {moneyStatic(line.precio_unit)}
                  </td>
                  <td className="py-2 text-right font-medium">
                    {moneyStatic(line.subtotal_line)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* --- Pre-total summary (small; the banner carries the total) --- */}
          {(Number(document.descuento_total) > 0 || docTaxes.length > 0) && (
            <div className="flex flex-col items-end gap-0.5 pt-3 text-sm">
              <div className="flex w-56 justify-between">
                <span>{t("voucher.subtotal")}</span>
                <span>{moneyStatic(document.subtotal)}</span>
              </div>
              {Number(document.descuento_total) > 0 && (
                <div className="flex w-56 justify-between">
                  <span>{t("voucher.discount")}</span>
                  <span>-{moneyStatic(document.descuento_total)}</span>
                </div>
              )}
              {docTaxes.map((tax) => (
                <div key={tax.id} className="flex w-56 justify-between">
                  <span>{taxNames.get(tax.tax_id) ?? t("voucher.tax")}</span>
                  <span>{moneyStatic(tax.monto)}</span>
                </div>
              ))}
            </div>
          )}

          {/* --- Total banner (inverted) --- */}
          <div className="mt-3 flex items-center justify-between bg-black px-4 py-2.5 text-white">
            <span className="text-sm font-bold uppercase tracking-widest">
              {t("voucher.totalPayable")}
            </span>
            <span className="voucher-banner-total font-mono text-2xl font-bold">
              {moneyStatic(document.total)}
            </span>
          </div>

          {/* --- Tax breakdown box (informational; IVA travels inside prices) --- */}
          {(aggregatedLineTaxes.size > 0 || docTaxes.length > 0) && (
            <div className="mt-3 border border-black px-3 py-2 text-sm">
              <p className="mb-1 text-center text-xs font-bold uppercase tracking-wider">
                {t("voucher.taxBreakdown")}
              </p>
              {[...aggregatedLineTaxes.entries()].map(([name, monto]) => (
                <div key={name} className="flex justify-between py-0.5">
                  <span>{name}</span>
                  <span>{moneyStatic(monto)}</span>
                </div>
              ))}
              {docTaxes.map((tax) => (
                <div key={tax.id} className="flex justify-between py-0.5">
                  <span>{taxNames.get(tax.tax_id) ?? t("voucher.tax")}</span>
                  <span>{moneyStatic(tax.monto)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* --- Payments at issue --- */}
      {paidRows.length > 0 && (
        <div className="border-b-2 border-black py-3 text-sm">
          <p className="mb-1 font-semibold uppercase tracking-wide">
            {t("voucher.payments")}
          </p>
          {paidRows.map((payment) => (
            <div key={payment.id} className="flex justify-between py-0.5">
              <span>
                {methodNames.get(payment.payment_method_id) ??
                  payment.payment_method_id}
              </span>
              <span>{moneyStatic(payment.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {/* --- Balance pending --- */}
      {incoming.length === 0 && isDebtDocument && saldoPendiente > 0 && (
        <div className="flex justify-between border-b-2 border-black py-3 text-sm font-semibold">
          <span>{t("voucher.balancePending")}</span>
          <span>{moneyStatic(saldoPendiente)}</span>
        </div>
      )}

      {/* --- Receipts applied after issue --- */}
      {incoming.length > 0 && (
        <div className="border-b-2 border-black py-3">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide">
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
                        {formatDateStatic(allocation.fecha)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(allocation.saldo_inicial)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {moneyStatic(allocation.monto)}
                  </td>
                  <td className="py-2 text-right">
                    {allocation.saldo_inicial == null
                      ? "—"
                      : moneyStatic(
                          Number(allocation.saldo_inicial) -
                            Number(allocation.monto),
                        )}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-black font-semibold">
                <td className="py-2 pr-2">{t("voucher.totals")}</td>
                <td className="py-2 pr-2 text-right">
                  {moneyStatic(incomingInitial)}
                </td>
                <td className="py-2 pr-2 text-right">
                  {moneyStatic(incomingPaid)}
                </td>
                <td className="py-2 text-right">
                  {moneyStatic(incomingRemaining)}
                </td>
              </tr>
              <tr className="font-semibold">
                <td className="py-2 pr-2" colSpan={3}>
                  {t("voucher.balancePending")}
                </td>
                <td className="py-2 text-right">
                  {moneyStatic(Math.max(0, saldoPendiente))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {Number(document.favor_monto) > 0 && (
        <div className="flex justify-between border-b-2 border-black py-2 text-sm">
          <span>{t("voucher.favorApplied")}</span>
          <span>{moneyStatic(Number(document.favor_monto))}</span>
        </div>
      )}

      {/* --- Notes --- */}
      {document.notes && (
        <div className="border-b border-dotted border-black/40 py-3 text-sm">
          <p className="mb-1 font-semibold">{t("voucher.notes")}</p>
          <p data-testid="voucher-notes" className="whitespace-pre-line">
            {document.notes}
          </p>
        </div>
      )}

      {/* --- Footer: configured footer + legends + tagline --- */}
      <div className="pt-3 text-center text-xs">
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
        <p className="pt-3 text-black/50">{t("voucher.nonElectronic")}</p>
        <p className="font-semibold tracking-wide">tempos</p>
      </div>
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

  // Page margins come from the Admin > Printing settings (uniform, mm);
  // the defaults mirror the previous hardcoded values.
  const atPage =
    format === "ticket80"
      ? `size: 80mm auto; margin: ${settings?.print_margin_ticket_mm ?? 4}mm`
      : `size: A4; margin: ${settings?.print_margin_a4_mm ?? 12}mm`

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
