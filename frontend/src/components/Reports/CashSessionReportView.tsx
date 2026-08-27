import { useQuery } from "@tanstack/react-query"
import { Printer } from "lucide-react"

import {
  BusinessSettingsService,
  type CashSessionReport,
  OpenAPI,
} from "@/client"
import { useLocale, useT } from "@/i18n"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

const money = (
  value: string | number | null | undefined,
  format: "es" | "en",
) =>
  value == null || value === "" ? "—" : `$${formatMoney(Number(value), format)}`

function PerUserTable({
  title,
  rows,
}: {
  title: string
  rows: CashSessionReport["sales"]
}) {
  const t = useT()
  const { numberFormat } = useLocale()
  if (!rows || rows.length === 0) return null
  const total = rows.reduce((acc, r) => acc + Number(r.total), 0)
  const count = rows.reduce((acc, r) => acc + r.count, 0)
  return (
    <div>
      <h3 className="mb-1 border-b border-black pb-1 text-sm font-semibold uppercase">
        {title}
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-black/60">
            <th className="py-1 pr-2 font-medium">{t("cash.reportUser")}</th>
            <th className="py-1 pr-2 text-right font-medium">
              {t("cash.reportCount")}
            </th>
            <th className="py-1 text-right font-medium">
              {t("cash.reportTotal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.user_id}>
              <td className="py-0.5 pr-2">{row.user_name}</td>
              <td className="py-0.5 pr-2 text-right">{row.count}</td>
              <td className="py-0.5 text-right">
                {money(row.total, numberFormat)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-black font-semibold">
            <td className="py-0.5 pr-2">{t("cash.reportSubtotal")}</td>
            <td className="py-0.5 pr-2 text-right">{count}</td>
            <td className="py-0.5 text-right">{money(total, numberFormat)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ReportSection({ report }: { report: CashSessionReport }) {
  const t = useT()
  const { numberFormat } = useLocale()
  return (
    <div className="flex flex-col gap-4">
      <PerUserTable title={t("cash.reportSales")} rows={report.sales ?? []} />
      <PerUserTable
        title={t("cash.reportReturns")}
        rows={report.returns ?? []}
      />
      <PerUserTable
        title={t("cash.reportPurchases")}
        rows={report.purchases ?? []}
      />
      <PerUserTable
        title={t("cash.reportReceiptsCollected")}
        rows={report.receipts_collected ?? []}
      />
      <PerUserTable
        title={t("cash.reportReceiptsPaid")}
        rows={report.receipts_paid ?? []}
      />

      {(report.methods ?? []).length > 0 && (
        <div>
          <h3 className="mb-1 border-b border-black pb-1 text-sm font-semibold uppercase">
            {t("cash.reportMethods")}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-black/60">
                <th className="py-1 pr-2 font-medium">
                  {t("cash.reportMethod")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("cash.reportAccount")}
                </th>
                <th className="py-1 pr-2 text-right font-medium">
                  {t("cash.reportIncome")}
                </th>
                <th className="py-1 pr-2 text-right font-medium">
                  {t("cash.reportExpense")}
                </th>
                <th className="py-1 text-right font-medium">
                  {t("cash.reportNet")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(report.methods ?? []).map((m) => (
                <tr key={m.payment_method_id}>
                  <td className="py-0.5 pr-2">{m.payment_method_name}</td>
                  <td className="py-0.5 pr-2 text-black/70">
                    {m.financial_account_name}
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {money(m.ingresos, numberFormat)}
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {money(m.egresos, numberFormat)}
                  </td>
                  <td className="py-0.5 text-right font-medium">
                    {money(m.net, numberFormat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(report.movements ?? []).length > 0 && (
        <div>
          <h3 className="mb-1 border-b border-black pb-1 text-sm font-semibold uppercase">
            {t("cash.reportMovements")}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-black/60">
                <th className="py-1 pr-2 font-medium">
                  {t("cash.reportDate")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("cash.reportConcept")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("cash.reportAccount")}
                </th>
                <th className="py-1 text-right font-medium">
                  {t("cash.reportAmount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(report.movements ?? []).map((m, index) => (
                <tr key={index}>
                  <td className="py-0.5 pr-2">
                    {new Date(m.fecha).toLocaleString()}
                  </td>
                  <td className="py-0.5 pr-2">{m.concept}</td>
                  <td className="py-0.5 pr-2 text-black/70">
                    {m.financial_account_name ?? "—"}
                  </td>
                  <td className="py-0.5 text-right">
                    {money(m.monto, numberFormat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function CashSessionReportView({
  report,
}: {
  report: CashSessionReport
}) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
  })
  const session = report.session
  const difference = Number(report.difference ?? 0)

  return (
    <div
      id="cash-session-print"
      className="mx-auto max-w-[800px] bg-white text-black"
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
        <p className="text-base font-semibold">{t("cash.reportTitle")}</p>
        <p className="text-sm text-black/60">
          {t("cash.openedAt", {
            time: new Date(session.opened_at).toLocaleString(),
          })}
          {session.closed_at
            ? ` — ${t("cash.closedAt", {
                time: new Date(session.closed_at).toLocaleString(),
              })}`
            : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-black py-4 text-sm">
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.openedBy")}</span>
          <span className="font-medium">{session.opened_by_name ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.closedBy")}</span>
          <span className="font-medium">{session.closed_by_name ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.cashAccount")}</span>
          <span className="font-medium">
            {session.cash_account_name ?? "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.openingSource")}</span>
          <span className="font-medium">
            {session.opening_source_account_name ?? "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.openingAmountLabel")}</span>
          <span className="font-medium">
            {money(session.opening_amount, numberFormat)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.status")}</span>
          <span className="font-medium capitalize">{session.status}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-b border-black py-4 text-sm">
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.expected")}</span>
          <span className="font-mono font-medium">
            {money(report.expected_amount, numberFormat)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">{t("cash.countedAmount")}</span>
          <span className="font-mono font-medium">
            {money(report.counted_amount, numberFormat)}
          </span>
        </div>
        <div
          className={cn(
            "flex justify-between border-t border-black pt-1 text-base font-bold",
            difference < 0 && "text-red-700",
            difference > 0 && "text-green-700",
          )}
        >
          <span>{t("cash.difference")}</span>
          <span className="font-mono">{money(difference, numberFormat)}</span>
        </div>
        {session.notes && (
          <div className="flex justify-between pt-1">
            <span className="text-black/60">{t("cash.notes")}</span>
            <span className="font-medium">{session.notes}</span>
          </div>
        )}
      </div>

      <div className="py-4">
        <ReportSection report={report} />
      </div>

      <p className="pt-8 text-center text-xs text-black/50">tempos</p>
    </div>
  )
}

interface CashSessionReportDialogProps {
  report: CashSessionReport
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CashSessionReportDialog({
  report,
  open,
  onOpenChange,
}: CashSessionReportDialogProps) {
  const t = useT()
  if (!open) return null

  return (
    <div className="voucher-overlay fixed inset-0 z-50 flex flex-col bg-background">
      <div className="no-print flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-lg font-semibold">{t("cash.reportPreview")}</h2>
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
            className="flex items-center gap-2 rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <Printer className="h-4 w-4" />
            {t("common.print")}
          </button>
        </div>
      </div>
      <div className="voucher-scroll flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-8">
        <CashSessionReportView report={report} />
      </div>
    </div>
  )
}

export default CashSessionReportView
