import { useQuery } from "@tanstack/react-query"

import type { DocumentPublic } from "@/client"
import {
  BusinessSettingsService,
  PaymentMethodsService,
  ProductsService,
  TaxesService,
} from "@/client"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

const money = (value: string | number | null | undefined) =>
  value == null || value === "" ? "—" : `$${Number(value).toFixed(2)}`

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
  const { data: productsData } = useQuery({
    queryFn: () => ProductsService.readProducts({ skip: 0, limit: 1000 }),
    queryKey: ["products"],
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

  const productNames = new Map(
    (productsData?.data ?? []).map((p) => [p.id, p.name] as const),
  )
  const methodNames = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.name] as const),
  )
  const taxNames = new Map(
    (taxesData?.data ?? []).map((t) => [t.id, t.name] as const),
  )
  const lines = [...(document.lines ?? [])].sort((a, b) => a.orden - b.orden)
  const date = new Date(document.fecha).toLocaleDateString("es-AR")

  return (
    <div
      id="voucher-print"
      className="mx-auto max-w-[700px] bg-white text-black"
    >
      <div className="border-b border-black pb-4 text-center">
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

      <table className="w-full border-b border-black text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-2 pr-2 font-semibold">{t("voucher.product")}</th>
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
                {productNames.get(line.product_id) ?? line.product_id}
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
                {money(line.precio_unit)}
              </td>
              <td className="py-2 pr-2 text-right">
                {money(line.descuento_monto)}
              </td>
              <td className="py-2 text-right font-medium">
                {money(line.subtotal_line)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(document.taxes ?? []).length > 0 && (
        <div className="border-b border-black py-3 text-sm">
          {document.taxes?.map((tax) => (
            <div key={tax.id} className="flex justify-between py-0.5">
              <span>
                {taxNames.get(tax.tax_id) ?? t("voucher.tax")}
                <span className="text-black/60">
                  {" "}
                  ({t("voucher.base", { base: money(tax.base) })})
                </span>
              </span>
              <span>{money(tax.monto)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ml-auto flex w-64 flex-col gap-1 py-4 text-sm">
        <div className="flex justify-between">
          <span>{t("voucher.subtotal")}</span>
          <span>{money(document.subtotal)}</span>
        </div>
        {Number(document.descuento_total) > 0 && (
          <div className="flex justify-between">
            <span>{t("voucher.discount")}</span>
            <span>-{money(document.descuento_total)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-black pt-1 text-base font-bold">
          <span>{t("voucher.total")}</span>
          <span>{money(document.total)}</span>
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
              <span>{money(payment.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {Number(document.favor_monto) > 0 && (
        <div className="flex justify-between py-0.5 text-sm">
          <span>{t("voucher.favorApplied")}</span>
          <span>{money(Number(document.favor_monto))}</span>
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
