import { useQuery } from "@tanstack/react-query"
import {
  BusinessSettingsService,
  type DocumentPublic,
  OpenAPI,
  PaymentMethodsService,
  PaymentsService,
  TaxesService,
} from "@/client"
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
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
  })
  const { data: taxesData } = useQuery({
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
  })
  const isReceipt = document.document_type.operation === "recibo"
  const { data: allocationsData } = useQuery({
    queryFn: () =>
      PaymentsService.readReceiptAllocations({
        receiptDocumentId: document.id,
      }),
    queryKey: ["receipt-allocations", document.id],
    enabled: isReceipt,
  })

  const methodNames = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.name] as const),
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

      <div className="ml-auto flex w-64 flex-col gap-1 py-4 text-sm">
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

      {(document.payments ?? []).length > 0 && (
        <div className="border-t border-black py-3 text-sm">
          <p className="mb-1 font-semibold">{t("voucher.payments")}</p>
          {(document.payments ?? []).map((payment) => (
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

      {Number(document.favor_monto) > 0 && (
        <div className="flex justify-between py-0.5 text-sm">
          <span>{t("voucher.favorApplied")}</span>
          <span>{money(Number(document.favor_monto), numberFormat)}</span>
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
}

export function PrintVoucherDialog({
  document,
  open,
  onOpenChange,
}: PrintVoucherDialogProps) {
  const t = useT()
  if (!open) return null

  return (
    <div className="voucher-overlay fixed inset-0 z-50 flex flex-col bg-background">
      <div className="no-print flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-lg font-semibold">{t("voucher.preview")}</h2>
        <div className="flex gap-2">
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
      <div className="voucher-scroll flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-8">
        <VoucherPrint document={document} />
      </div>
    </div>
  )
}

export default PrintVoucherDialog
